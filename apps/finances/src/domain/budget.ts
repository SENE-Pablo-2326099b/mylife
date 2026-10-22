import type { Transaction } from '../db/types';
import { isVariable, type CatMap } from './budgetEngine';

/** Briques communes du budget ; le calcul complet est dans budgetEngine.ts. */
export { computeBudget, daySeries as dailySeries, isVariable, statusFor, type BudgetState, type BudgetStatus as Status, type CatMap, type DayPoint } from './budgetEngine';

/** Une opération est-elle une dépense du cycle (courante ou charge fixe) ? */
export function isSpending(tx: Pick<Transaction, 'categoryId' | 'amount'>, cats: CatMap): boolean {
  if (tx.categoryId === null) return tx.amount < 0;
  const kind = cats.get(tx.categoryId)?.kind;
  return kind === 'variable' || kind === 'fixed';
}

/** Montant dépensé (positif) ; un remboursement dans une catégorie de dépense vient en déduction. */
export function spent(txs: Pick<Transaction, 'categoryId' | 'amount'>[], cats: CatMap, filter: (t: Pick<Transaction, 'categoryId' | 'amount'>, c: CatMap) => boolean = isVariable): number {
  let total = 0;
  for (const t of txs) if (filter(t, cats)) total -= t.amount;
  return total;
}

/** Nombre de jours consécutifs (finissant au dernier jour de la série) où le budget du jour a été dépassé, et le record. */
export function overrunStreaks(points: { date: string; spent: number; budget: number }[]): { current: number; longest: number; longestEnd: string | null } {
  let current = 0;
  let longest = 0;
  let longestEnd: string | null = null;
  for (const p of points) {
    if (p.spent > p.budget) {
      current++;
      if (current > longest) {
        longest = current;
        longestEnd = p.date;
      }
    } else current = 0;
  }
  return { current, longest, longestEnd };
}
