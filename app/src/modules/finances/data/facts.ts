import Dexie, { type DBCore, type DBCoreMutateRequest, type Middleware, type Table } from 'dexie';
import type { LocalStore, PendingChange, RemoteRow, SyncState } from '@mylife/core/engine';

/**
 * La base des faits de MyFinances : comptes, opérations de la banque, connexions bancaires, placements, objectifs,
 * photos du patrimoine. C'est la base de l'app d'avant la V5 (`myfinances`), au même format : pendant la bascule
 * (étape M6), les deux apps la partagent, et ce que l'une y écrit, l'autre le voit. Son schéma ne change donc pas ici
 * (les chaînes ci-dessous sont celles de l'ancienne app, à l'identique). Les réglages du moteur vivent ailleurs
 * (`stateStore.ts`).
 *
 * Elle est synchronisée entre les appareils sous l'app `finances`, avec la même file de modifications et le même
 * repère que l'ancienne app (`mylife-queue-finances`, `mylife-sync-finances`) : un appareil déjà relié le reste.
 */
export const FACTS_DB = 'myfinances';

export interface RawTx {
  id: string;
  accountId: string;
  date: string;
  bookingDate: string | null;
  amount: number;
  currency: string;
  label: string;
  rawText: string;
  counterparty: string | null;
  counterpartyIban: string | null;
  pending: boolean;
  balanceAfter: number | null;
  categoryId: string | null;
  categorySource: 'rule' | 'manual' | 'transfer' | null;
  ruleId: string | null;
  person: string | null;
  transferPairId: string | null;
  note: string;
  source: 'enablebanking' | 'demo';
  externalId: string | null;
  mcc: string | null;
  createdAt: number;
  refundOf?: string | null;
}

export interface RawAccount {
  id: string;
  name: string;
  bank: string;
  iban: string | null;
  currency: string;
  source: 'enablebanking' | 'demo';
  connectionId: string | null;
  remoteUid: string | null;
  balance: number | null;
  balanceDate: string | null;
  lastSyncAt: number | null;
  lastSyncError: string | null;
  hidden: boolean;
  kind?: 'current' | 'savings' | 'card' | 'other';
  nickname?: string | null;
}

export interface RawConnection {
  id: string;
  aspspName: string;
  aspspCountry: string;
  validUntil: string;
  createdAt: number;
  status: 'active' | 'expired' | 'revoked' | 'error';
  accountIds: string[];
}

/** Les réglages de l'ancienne app : seuls ceux que la banque utilise sont lus ici ; le reste est gardé tel quel. */
export interface RawSettings {
  id: 'main';
  bridgePassword?: string;
  ebOwnApp?: { sealed: string; appId: string; name: string } | null;
  initialSyncDays?: number;
  autoSyncHours?: number;
  bankCountry?: string;
  [key: string]: unknown;
}

export const TABLE_NAMES = ['transactions', 'accounts', 'categories', 'rules', 'settings', 'connections', 'meta', 'portfolios', 'holdings', 'investmentOps', 'plans', 'goals', 'goalMoves', 'manualAssets', 'snapshots', 'recurring'] as const;
export type TableName = (typeof TABLE_NAMES)[number];

export class FactsDB extends Dexie {
  transactions!: Table<RawTx, string>;
  accounts!: Table<RawAccount, string>;
  connections!: Table<RawConnection, string>;
  settings!: Table<RawSettings, string>;
  meta!: Table<{ key: string; value: unknown }, string>;

  constructor(name = FACTS_DB) {
    super(name);
    this.version(1).stores({
      transactions: 'id, accountId, date, categoryId, source, [accountId+date]',
      accounts: 'id, source, connectionId',
      categories: 'id, order',
      rules: 'id, categoryId, priority',
      settings: 'id',
      connections: 'id, status',
      meta: 'key',
    });
    this.version(2).stores({
      portfolios: 'id, order',
      holdings: 'id, portfolioId',
      investmentOps: 'id, holdingId, date, planId',
      plans: 'id, holdingId',
      goals: 'id, order',
      goalMoves: 'id, goalId, date',
      manualAssets: 'id',
      snapshots: 'date',
      recurring: 'key',
    });
  }
}

