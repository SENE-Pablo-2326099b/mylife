import { db } from './db';
import { facts, factsChanged, TABLE_NAMES, type FactsDB, type RawSettings, type TableName } from './facts';
import { readState, writeState } from './stateStore';
import type { EngineState } from '../engine/state';

/**
 * Importer un fichier de données MyFinances : celui que fait « Exporter mes données » (faits + réglages du moteur),
 * ou une sauvegarde de l'app d'avant (faits seuls, y compris l'ancien format `budget-dodge-backup`).
 *
 * Deux façons :
 * - **ajouter** : les lignes du fichier s'ajoutent ; une ligne qui existe déjà (même identifiant, par exemple une
 *   opération bancaire déjà là) est remplacée par celle du fichier, jamais doublée ; rien n'est effacé ;
 * - **remplacer** : les données de MyFinances deviennent exactement celles du fichier (sur tous tes appareils).
 * Dans les deux cas, l'accès bancaire de cet appareil (mot de passe du relais, application) est gardé, et une copie
 * de ce qu'il y avait avant est gardée sur l'appareil pour pouvoir annuler juste après.
 */
export const FORMATS = ['myfinances-backup', 'budget-dodge-backup'];
const MAX_VERSION = 2;
const UNDO_KEY = 'importUndo';

export interface ImportFile {
  exportedAt: string | null;
  tables: Partial<Record<TableName, unknown[]>>;
  engine: EngineState | null;
}

export interface ImportSummary {
  exportedAt: string | null;
  transactions: number;
  accounts: number;
  placements: number;
  goals: number;
  hasEngine: boolean;
  /** Opérations du fichier qui ne sont pas encore sur cet appareil. */
  newTransactions: number;
}

export class ImportError extends Error {}

/** Lit et vérifie un fichier ; une erreur dit précisément ce qui ne va pas. */
export function readImport(text: string): ImportFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ImportError('Fichier illisible : ce n’est pas un fichier JSON.');
  }
  if (!data || typeof data !== 'object') throw new ImportError('Fichier illisible.');
  const b = data as { format?: unknown; version?: unknown; tables?: unknown; exportedAt?: unknown; engine?: unknown };
  if (typeof b.format !== 'string' || !FORMATS.includes(b.format)) throw new ImportError('Ce fichier n’est pas un export de MyFinances.');
  if (typeof b.version !== 'number' || b.version > MAX_VERSION) throw new ImportError('Ce fichier vient d’une version plus récente de MyFinances.');
  if (!b.tables || typeof b.tables !== 'object') throw new ImportError('Fichier incomplet : il n’y a pas de données dedans.');
  const tables: ImportFile['tables'] = {};
  for (const name of TABLE_NAMES) {
    const t = (b.tables as Record<string, unknown>)[name];
    if (t === undefined) continue;
    if (!Array.isArray(t)) throw new ImportError(`Fichier abîmé : la table « ${name} » est illisible.`);
    tables[name] = t;
  }
  for (const t of (tables.transactions ?? []) as Record<string, unknown>[]) {
    if (typeof t.id !== 'string' || typeof t.date !== 'string' || !Number.isInteger(t.amount)) throw new ImportError('Fichier abîmé : une opération est illisible (montants attendus en centimes).');
  }
  const engine = b.engine && typeof b.engine === 'object' && (b.engine as { version?: unknown }).version === 1 ? (b.engine as EngineState) : null;
  return { exportedAt: typeof b.exportedAt === 'string' ? b.exportedAt : null, tables, engine };
}

export async function summarize(file: ImportFile, database: FactsDB = facts): Promise<ImportSummary> {
  const txs = (file.tables.transactions ?? []) as { id: string }[];
  const known = new Set((await database.transactions.toCollection().primaryKeys()) as string[]);
  return {
    exportedAt: file.exportedAt,
    transactions: txs.length,
    accounts: file.tables.accounts?.length ?? 0,
    placements: file.tables.portfolios?.length ?? 0,
    goals: file.tables.goals?.length ?? 0,
    hasEngine: !!file.engine,
    newTransactions: txs.filter((t) => !known.has(t.id)).length,
  };
}

interface Snapshot {
  tables: Partial<Record<TableName, unknown[]>>;
  engine: EngineState | null;
  at: number;
}

async function snapshot(database: FactsDB): Promise<Snapshot> {
  const tables: Snapshot['tables'] = {};
  for (const name of TABLE_NAMES) tables[name] = await database.table(name).toArray();
  return { tables, engine: (await readState()) ?? null, at: Date.now() };
}

/** Écrit des tables : en remplaçant tout, ou en ajoutant ; l'accès bancaire de cet appareil est toujours gardé. */
async function writeTables(database: FactsDB, tables: Partial<Record<TableName, unknown[]>>, replace: boolean): Promise<void> {
  const keep = await database.settings.get('main');
  await database.transaction('rw', TABLE_NAMES.map((n) => database.table(n)), async () => {
    for (const name of TABLE_NAMES) {
      let rows = tables[name] ?? [];
      if (name === 'meta') rows = (rows as { key: string }[]).filter((m) => m.key !== 'pendingAuth');
      if (replace) await database.table(name).clear();
      if (rows.length) await database.table(name).bulkPut(rows);
    }
    const s = (await database.settings.get('main')) as RawSettings | undefined;
    if (keep && s) await database.settings.put({ ...s, bridgePassword: keep.bridgePassword, ebOwnApp: keep.ebOwnApp, initialSyncDays: s.initialSyncDays ?? keep.initialSyncDays });
    else if (keep && !s) await database.settings.put(keep);
  });
}

/**
 * Importe. `replace` : remplacer toutes les données ; sinon ajouter. Les réglages du moteur du fichier remplacent
 * ceux de l'appareil quand on remplace, ou quand l'appareil n'en a pas encore ; sinon, ceux de l'appareil restent.
 */
export async function applyImport(file: ImportFile, replace: boolean, database: FactsDB = facts): Promise<void> {
  await db.meta.put({ key: UNDO_KEY, value: await snapshot(database) });
  await writeTables(database, file.tables, replace);
  const current = await readState();
  if (file.engine && (replace || !current)) await writeState(file.engine, { touched: true, before: current });
  factsChanged();
}

/** Ce qu'il y avait avant le dernier import, s'il y en a un à annuler. */
export async function lastImportUndo(): Promise<number | null> {
  const v = (await db.meta.get(UNDO_KEY))?.value as Snapshot | undefined;
  return v?.at ?? null;
}

/** Annule le dernier import : les données redeviennent celles d'avant (sur tous tes appareils). */
export async function undoImport(database: FactsDB = facts): Promise<boolean> {
  const v = (await db.meta.get(UNDO_KEY))?.value as Snapshot | undefined;
  if (!v) return false;
  await writeTables(database, v.tables, true);
  const current = await readState();
  if (v.engine) await writeState(v.engine, { touched: true, before: current });
  await db.meta.delete(UNDO_KEY);
  factsChanged();
  return true;
}
