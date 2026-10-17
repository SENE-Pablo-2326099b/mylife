import { db, type BudgetDB } from '../db/db';
import type { Rule } from '../db/types';
import { titleCase, uid } from '../lib/text';
import { classifyTransactions, setManualCategory } from './classifyDb';
import { CAT } from './defaults';
import { compileRules, findMatchingRule } from './rules';

/** Priorité des règles créées depuis une correction : au-dessus des commerçants par défaut, sous transferts / épargne. */
export const USER_RULE_PRIORITY = 25;

export type LearnMode = 'only' | 'create' | 'update';

export interface LearnInput {
  txId: string;
  categoryId: string;
  mode: LearnMode;
  keyword?: string;
  person?: string | null;
}

export function newRule(partial: Partial<Rule> & Pick<Rule, 'categoryId' | 'pattern'>): Rule {
  return {
    id: uid('r'),
    isRegex: false,
    direction: 'any',
    minAmount: null,
    maxAmount: null,
    person: null,
    priority: USER_RULE_PRIORITY,
    label: titleCase(partial.pattern),
    enabled: true,
    createdAt: Date.now(),
    ...partial,
  };
}

/**
 * Correction manuelle d'une opération, avec option d'apprentissage :
 * - only   : seulement cette opération
 * - create : crée une règle « mot-clé → catégorie » et l'applique aux autres opérations
 * - update : change la catégorie de la règle qui avait classé l'opération
 * Renvoie le nombre d'autres opérations reclassées.
 */
export async function learnFromCorrection(input: LearnInput, database: BudgetDB = db): Promise<number> {
  const tx = await database.transactions.get(input.txId);
  if (!tx) return 0;
  const person = input.categoryId === CAT.remboursements ? (input.person ?? tx.person ?? tx.counterparty) : null;
  await setManualCategory(input.txId, input.categoryId, database, person);
  if (input.mode === 'only') return 0;

  if (input.mode === 'update' && tx.ruleId) {
    const rule = await database.rules.get(tx.ruleId);
    if (rule) await database.rules.put({ ...rule, categoryId: input.categoryId, person: input.categoryId === CAT.remboursements ? person : null });
  } else {
    const keyword = (input.keyword ?? '').trim();
    if (!keyword) return 0;
    await database.rules.put(newRule({ categoryId: input.categoryId, pattern: keyword, person }));
  }
  const res = await classifyTransactions(database);
  return res.changed;
}

/** Nombre d'opérations qu'une règle classerait (aperçu dans l'éditeur). */
export async function countRuleMatches(rule: Rule, database: BudgetDB = db): Promise<number> {
  const compiled = compileRules([{ ...rule, enabled: true }]);
  if (!compiled.length) return 0;
  const all = await database.transactions.toArray();
  return all.filter((t) => findMatchingRule(compiled, t)).length;
}