// ---------------------------------------------------------------- suivi des modifications

const QUEUE_KEY = 'mylife-queue-finances';
const STATE_KEY = 'mylife-sync-finances';
/** Les entrées de `meta` qui sont des choix de l'utilisateur ; le reste est propre à l'appareil. */
const SYNCED_META = new Set(['exceptionalAllocations', 'savingsClosed', 'recurringSkips']);
const SEP = '\u0001';

type Queue = Map<string, { ver: number; at: number }>;
let queue: Queue | null = null;

function q(): Queue {
  if (queue) return queue;
  try {
    const raw = globalThis.localStorage?.getItem(QUEUE_KEY);
    queue = new Map(raw ? (JSON.parse(raw) as [string, { ver: number; at: number }][]) : []);
  } catch {
    queue = new Map();
  }
  return queue;
}

const listeners = new Set<() => void>();

function saveQueue(): void {
  try {
    globalThis.localStorage?.setItem(QUEUE_KEY, JSON.stringify([...q()]));
  } catch {
    /* stockage plein : la file reste en mémoire jusqu'à la prochaine synchro */
  }
  listeners.forEach((l) => l());
}

// L'ancienne app, dans un autre onglet, écrit dans la même file : on la relit plutôt que de l'écraser.
if (typeof window !== 'undefined')
  window.addEventListener('storage', (e) => {
    if (e.key === QUEUE_KEY || e.key === null) queue = null;
  });

