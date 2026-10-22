import { describe, expect, it } from 'vitest';
import { categoryBreakdown, summarize } from '../src/domain/cycleStats';
import { CAT, DEFAULT_CATEGORIES } from '../src/domain/defaults';
import { tx } from './helpers';

const cats = new Map(DEFAULT_CATEGORIES.map((c) => [c.id, c]));
const cycle = { start: '2026-09-26', end: '2026-10-25' };
const prev = { start: '2026-08-26', end: '2026-09-25' };
const txs = [
  tx({ id: '1', amount: -6000, date: '2026-10-01', categoryId: CAT.courses }),
  tx({ id: '2', amount: -2000, date: '2026-10-02', categoryId: CAT.livraison }),
  tx({ id: '3', amount: -2000, date: '2026-10-03', categoryId: CAT.abonnements }),
  tx({ id: '4', amount: -45000, date: '2026-09-27', categoryId: CAT.epargne }),
  tx({ id: '5', amount: 153700, date: '2026-09-26', categoryId: CAT.revenus }),
  tx({ id: '6', amount: -1000, date: '2026-10-04' }),
  tx({ id: '7', amount: -4000, date: '2026-09-10', categoryId: CAT.courses }),
];

describe('cycle', () => {
  it('répartition par catégorie avec % et cycle précédent', () => {
    const lines = categoryBreakdown(txs, cats, cycle, prev);
    expect(lines.map((l) => [l.id, l.spent, l.percent, l.previous])).toEqual([
      [CAT.courses, 6000, 55, 4000],
      [CAT.livraison, 2000, 18, 0],
      [CAT.abonnements, 2000, 18, 0],
      ['_none', 1000, 9, 0],
    ]);
  });

  it('part de la nourriture', () => {
    const s = summarize(txs, cats, cycle);
    expect(s).toMatchObject({ total: 11000, variable: 9000, fixed: 2000, food: 8000, foodPercent: 73, income: 153700, length: 30 });
  });

  it('comparaison au même stade', () => {
    expect(summarize(txs, cats, cycle, '2026-10-01').total).toBe(6000);
    expect(summarize(txs, cats, cycle, '2026-10-01').daysElapsed).toBe(6);
  });
});
