import { describe, expect, it } from 'vitest';
import { CAT, DEFAULT_CATEGORIES } from '../src/domain/defaults';
import { biggestExpenses, cycleHeatmap, cycleHistory, topMerchants, weekdayProfile } from '../src/domain/cycleInsights';
import { tx } from './helpers';

const cats = new Map(DEFAULT_CATEGORIES.map((c) => [c.id, c]));
const cycle = { start: '2026-10-01', end: '2026-10-31' };
const txs = [
  tx({ id: 'a', date: '2026-10-03', amount: -3000, label: 'Carrefour', categoryId: CAT.courses }), // samedi
  tx({ id: 'b', date: '2026-10-10', amount: -5000, label: 'CARREFOUR', categoryId: CAT.courses }), // samedi
  tx({ id: 'c', date: '2026-10-05', amount: -1200, label: 'Boulangerie', categoryId: CAT.restos }), // lundi
  tx({ id: 'd', date: '2026-10-06', amount: -50000, label: 'Loyer', categoryId: CAT.logement }),
  tx({ id: 'e', date: '2026-10-07', amount: 200000, label: 'Salaire', categoryId: CAT.revenus }),
  tx({ id: 'f', date: '2026-10-08', amount: -10000, label: 'Virement Livret', categoryId: CAT.epargne }),
];

describe('statistiques du cycle', () => {
  it('calendrier : une case par jour, les jours à venir vides', () => {
    const days = cycleHeatmap(txs, cats, cycle, 60000, '2026-10-12');
    expect(days).toHaveLength(31);
    expect(days.find((d) => d.date === '2026-10-03')!.spent).toBe(3000);
    expect(days.filter((d) => d.future)).toHaveLength(19);
    // Loyer (charge fixe), salaire et épargne ne sont pas de la vie courante.
    expect(days.find((d) => d.date === '2026-10-06')!.spent).toBe(0);
  });

  it('jours de la semaine : moyenne par jour, lundi d’abord', () => {
    const p = weekdayProfile(txs, cats, '2026-10-01', '2026-10-14');
    expect(p).toHaveLength(7);
    expect(p[5]!.total).toBe(8000); // samedi
    expect(p[5]!.days).toBe(2);
    expect(p[5]!.average).toBe(4000);
    expect(p[0]!.average).toBe(600); // lundi : 12 € sur deux lundis
  });

  it('historique, commerçants (libellés regroupés sans casse), plus grosses dépenses', () => {
    expect(cycleHistory(txs, cats, [cycle], () => 60000)[0]).toMatchObject({ spent: 9200, envelope: 60000 });
    const m = topMerchants(txs, cats, cycle.start, cycle.end);
    expect(m[0]).toMatchObject({ label: 'Loyer', total: 50000 });
    expect(m[1]).toMatchObject({ total: 8000, count: 2 });
    expect(m.some((x) => x.label === 'Salaire' || x.label === 'Virement Livret')).toBe(false);
    expect(biggestExpenses(txs, cats, cycle.start, cycle.end, 2).map((t) => t.id)).toEqual(['d', 'b']);
  });
});