/** Prévenu à chaque modification locale qui attend d'être envoyée. */
export function onFactsQueued(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const factsPending = (): number => q().size;

const synced = (name: string): name is TableName => (TABLE_NAMES as readonly string[]).includes(name);
const tracked = (table: string, key: unknown): boolean => synced(table) && (table !== 'meta' || SYNCED_META.has(String(key)));

function note(table: string, keys: unknown[]): void {
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

/** Les transactions qui appliquent des données venues du compte : leurs écritures ne sont pas renvoyées. */
const remote = new WeakSet<object>();
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Note chaque ligne réellement modifiée par cet appareil (une réécriture à l'identique ne compte pas). */
export const changeTracker: Middleware<DBCore> = {
  stack: 'dbcore',
  name: 'mylifeChangeTracker',
  create(down) {
    return {
      ...down,
      table(name) {
        const table = down.table(name);
        if (!synced(name)) return table;
        const keyPath = table.schema.primaryKey.keyPath as string;
        return {
          ...table,
          async mutate(req: DBCoreMutateRequest) {
            if (remote.has(req.trans as object)) return table.mutate(req);
            let keys: unknown[] = [];
            if (req.type === 'put' || req.type === 'add') {
              const values = req.values as Record<string, unknown>[];
              keys = req.keys ? [...req.keys] : values.map((v) => v[keyPath]);
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

export const facts = new FactsDB();
facts.use(changeTracker);

export async function getMeta<T>(key: string, database: FactsDB = facts): Promise<T | undefined> {
  return (await database.meta.get(key))?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown, database: FactsDB = facts): Promise<void> {
  await database.meta.put({ key, value });
}

const SETTINGS_DEFAULT = { initialSyncDays: 90, autoSyncHours: 6, bankCountry: 'FR' };
export interface BankSettings {
  bridgePassword: string;
  ebOwnApp: { sealed: string; appId: string; name: string } | null;
  initialSyncDays: number;
  autoSyncHours: number;
  bankCountry: string;
}

/** Ce que la banque lit des réglages (valeurs de départ si la ligne n'existe pas encore). */
export async function bankSettings(database: FactsDB = facts): Promise<BankSettings> {
  const s = await database.settings.get('main');
  return {
    bridgePassword: typeof s?.bridgePassword === 'string' ? s.bridgePassword : '',
    ebOwnApp: s?.ebOwnApp ?? null,
    initialSyncDays: typeof s?.initialSyncDays === 'number' && s.initialSyncDays > 0 ? s.initialSyncDays : SETTINGS_DEFAULT.initialSyncDays,
    autoSyncHours: typeof s?.autoSyncHours === 'number' ? s.autoSyncHours : SETTINGS_DEFAULT.autoSyncHours,
    bankCountry: typeof s?.bankCountry === 'string' && s.bankCountry ? s.bankCountry : SETTINGS_DEFAULT.bankCountry,
  };
}

// ---------------------------------------------------------------- les faits ont changé (banque, autre appareil)

const factListeners = new Set<() => void>();

/** Prévenu quand les faits ont changé sur cet appareil : le moteur relit et recalcule. */
export function onFactsChanged(fn: () => void): () => void {
  factListeners.add(fn);
  return () => factListeners.delete(fn);
}

export function factsChanged(): void {
  factListeners.forEach((l) => l());
}

// ---------------------------------------------------------------- synchro entre appareils

const stripDeviceOnly = (table: string, row: unknown): unknown => (table === 'settings' ? { ...(row as RawSettings), bridgePassword: '' } : row);

async function inRemoteTransaction(database: FactsDB, fn: () => Promise<void>): Promise<void> {
  await database.transaction('rw', TABLE_NAMES.map((n) => database.table(n)), async () => {
    remote.add(Dexie.currentTransaction.idbtrans as unknown as object);
    await fn();
  });
}

async function putRows(database: FactsDB, rows: RemoteRow[]): Promise<void> {
  const password = (await database.settings.get('main'))?.bridgePassword ?? '';
  const byTable = new Map<string, RemoteRow[]>();
  for (const r of rows) if (tracked(r.tbl, r.rid)) byTable.set(r.tbl, [...(byTable.get(r.tbl) ?? []), r]);
  for (const [name, list] of byTable) {
    const table = database.table(name);
    const deletes = list.filter((r) => r.deleted).map((r) => r.rid);
    let puts = list.filter((r) => !r.deleted && r.row).map((r) => r.row as Record<string, unknown>);
    // Le mot de passe du relais reste celui de l'appareil.
    if (name === 'settings') puts = puts.map((s) => ({ ...s, bridgePassword: password }));
    if (deletes.length) await table.bulkDelete(deletes);
    if (puts.length) await table.bulkPut(puts);
  }
}

export function factsStore(database: FactsDB = facts): LocalStore {
  return {
    app: 'finances',
    async pending(limit) {
      const out: PendingChange[] = [];
      for (const [k, v] of [...q()].slice(0, limit)) {
        const [tbl, rid] = k.split(SEP) as [string, string];
        const row = await database.table(tbl).get(rid);
        out.push({ tbl, rid, ver: v.ver, updatedAt: v.at, row: row === undefined ? null : stripDeviceOnly(tbl, row) });
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
      if (rows.length) factsChanged();
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
        const password = (await database.settings.get('main'))?.bridgePassword ?? '';
        for (const name of TABLE_NAMES) {
          if (name === 'meta') await database.meta.bulkDelete([...SYNCED_META]);
          else await database.table(name).clear();
        }
        await putRows(database, rows);
        const s = await database.settings.get('main');
        if (s) await database.settings.put({ ...s, bridgePassword: password });
      });
      factsChanged();
    },
    async clearPending() {
      q().clear();
      saveQueue();
    },
    async forget() {
      // Les données d'un autre compte : tout part, mot de passe du relais compris, et les points de restauration
      // que l'ancienne app gardait pour lui.
      await inRemoteTransaction(database, async () => {
        for (const name of TABLE_NAMES) await database.table(name).clear();
      });
      q().clear();
      saveQueue();
      await Dexie.delete('myfinances-restore').catch(() => undefined);
      factsChanged();
    },
    async getState() {
      try {
        const raw = globalThis.localStorage?.getItem(STATE_KEY);
        return raw ? (JSON.parse(raw) as SyncState) : null;
      } catch {
        return null;
      }
    },
    async setState(state) {
      try {
        globalThis.localStorage?.setItem(STATE_KEY, JSON.stringify(state));
      } catch {
        /* sans stockage : l'appareil refera un envoi complet la prochaine fois */
      }
    },
  };
}
