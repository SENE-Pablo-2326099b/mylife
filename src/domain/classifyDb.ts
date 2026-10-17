import { db, type BudgetDB } from '../db/db';
import type { Rule, Transaction } from '../db/types';
import { addDays } from '../lib/dates';
import { classifyBatch, type ClassifyContext } from './classify';
import { TRANSFER_WINDOW_DAYS } from './transfers';

async function loadContext(database: BudgetDB): Promise<ClassifyContext> {
  const [rules, accounts] = await Promise.all([database.rules.toArray(), database.accounts.toArray()]);
  const ownIbans = new Set(accounts.map((a) => a.iban).filter((i): i is string => !!i));
  return { rules, ownIbans };
}

/**
 * Classe automatiquement des opérations (toutes si `ids` est absent) et associe les transferts internes.
 * Les corrections manuelles sont toujours conservées.
 */
export async function classifyTransactions(database: BudgetDB = db, ids?: string[]): Promise<{ changed: number; unclassified: number }> {
  const ctx = await loadContext(database);
  let targets: Transaction[];
  let context: Transaction[];
  if (ids) {
    if (ids.length === 0) return { changed: 0, unclassified: 0 };
    targets = (await database.transactions.bulkGet(ids)).filter((t): t is Transaction => !!t);
    if (targets.length === 0) return { changed: 0, unclassified: 0 };
    const dates = targets.map((t) => t.date).sort();
    const from = addDays(dates[0], -TRANSFER_WINDOW_DAYS);
    const to = addDays(dates[dates.length - 1], TRANSFER_WINDOW_DAYS);
    context = await database.transactions.where('date').between(from, to, true, true).toArray();
  } else {
    targets = await database.transactions.toArray();
    context = targets;
  }
  const changed = classifyBatch(targets, context, ctx);
  if (changed.length) await database.transactions.bulkPut(changed);
  const after = new Map(changed.map((t) => [t.id, t]));
  const unclassified = targets.filter((t) => (after.get(t.id) ?? t).categoryId === null).length;
  return { changed: changed.length, unclassified };
}

/** Correction manuelle d'une opération (jamais écrasée par les règles). */
export async function setManualCategory(txId: string, categoryId: string | null, database: BudgetDB = db, person?: string | null): Promise<void> {
  const tx = await database.transactions.get(txId);
  if (!tx) return;
  await database.transactions.update(txId, {
    categoryId,
    categorySource: categoryId ? 'manual' : null,
    ruleId: null,
    person: person !== undefined ? person : categoryId === 'remboursements' ? tx.person ?? tx.counterparty : null,
  });
  // Re-calcule les appariements de transferts autour de cette opération.
  await classifyTransactions(database, [txId]);
}

/** Rend une opération au classement automatique. */
export async function resetToAuto(txId: string, database: BudgetDB = db): Promise<void> {
  await database.transactions.update(txId, { categorySource: null, categoryId: null, ruleId: null });
  await classifyTransactions(database, [txId]);
}

export async function saveRule(rule: Rule, database: BudgetDB = db): Promise<void> {
  await database.rules.put(rule);
}

/** Réapplique toutes les règles à toutes les opérations (corrections manuelles conservées). */
export async function reapplyRules(database: BudgetDB = db): Promise<{ changed: number; unclassified: number }> {
  return classifyTransactions(database);
}
