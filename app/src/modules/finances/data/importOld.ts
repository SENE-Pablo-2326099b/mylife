import Dexie from 'dexie';
import { mergeImport, migrate, type OldDump } from '../core/migrate';
import type { FinanceData } from '../core/model';
import { db, loadAll, saveAll } from './db';

/**
 * Reprend les données de l'ancienne app MyFinances (base locale `myfinances`, sur le même appareil) dans la base V5.
 * L'ancienne base est seulement lue. Rejouable : ce qui a été fait dans le nouveau module est gardé (`mergeImport`).
 */
const OLD_DB = 'myfinances';
const TABLES = ['transactions', 'accounts', 'categories', 'portfolios', 'holdings', 'investmentOps', 'plans', 'goals', 'goalMoves', 'manualAssets', 'snapshots'] as const;

/** Le contenu de l'ancienne base, ou null si elle n'existe pas sur cet appareil. */
export async function readOld(): Promise<OldDump | null> {
  if (!(await Dexie.exists(OLD_DB))) return null;
  const old = new Dexie(OLD_DB);
  try {
    await old.open();
    const names = new Set(old.tables.map((t) => t.name));
    const dump: Record<string, unknown> = {};
    for (const t of TABLES) dump[t] = names.has(t) ? await old.table(t).toArray() : [];
    dump.settings = names.has('settings') ? ((await old.table('settings').get('main')) ?? null) : null;
    return dump as OldDump;
  } finally {
    old.close();
  }
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
