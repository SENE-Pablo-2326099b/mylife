import type { Rule, Transaction } from '../db/types';
import { CAT } from './defaults';
import { compileRules, findMatchingRule } from './rules';
import { isOwnAccount, pairTransfers } from './transfers';

type Classification = Pick<Transaction, 'categoryId' | 'categorySource' | 'ruleId' | 'person'>;

export interface ClassifyContext {
  rules: Rule[];
  ownIbans: Set<string>;
  transferCategoryId?: string;
  refundCategoryId?: string;
}

/** Classement d'une opération (hors correction manuelle). */
export function classifyOne(tx: Transaction, compiled: ReturnType<typeof compileRules>, ctx: ClassifyContext): Classification {
  const transferCat = ctx.transferCategoryId ?? CAT.transferts;
  if (isOwnAccount(tx.counterpartyIban, ctx.ownIbans)) {
    return { categoryId: transferCat, categorySource: 'transfer', ruleId: null, person: null };
  }
  const rule = findMatchingRule(compiled, tx);
  if (rule) {
    const refundCat = ctx.refundCategoryId ?? CAT.remboursements;
    const person = rule.person ?? (rule.categoryId === refundCat ? tx.counterparty : null);
    return { categoryId: rule.categoryId, categorySource: 'rule', ruleId: rule.id, person };
  }
  return { categoryId: null, categorySource: null, ruleId: null, person: null };
}

/**
 * Classe un ensemble d'opérations et associe les transferts internes.
 * - `targets` : opérations à (re)classer ; les corrections manuelles ne sont jamais écrasées.
 * - `context` : opérations voisines (autres comptes) utilisées pour trouver la contrepartie d'un transfert.
 * Renvoie uniquement les opérations modifiées.
 */
export function classifyBatch(targets: Transaction[], context: Transaction[], ctx: ClassifyContext): Transaction[] {
  const compiled = compileRules(ctx.rules);
  const transferCat = ctx.transferCategoryId ?? CAT.transferts;
  const byId = new Map<string, Transaction>();
  for (const t of context) byId.set(t.id, { ...t });
  for (const t of targets) byId.set(t.id, { ...(byId.get(t.id) ?? t) });

  const changed = new Set<string>();
  const targetIds = new Set(targets.map((t) => t.id));

  for (const id of targetIds) {
    const tx = byId.get(id)!;
    if (tx.categorySource === 'manual') continue;
    const c = classifyOne(tx, compiled, ctx);
    // Une jambe de transfert déjà appariée garde son statut tant qu'aucune règle ne dit autre chose.
    if (tx.transferPairId && c.categoryId === null) continue;
    if (tx.categoryId !== c.categoryId || tx.categorySource !== c.categorySource || tx.ruleId !== c.ruleId || tx.person !== c.person) {
      Object.assign(tx, c);
      changed.add(id);
    }
  }

  // Une opération qui n'est plus un transfert perd son appariement (et sa contrepartie aussi).
  for (const tx of byId.values()) {
    if (tx.transferPairId && tx.categoryId !== transferCat) {
      for (const other of byId.values()) {
        if (other.id !== tx.id && other.transferPairId === tx.transferPairId) {
          other.transferPairId = null;
          if (other.categorySource === 'transfer') Object.assign(other, classifyOne(other, compiled, ctx));
          changed.add(other.id);
        }
      }
      tx.transferPairId = null;
      changed.add(tx.id);
    }
  }

  for (const [a, b] of pairTransfers([...byId.values()], transferCat)) {
    const pairId = `pair:${a}`;
    for (const id of [a, b]) {
      const tx = byId.get(id)!;
      tx.transferPairId = pairId;
      if (tx.categoryId !== transferCat) {
        tx.categoryId = transferCat;
        tx.categorySource = 'transfer';
        tx.ruleId = null;
        tx.person = null;
      }
      changed.add(id);
    }
  }

  return [...changed].map((id) => byId.get(id)!);
}
