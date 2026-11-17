import { mergeImport, migrate, type OldDump } from '../core/migrate';
import type { FinanceData } from '../core/model';
import { db, loadAll, saveAll } from './db';
import { facts, type FactsDB } from './facts';

/**
 * Passe les faits (base `myfinances`, partagée avec l'ancienne app le temps de la bascule : `facts.ts`) dans le modèle
 * de l'étape 3.3, d'où le moteur les lit. Rejouable à chaque ouverture et après chaque synchro.
 */
const TABLES = ['transactions', 'accounts', 'categories', 'portfolios', 'holdings', 'investmentOps', 'plans', 'goals', 'goalMoves', 'manualAssets', 'snapshots'] as const;

/** Le contenu de la base des faits. */
export async function readOld(database: FactsDB = facts): Promise<OldDump | null> {
  const dump: Record<string, unknown> = {};
  for (const t of TABLES) dump[t] = await database.table(t).toArray();
  dump.settings = (await database.settings.get('main')) ?? null;
  return dump as OldDump;
}

export interface ImportResult {
  /** Rien à reprendre : l'ancienne app n'a jamais servi sur cet appareil. */
  empty: boolean;
  data: FinanceData;
  at: number;
}

export async function importOld(): Promise<ImportResult> {
  const dump = await readOld();
  const existing = await loadAll();
  if (!dump || !(dump.transactions?.length || dump.accounts?.length || dump.portfolios?.length)) return { empty: true, data: existing, at: Date.now() };
  const fresh = migrate(dump);
  const hasWork = existing.movements.length > 0 || existing.merchants.length > 0;
  const data = hasWork ? mergeImport(existing, fresh) : fresh;
  await saveAll(data);
  const at = Date.now();
  await db.meta.put({ key: 'importedAt', value: at });
  return { empty: false, data, at };
}

export async function lastImport(): Promise<number | null> {
  const v = (await db.meta.get('importedAt'))?.value;
  return typeof v === 'number' ? v : null;
}
