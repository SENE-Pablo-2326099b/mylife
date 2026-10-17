import Dexie, { type EntityTable } from 'dexie';
import type { Account, Category, Connection, MetaEntry, Rule, Settings, Transaction } from './types';

export class BudgetDB extends Dexie {
  transactions!: EntityTable<Transaction, 'id'>;
  accounts!: EntityTable<Account, 'id'>;
  categories!: EntityTable<Category, 'id'>;
  rules!: EntityTable<Rule, 'id'>;
  settings!: EntityTable<Settings, 'id'>;
  connections!: EntityTable<Connection, 'id'>;
  meta!: EntityTable<MetaEntry, 'key'>;

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
  }
}

export const db = new BudgetDB();

export const TABLE_NAMES = ['transactions', 'accounts', 'categories', 'rules', 'settings', 'connections', 'meta'] as const;
export type TableName = (typeof TABLE_NAMES)[number];

export async function getMeta<T>(key: string, database: BudgetDB = db): Promise<T | undefined> {
  const entry = await database.meta.get(key);
  return entry?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown, database: BudgetDB = db): Promise<void> {
  await database.meta.put({ key, value });
}
