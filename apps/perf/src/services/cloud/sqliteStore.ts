import { TABLES } from '@/db/backup';
import { db, type Db, type SqlValue } from '@/db/db';
import type { LocalStore, PendingChange, RemoteRow, SyncState } from '@/vendor/mylife-sync';

/**
 * MyPerf ↔ synchro MyLife : suivi des modifications de la base SQLite et application de celles des
 * autres appareils (même code sur le téléphone et sur le web).
 *
 * - Des déclencheurs SQLite (recréés à chaque lancement d'après les colonnes réelles) notent chaque
 *   ligne réellement modifiée dans `sync_queue`, seulement une fois l'appareil relié à un compte.
 * - Les lignes reçues sont écrites avec `applying = 1` : les déclencheurs se taisent, rien ne repart.
 * - Restent sur l'appareil : le minuteur de repos en cours, la date de la sauvegarde automatique.
 */

type Table = (typeof TABLES)[number];

/** Clé d'une ligne, en SQL (préfixe NEW./OLD.) et à partir d'un objet ligne. */
const KEY_COLUMNS: Record<Table, string[]> = {
  settings: ['key'],
  exercises: ['id'],
  exercise_one_rm: ['exercise_id'],
  exercise_substitutions: ['from_exercise_id', 'to_exercise_id'],
  macrocycles: ['id'],
  mesocycles: ['id'],
  cycle_week_overrides: ['id'],
  templates: ['id'],
  template_exercises: ['id'],
  week_pattern: ['id'],
  workouts: ['id'],
  planned_sessions: ['id'],
  workout_exercises: ['id'],
  sets: ['id'],
  body_entries: ['id'],
};
/** Réglages propres à l'appareil (clé de la table settings). */
const DEVICE_ONLY_SETTINGS = ['rest_timer', 'auto_backup_last'];
const SEP = '|';

const isTable = (t: string): t is Table => (TABLES as readonly string[]).includes(t);
const keySql = (table: Table, prefix: 'NEW' | 'OLD') => KEY_COLUMNS[table].map((c) => `${prefix}.${c}`).join(` || '${SEP}' || `);
const ridOf = (table: Table, row: Record<string, unknown>) => KEY_COLUMNS[table].map((c) => String(row[c])).join(SEP);
const whereKey = (table: Table) => KEY_COLUMNS[table].map((c) => `${c} = ?`).join(' AND ');
const keyValues = (table: Table, rid: string): SqlValue[] => (KEY_COLUMNS[table].length === 1 ? [rid] : rid.split(SEP));
const columnsOf = (d: Db, table: Table) => d.all<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name);

/** (Re)crée les déclencheurs de suivi d'après le schéma actuel. À appeler après les migrations. */
export function installSyncTriggers(d: Db): void {
  const now = "CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)";
  const active = "(SELECT v FROM sync_state WHERE k = 'applying') = '0' AND (SELECT v FROM sync_state WHERE k = 'tracking') = '1'";
  const enqueue = (table: Table, prefix: 'NEW' | 'OLD') =>
    `INSERT INTO sync_queue (tbl, rid, ver, at) VALUES ('${table}', ${keySql(table, prefix)}, 1, ${now}) ON CONFLICT(tbl, rid) DO UPDATE SET ver = ver + 1, at = excluded.at;`;
  const sql: string[] = ["INSERT OR IGNORE INTO sync_state (k, v) VALUES ('tracking', '0');"];
  for (const table of TABLES) {
    const skip = table === 'settings' ? ` AND ${'%P%'}.key NOT IN (${DEVICE_ONLY_SETTINGS.map((k) => `'${k}'`).join(', ')})` : '';
    // Une mise à jour qui ne change rien n'est pas une modification.
    const changed = columnsOf(d, table)
      .map((c) => `OLD.${c} IS NOT NEW.${c}`)
      .join(' OR ');
    sql.push(
      `DROP TRIGGER IF EXISTS sync_${table}_ins;`,
      `DROP TRIGGER IF EXISTS sync_${table}_upd;`,
      `DROP TRIGGER IF EXISTS sync_${table}_del;`,
      `CREATE TRIGGER sync_${table}_ins AFTER INSERT ON ${table} WHEN ${active}${skip.replace('%P%', 'NEW')} BEGIN ${enqueue(table, 'NEW')} END;`,
      `CREATE TRIGGER sync_${table}_upd AFTER UPDATE ON ${table} WHEN ${active}${skip.replace('%P%', 'NEW')} AND (${changed}) BEGIN ${enqueue(table, 'NEW')} END;`,
      `CREATE TRIGGER sync_${table}_del AFTER DELETE ON ${table} WHEN ${active}${skip.replace('%P%', 'OLD')} BEGIN ${enqueue(table, 'OLD')} END;`,
    );
  }
  d.exec(sql.join('\n'));
}

