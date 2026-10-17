import type { Category, Transaction } from '../db/types';
import { cycleLength, diffDays, type Cycle } from '../lib/dates';
import { isSpending, isVariable, spent, type CatMap } from './budget';

export interface CategoryLine {
  category: Category | null;
  id: string;
  spent: number;
  /** Part du total des dépenses du cycle, en %. */
  percent: number;
  previous: number;
  count: number;
}

const UNCLASSIFIED: Category = { id: '_none', name: 'À classer', emoji: '❔', color: '#8a8a85', kind: 'variable', target: null, isFood: false, order: 999 };

function within(txs: Transaction[], cycle: Cycle, until?: string): Transaction[] {
  const end = until && until < cycle.end ? until : cycle.end;
  return txs.filter((t) => t.date >= cycle.start && t.date <= end);
}

/** Dépenses par catégorie (courantes + charges fixes), triées par montant. */
export function categoryBreakdown(txs: Transaction[], cats: CatMap, cycle: Cycle, previous: Cycle | null): CategoryLine[] {
  const cur = within(txs, cycle).filter((t) => isSpending(t, cats));
  const prev = previous ? within(txs, previous).filter((t) => isSpending(t, cats)) : [];
  const total = spent(cur, cats, isSpending);
  const byCat = new Map<string, CategoryLine>();
  const line = (id: string): CategoryLine => {
    let l = byCat.get(id);
    if (!l) {
      l = { id, category: id === '_none' ? UNCLASSIFIED : (cats.get(id) ?? null), spent: 0, percent: 0, previous: 0, count: 0 };
      byCat.set(id, l);
    }
    return l;
  };
  for (const t of cur) {
    const l = line(t.categoryId ?? '_none');
    l.spent -= t.amount;
    l.count++;
  }
  for (const t of prev) line(t.categoryId ?? '_none').previous -= t.amount;
  const lines = [...byCat.values()].filter((l) => l.spent !== 0 || l.previous !== 0);
  for (const l of lines) l.percent = total > 0 ? Math.round((l.spent * 100) / total) : 0;
  return lines.sort((a, b) => b.spent - a.spent || b.previous - a.previous);
}

export interface CycleSummary {
  variable: number;
  fixed: number;
  total: number;
  food: number;
  /** Part de la nourriture dans le total des dépenses, en %. */
  foodPercent: number;
  income: number;
  daysElapsed: number;
  length: number;
}

export function summarize(txs: Transaction[], cats: CatMap, cycle: Cycle, until?: string): CycleSummary {
  const cur = within(txs, cycle, until);
  const variable = spent(cur, cats, isVariable);
  const total = spent(cur, cats, isSpending);
  const food = spent(
    cur.filter((t) => t.categoryId && cats.get(t.categoryId)?.isFood),
    cats,
    isSpending,
  );
  const income = cur.filter((t) => t.categoryId && cats.get(t.categoryId)?.kind === 'income').reduce((s, t) => s + t.amount, 0);
  const endDay = until && until < cycle.end ? until : cycle.end;
  return {
    variable,
    fixed: total - variable,
    total,
    food,
    foodPercent: total > 0 ? Math.round((food * 100) / total) : 0,
    income,
    daysElapsed: Math.max(0, diffDays(cycle.start, endDay) + 1),
    length: cycleLength(cycle),
  };
}
