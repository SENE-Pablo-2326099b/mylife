import Dexie, { type DBCore, type DBCoreMutateRequest, type Middleware } from 'dexie';
import { db, TABLE_NAMES, type BudgetDB, type TableName } from '../../db/db';
import type { Settings } from '../../db/types';
import type { LocalStore, PendingChange, RemoteRow, SyncState } from '../../vendor/mylife-sync';

/**
 * MyFinances ↔ synchro MyLife : suivi des modifications de la base locale (Dexie) et application de
 * celles des autres appareils.
 *
 * - Toute écriture passe par un middleware Dexie qui note « table + clé » dans une file (gardée dans le
 *   navigateur) ; une réécriture identique n'est pas notée (réglages remis à jour à chaque lancement…).
 * - Les écritures venues du compte sont faites dans des transactions marquées : jamais renvoyées.
 * - Restent sur l'appareil : le mot de passe du relais et les repères techniques (`meta`), sauf les
 *   choix de l'utilisateur listés dans SYNCED_META.
 */

const QUEUE_KEY = 'mylife-queue-finances';
const STATE_KEY = 'mylife-sync-finances';
/** Entrées de `meta` qui sont des choix de l'utilisateur (le reste est propre à l'appareil). */
const SYNCED_META = new Set(['exceptionalAllocations']);
const SEP = '\u0001';

type Queue = Map<string, { ver: number; at: number }>;

function loadQueue(): Queue {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return new Map(raw ? (JSON.parse(raw) as [string, { ver: number; at: number }][]) : []);
  } catch {
    return new Map();
  }
}

let queue: Queue | null = null;
const q = () => (queue ??= loadQueue());
const queueListeners = new Set<() => void>();

function saveQueue() {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify([...q()]));
  } catch {
    /* stockage plein : la file reste en mémoire jusqu'à la prochaine synchro */
  }
  queueListeners.forEach((l) => l());
}

export function onLocalChange(fn: () => void): () => void {
  queueListeners.add(fn);
  return () => queueListeners.delete(fn);
}

export const pendingCount = () => q().size;

const syncedTable = (name: string): name is TableName => (TABLE_NAMES as readonly string[]).includes(name);
const tracked = (table: string, key: unknown) => syncedTable(table) && (table !== 'meta' || SYNCED_META.has(String(key)));

function note(table: string, keys: unknown[]) {
  const now = Date.now();
  let changed = false;
  for (const key of keys) {
    if (key === undefined || !tracked(table, key)) continue;
    const k = `${table}${SEP}${String(key)}`;
    q().set(k, { ver: (q().get(k)?.ver ?? 0) + 1, at: now });
    changed = true;
  }
  if (changed) saveQueue();
}

/** Transactions qui appliquent des données du compte : leurs écritures ne sont pas renvoyées. */
const remoteTransactions = new WeakSet<object>();

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Middleware Dexie : note chaque ligne réellement modifiée par l'appareil. */
export const changeTracker: Middleware<DBCore> = {
  stack: 'dbcore',
  name: 'mylifeChangeTracker',
  create(down) {
    return {
      ...down,
      table(name) {
        const table = down.table(name);
        if (!syncedTable(name)) return table;
        const keyPath = table.schema.primaryKey.keyPath as string;
        return {
          ...table,
          async mutate(req: DBCoreMutateRequest) {
            const remote = remoteTransactions.has(req.trans as object);
            if (remote) return table.mutate(req);
            let keys: unknown[] = [];
            if (req.type === 'put' || req.type === 'add') {
              const values = req.values as Record<string, unknown>[];
              keys = req.keys ? [...req.keys] : values.map((v) => v[keyPath]);
              // Réécriture à l'identique : rien à envoyer.
              const before = await table.getMany({ trans: req.trans, keys });
              keys = keys.filter((_, i) => !same(before[i], values[i]));
            } else if (req.type === 'delete') {
              keys = [...req.keys];
            } else if (req.type === 'deleteRange') {
              keys = (await table.query({ trans: req.trans, values: false, query: { index: table.schema.primaryKey, range: req.range } })).result as unknown[];
            }
            const res = await table.mutate(req);
            note(name, keys);
            return res;
          },
        };
      },
    };
  },
};