function setFlag(k: 'applying' | 'tracking', on: boolean) {
  db().run("INSERT INTO sync_state (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", [k, on ? '1' : '0']);
}

/** Écrit des lignes venues du compte : déclencheurs muets, clés étrangères suspendues (ordre libre). */
function writeRemote(fn: () => void) {
  setFlag('applying', true);
  db().exec('PRAGMA foreign_keys = OFF;');
  try {
    db().transaction(fn);
  } finally {
    db().exec('PRAGMA foreign_keys = ON;');
    setFlag('applying', false);
  }
}

function upsert(table: Table, row: Record<string, unknown>, columns: Set<string>) {
  const cols = Object.keys(row).filter((c) => columns.has(c));
  if (!cols.length) return;
  const keys = KEY_COLUMNS[table];
  const updates = cols.filter((c) => !keys.includes(c)).map((c) => `${c} = excluded.${c}`);
  db().run(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) ON CONFLICT(${keys.join(', ')}) DO ${updates.length ? `UPDATE SET ${updates.join(', ')}` : 'NOTHING'}`,
    cols.map((c) => {
      const v = row[c];
      return typeof v === 'string' || typeof v === 'number' || v === null ? v : v === undefined ? null : JSON.stringify(v);
    }),
  );
}

function applyRows(rows: RemoteRow[]) {
  const cols = new Map<Table, Set<string>>();
  const columnsFor = (t: Table) => cols.get(t) ?? cols.set(t, new Set(columnsOf(db(), t))).get(t)!;
  for (const r of rows) {
    if (!isTable(r.tbl) || (r.tbl === 'settings' && DEVICE_ONLY_SETTINGS.includes(r.rid))) continue;
    if (r.deleted) db().run(`DELETE FROM ${r.tbl} WHERE ${whereKey(r.tbl)}`, keyValues(r.tbl, r.rid));
    else if (r.row && typeof r.row === 'object') upsert(r.tbl, r.row as Record<string, unknown>, columnsFor(r.tbl));
  }
}

export function sqliteStore(): LocalStore {
  return {
    app: 'perf',
    async pending(limit) {
      const items = db().all<{ tbl: string; rid: string; ver: number; at: number }>('SELECT tbl, rid, ver, at FROM sync_queue ORDER BY at LIMIT ?', [limit]);
      return items.map((q): PendingChange => {
        const row = isTable(q.tbl) ? db().first<Record<string, unknown>>(`SELECT * FROM ${q.tbl} WHERE ${whereKey(q.tbl)}`, keyValues(q.tbl, q.rid)) : null;
        return { tbl: q.tbl, rid: q.rid, ver: q.ver, updatedAt: q.at, row };
      });
    },
    async ack(done) {
      db().transaction(() => {
        for (const d of done) db().run('DELETE FROM sync_queue WHERE tbl = ? AND rid = ? AND ver = ?', [d.tbl, d.rid, d.ver]);
      });
    },
    async apply(rows) {
      writeRemote(() => applyRows(rows));
    },
    async snapshot() {
      const out: { tbl: string; rid: string; row: unknown }[] = [];
      for (const table of TABLES) {
        for (const row of db().all<Record<string, unknown>>(`SELECT * FROM ${table}`)) {
          if (table === 'settings' && DEVICE_ONLY_SETTINGS.includes(String(row.key))) continue;
          out.push({ tbl: table, rid: ridOf(table, row), row });
        }
      }
      return out;
    },
    async replace(rows) {
      writeRemote(() => {
        for (const table of [...TABLES].reverse()) {
          if (table === 'settings') db().run(`DELETE FROM settings WHERE key NOT IN (${DEVICE_ONLY_SETTINGS.map(() => '?').join(', ')})`, DEVICE_ONLY_SETTINGS);
          else db().run(`DELETE FROM ${table}`);
        }
        applyRows(rows);
      });
    },
    async clearPending() {
      db().run('DELETE FROM sync_queue');
    },
    async forget() {
      // Données d'un autre compte : tout part, réglages propres à l'appareil compris.
      writeRemote(() => {
        for (const table of [...TABLES].reverse()) db().run(`DELETE FROM ${table}`);
      });
      db().run('DELETE FROM sync_queue');
    },
    async getState() {
      const raw = db().first<{ v: string }>("SELECT v FROM sync_state WHERE k = 'state'")?.v;
      return raw ? (JSON.parse(raw) as SyncState) : null;
    },
    async setState(state) {
      db().run("INSERT INTO sync_state (k, v) VALUES ('state', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", [JSON.stringify(state)]);
      // Suivi des modifications : seulement quand l'appareil est relié à un compte.
      setFlag('tracking', state.joinedAs !== null);
    },
  };
}

export const pendingCount = () => db().first<{ n: number }>('SELECT COUNT(*) AS n FROM sync_queue')?.n ?? 0;
