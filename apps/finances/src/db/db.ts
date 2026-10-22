import Dexie, { type EntityTable } from 'dexie';
import type {
  Account,
  Category,
  Connection,
  Goal,
  GoalMove,
  Holding,
  InvestmentOp,
  InvestmentPlan,
  ManualAsset,
  MetaEntry,
  Portfolio,
  RecurringOverride,
  Rule,
  Settings,
  Snapshot,
  Transaction,
} from './types';

/** Nom de la base locale ; `LEGACY_DB_NAME` : celui d'avant, repris une fois (`migrateLegacyDatabase`). */
export const DB_NAME = 'myfinances';
const LEGACY_DB_NAME = 'budget-dodge';

export class BudgetDB extends Dexie {
  transactions!: EntityTable<Transaction, 'id'>;
  accounts!: EntityTable<Account, 'id'>;
  categories!: EntityTable<Category, 'id'>;
  rules!: EntityTable<Rule, 'id'>;
  settings!: EntityTable<Settings, 'id'>;
  connections!: EntityTable<Connection, 'id'>;
  meta!: EntityTable<MetaEntry, 'key'>;
  portfolios!: EntityTable<Portfolio, 'id'>;
  holdings!: EntityTable<Holding, 'id'>;
  investmentOps!: EntityTable<InvestmentOp, 'id'>;
  plans!: EntityTable<InvestmentPlan, 'id'>;
  goals!: EntityTable<Goal, 'id'>;
  goalMoves!: EntityTable<GoalMove, 'id'>;
  manualAssets!: EntityTable<ManualAsset, 'id'>;
  snapshots!: EntityTable<Snapshot, 'date'>;
  recurring!: EntityTable<RecurringOverride, 'key'>;

  constructor(name = DB_NAME) {
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
    // v2 : patrimoine (placements, plans, objectifs, autres actifs, historique) et récurrences.
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

export const db = new BudgetDB();

/**
 * Base d'avant le nom MyFinances encore présente sur l'appareil : ses données passent dans la base actuelle,
 * puis elle est supprimée. La copie passe par une instance à part, hors du suivi de la synchro : rien n'est
 * renvoyé au compte, les modifications en attente restent celles d'avant.
 */
export async function migrateLegacyDatabase(target = DB_NAME, legacy = LEGACY_DB_NAME): Promise<boolean> {
  if (!(await Dexie.exists(legacy))) return false;
  const from = new BudgetDB(legacy);
  const to = new BudgetDB(target);
  try {
    for (const name of TABLE_NAMES) {
      const rows = await from.table(name).toArray();
      if (rows.length) await to.table(name).bulkPut(rows);
    }
  } finally {
    from.close();
    to.close();
  }
  await Dexie.delete(legacy);
  return true;
}

export const TABLE_NAMES = [
  'transactions',
  'accounts',
  'categories',
  'rules',
  'settings',
  'connections',
  'meta',
  'portfolios',
  'holdings',
  'investmentOps',
  'plans',
  'goals',
  'goalMoves',
  'manualAssets',
  'snapshots',
  'recurring',
] as const;
export type TableName = (typeof TABLE_NAMES)[number];

export async function getMeta<T>(key: string, database: BudgetDB = db): Promise<T | undefined> {
  const entry = await database.meta.get(key);
  return entry?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown, database: BudgetDB = db): Promise<void> {
  await database.meta.put({ key, value });
}