function stripDeviceOnly(table: TableName, row: unknown): unknown {
  return table === 'settings' ? { ...(row as Settings), bridgePassword: '' } : row;
}

async function inRemoteTransaction(database: BudgetDB, fn: () => Promise<void>) {
  await database.transaction('rw', TABLE_NAMES.map((n) => database.table(n)), async () => {
    remoteTransactions.add(Dexie.currentTransaction.idbtrans as unknown as object);
    await fn();
  });
}

async function putRows(database: BudgetDB, rows: RemoteRow[]) {
  const localSettings = (await database.settings.get('main')) as Settings | undefined;
  const byTable = new Map<TableName, RemoteRow[]>();
  for (const r of rows) {
    if (!tracked(r.tbl, r.rid)) continue;
    byTable.set(r.tbl as TableName, [...(byTable.get(r.tbl as TableName) ?? []), r]);
  }
  for (const [name, list] of byTable) {
    const table = database.table(name);
    const deletes = list.filter((r) => r.deleted).map((r) => r.rid);
    let puts = list.filter((r) => !r.deleted && r.row).map((r) => r.row as Record<string, unknown>);
    // Le mot de passe du relais reste celui de l'appareil.
    if (name === 'settings') puts = puts.map((s) => ({ ...s, bridgePassword: localSettings?.bridgePassword ?? '' }));
    if (deletes.length) await table.bulkDelete(deletes);
    if (puts.length) await table.bulkPut(puts);
  }
}

export function dexieStore(database: BudgetDB = db): LocalStore {
  return {
    app: 'finances',
    async pending(limit) {
      const entries = [...q()].slice(0, limit);
      const out: PendingChange[] = [];
      for (const [k, v] of entries) {
        const [tbl, rid] = k.split(SEP);
        const row = await database.table(tbl).get(rid);
        out.push({ tbl, rid, ver: v.ver, updatedAt: v.at, row: row === undefined ? null : stripDeviceOnly(tbl as TableName, row) });
      }
      return out;
    },
    async ack(done) {
      for (const d of done) {
        const k = `${d.tbl}${SEP}${d.rid}`;
        if (q().get(k)?.ver === d.ver) q().delete(k);
      }
      saveQueue();
    },
    async apply(rows) {
      await inRemoteTransaction(database, () => putRows(database, rows));
    },
    async snapshot() {
      const out: { tbl: string; rid: string; row: unknown }[] = [];
      for (const name of TABLE_NAMES) {
        const table = database.table(name);
        const keyPath = table.schema.primKey.keyPath as string;
        for (const row of await table.toArray()) {
          const rid = String((row as Record<string, unknown>)[keyPath]);
          if (tracked(name, rid)) out.push({ tbl: name, rid, row: stripDeviceOnly(name, row) });
        }
      }
      return out;
    },
    async replace(rows) {
      await inRemoteTransaction(database, async () => {
        const password = ((await database.settings.get('main')) as Settings | undefined)?.bridgePassword ?? '';
        for (const name of TABLE_NAMES) {
          if (name === 'meta') await database.meta.bulkDelete([...SYNCED_META]);
          else await database.table(name).clear();
        }
        await putRows(database, rows);
        const s = (await database.settings.get('main')) as Settings | undefined;
        if (s) await database.settings.put({ ...s, bridgePassword: password });
      });
    },
    async clearPending() {
      q().clear();
      saveQueue();
    },
    async getState() {
      try {
        const raw = localStorage.getItem(STATE_KEY);
        return raw ? (JSON.parse(raw) as SyncState) : null;
      } catch {
        return null;
      }
    },
    async setState(state) {
      try {
        localStorage.setItem(STATE_KEY, JSON.stringify(state));
      } catch {
        /* sans stockage : l'appareil refera un envoi complet la prochaine fois */
      }
    },
  };
}
