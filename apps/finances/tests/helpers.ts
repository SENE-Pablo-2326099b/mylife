import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BudgetDB } from '../src/db/db';
import type { Transaction } from '../src/db/types';
import { ensureSeeded } from '../src/db/seed';

export function sample<T>(name: string): T {
  return JSON.parse(readFileSync(join(__dirname, '..', 'samples', 'enablebanking', name), 'utf8')) as T;
}

let counter = 0;
export async function freshDb(): Promise<BudgetDB> {
  const database = new BudgetDB(`test-${Date.now()}-${counter++}`);
  await ensureSeeded(database);
  return database;
}

export function tx(partial: Partial<Transaction> & Pick<Transaction, 'id' | 'amount' | 'date'>): Transaction {
  return {
    accountId: 'a',
    bookingDate: null,
    currency: 'EUR',
    label: partial.label ?? 'Opération',
    rawText: partial.rawText ?? partial.label ?? 'Opération',
    counterparty: null,
    counterpartyIban: null,
    pending: false,
    balanceAfter: null,
    categoryId: null,
    categorySource: null,
    ruleId: null,
    person: null,
    transferPairId: null,
    note: '',
    source: 'enablebanking',
    externalId: null,
    mcc: null,
    createdAt: 0,
    ...partial,
  };
}
