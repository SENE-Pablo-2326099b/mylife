import type { PendingChange, RemoteRow, SyncState } from '@mylife/core/engine';
import type { Db, SqlValue } from './sql';

/**
 * MyPerf ↔ synchro MyLife (app `perf`), côté Worker : même format de lignes et même suivi que l'app d'avant
 * (apps/perf/src/services/cloud/sqliteStore.ts), pour que les deux lisent et écrivent le même compte.
 *
 * - Des déclencheurs SQLite (recréés à chaque ouverture d'après les colonnes réelles) notent chaque ligne réellement
 *   modifiée dans `sync_queue`, seulement une fois l'appareil relié à un compte.
 * - Les lignes reçues sont écrites avec `applying = 1` : les déclencheurs se taisent, rien ne repart.
 * - Une ligne reçue n'écrit que les colonnes qu'elle transporte : une ligne réécrite par l'app d'avant (qui ignore les
 *   colonnes du moteur composable) garde ici leurs valeurs.
 */
export const SYNC_TABLES = [
  'settings',
  'exercises',
  'exercise_one_rm',
  'exercise_substitutions',
  'macrocycles',
  'mesocycles',
  'cycle_week_overrides',
  'templates',
  'template_exercises',
  'week_pattern',
  'workouts',
  'planned_sessions',
  'workout_exercises',
  'sets',
  'body_entries',
  'formats',
  'cycles',
  'session_moves',
] as const;
type Table = (typeof SYNC_TABLES)[number];

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
  formats: ['id'],
  cycles: ['id'],
  session_moves: ['id'],
};
/** Réglages propres à l'appareil (clé de la table settings). */
const DEVICE_ONLY_SETTINGS = ['rest_timer', 'auto_backup_last'];
const SEP = '|';

const isTable = (t: string): t is Table => (SYNC_TABLES as readonly string[]).includes(t);
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
  for (const table of SYNC_TABLES) {
    const skip = table === 'settings' ? ` AND %P%.key NOT IN (${DEVICE_ONLY_SETTINGS.map((k) => `'${k}'`).join(', ')})` : '';
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

function setFlag(d: Db, k: 'applying' | 'tracking', on: boolean) {
  d.run('INSERT INTO sync_state (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', [k, on ? '1' : '0']);
}

/** Écrit des lignes venues du compte : déclencheurs muets, clés étrangères suspendues (ordre libre). */
function writeRemote(d: Db, fn: () => void) {
  setFlag(d, 'applying', true);
  d.exec('PRAGMA foreign_keys = OFF;');
  try {
    d.transaction(fn);
  } finally {
    d.exec('PRAGMA foreign_keys = ON;');
    setFlag(d, 'applying', false);
  }
}

function upsert(d: Db, table: Table, row: Record<string, unknown>, columns: Set<string>) {
  const cols = Object.keys(row).filter((c) => columns.has(c));
  if (!cols.length) return;
  const keys = KEY_COLUMNS[table];
  const updates = cols.filter((c) => !keys.includes(c)).map((c) => `${c} = excluded.${c}`);
  d.run(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) ON CONFLICT(${keys.join(', ')}) DO ${updates.length ? `UPDATE SET ${updates.join(', ')}` : 'NOTHING'}`,
    cols.map((c) => {
      const v = row[c];
      return typeof v === 'string' || typeof v === 'number' || v === null ? v : v === undefined ? null : JSON.stringify(v);
    }),
  );
}

function applyRows(d: Db, rows: readonly RemoteRow[]) {
  const cols = new Map<Table, Set<string>>();
  const columnsFor = (t: Table) => cols.get(t) ?? cols.set(t, new Set(columnsOf(d, t))).get(t)!;
  for (const r of rows) {
    if (!isTable(r.tbl) || (r.tbl === 'settings' && DEVICE_ONLY_SETTINGS.includes(r.rid))) continue;
    if (r.deleted) d.run(`DELETE FROM ${r.tbl} WHERE ${whereKey(r.tbl)}`, keyValues(r.tbl, r.rid));
    else if (r.row && typeof r.row === 'object') upsert(d, r.tbl, r.row as Record<string, unknown>, columnsFor(r.tbl));
  }
}

/** Les opérations de la synchro sur la base, synchrones (dans le Worker) ; le module les expose en asynchrone. */
export function syncOps(d: Db) {
  return {
    pending(limit: number): PendingChange[] {
      const items = d.all<{ tbl: string; rid: string; ver: number; at: number }>('SELECT tbl, rid, ver, at FROM sync_queue ORDER BY at LIMIT ?', [limit]);
      return items.map((q) => {
        const row = isTable(q.tbl) ? d.first<Record<string, unknown>>(`SELECT * FROM ${q.tbl} WHERE ${whereKey(q.tbl)}`, keyValues(q.tbl, q.rid)) : null;
        return { tbl: q.tbl, rid: q.rid, ver: q.ver, updatedAt: q.at, row };
      });
    },
    ack(done: readonly Pick<PendingChange, 'tbl' | 'rid' | 'ver'>[]): void {
      d.transaction(() => {
        for (const x of done) d.run('DELETE FROM sync_queue WHERE tbl = ? AND rid = ? AND ver = ?', [x.tbl, x.rid, x.ver]);
      });
    },
    apply(rows: readonly RemoteRow[]): void {
      writeRemote(d, () => applyRows(d, rows));
    },
    snapshot(): { tbl: string; rid: string; row: unknown }[] {
      const out: { tbl: string; rid: string; row: unknown }[] = [];
      for (const table of SYNC_TABLES) {
        for (const row of d.all<Record<string, unknown>>(`SELECT * FROM ${table}`)) {
          if (table === 'settings' && DEVICE_ONLY_SETTINGS.includes(String(row.key))) continue;
          out.push({ tbl: table, rid: ridOf(table, row), row });
        }
      }
      return out;
    },
    replace(rows: readonly RemoteRow[]): void {
      writeRemote(d, () => {
        for (const table of [...SYNC_TABLES].reverse()) {
          if (table === 'settings') d.run(`DELETE FROM settings WHERE key NOT IN (${DEVICE_ONLY_SETTINGS.map(() => '?').join(', ')})`, DEVICE_ONLY_SETTINGS);
          else d.run(`DELETE FROM ${table}`);
        }
        applyRows(d, rows);
      });
    },
    clearPending(): void {
      d.run('DELETE FROM sync_queue');
    },
    /** Données d'un autre compte : tout part, réglages propres à l'appareil compris. */
    forget(): void {
      writeRemote(d, () => {
        for (const table of [...SYNC_TABLES].reverse()) d.run(`DELETE FROM ${table}`);
      });
      d.run('DELETE FROM sync_queue');
    },
    getState(): SyncState | null {
      const raw = d.first<{ v: string }>("SELECT v FROM sync_state WHERE k = 'state'")?.v;
      return raw ? (JSON.parse(raw) as SyncState) : null;
    },
    setState(state: SyncState): void {
      d.run("INSERT INTO sync_state (k, v) VALUES ('state', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", [JSON.stringify(state)]);
      setFlag(d, 'tracking', state.joinedAs !== null);
    },
    pendingCount(): number {
      return d.first<{ n: number }>('SELECT COUNT(*) AS n FROM sync_queue')?.n ?? 0;
    },
  };
}

export type SyncOps = ReturnType<typeof syncOps>;
