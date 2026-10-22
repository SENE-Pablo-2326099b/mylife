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

  constructor(name = 'budget-dodge') {
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
