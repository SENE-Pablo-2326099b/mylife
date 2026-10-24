import { describe, expect, it } from 'vitest';
import type { InvestmentPlan, Settings } from '../src/db/types';
import { computeBudget } from '../src/domain/budgetEngine';
import { CAT, DEFAULT_CATEGORIES, DEFAULT_SETTINGS } from '../src/domain/defaults';
import { buildForecast } from '../src/domain/forecast';
import { detectRecurring } from '../src/domain/recurring';
import { buildRecurringList, sameFlow, type RecurringSkips } from '../src/domain/recurringList';
import { tx } from './helpers';

const cats = new Map(DEFAULT_CATEGORIES.map((c) => [c.id, c]));
const TODAY = '2026-10-20';
const CYCLE = { start: '2026-09-25', end: '2026-10-24' };
let n = 0;
const monthly = (label: string, amount: number, day: number, months: number, categoryId: string | null, end = '2026-10') => {
  const [y, m] = end.split('-').map(Number) as [number, number];
  return Array.from({ length: months }, (_, i) => {
    const total = y * 12 + (m - 1) - i;
    const date = `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return tx({ id: `t${n++}`, date, amount, label, categoryId });
  });
};

// Paie le 25, loyer saisi SANS jour, virement mensuel vers Trade Republic (plan de 400 €) et un plan BTC de 100 €,
// un abonnement que les réglages ne connaissent pas, une APL versée directement.
const settings: Settings = {
  ...DEFAULT_SETTINGS,
  payday: 25,
  incomes: [
    { id: 'paie', label: 'Paie', amount: 170000, day: 25 },
    { id: 'apl', label: 'APL', amount: 20000, day: 5, direct: true },
  ],
  fixedCharges: [{ id: 'loyer', label: 'Loyer', amount: 25500, day: null }],
  savings: { mode: 'manual', manual: 50000 },
  envelopeOverride: null,
};
const plan = (id: string, amount: number, day: number, label: string) => ({ id, holdingId: id, amount, frequency: 'monthly', day, startDate: '2026-01-01', active: true, lastRunDate: null, createdAt: 0, label }) as InvestmentPlan & { label: string };
const plans = [plan('tr', 40000, 27, 'Investissement · ETF Monde'), plan('btc', 10000, 3, 'Investissement · Bitcoin')];
const txs = [
  ...monthly('VIR SALAIRE ACME', 170000, 25, 5, CAT.revenus, '2026-09'),
  ...monthly('PRLV FONCIA LOYER', -25500, 5, 5, CAT.logement),
  ...monthly('VIR TRADE REPUBLIC', -40000, 27, 5, CAT.epargne, '2026-09'),
  ...monthly('NETFLIX', -1399, 12, 5, CAT.abonnements),
];
const detected = detectRecurring(txs, cats, TODAY);
const list = (skips?: RecurringSkips) => buildRecurringList({ detected, cats, settings, plans, today: TODAY, cycle: CYCLE, txs, skips });

describe('une seule liste de récurrents (refonte, étape 3)', () => {
  it('chaque flux n’apparaît qu’une fois : réglages et plans rapprochés de ce qui est vu à la banque', () => {
    const items = list();
    expect(items.map((i) => [i.id, i.kind, i.source, i.detected?.label ?? null])).toEqual([
      ['line:paie', 'income', 'settings', 'VIR SALAIRE ACME'],
      ['line:apl', 'income', 'settings', null],
      ['line:loyer', 'charge', 'settings', 'PRLV FONCIA LOYER'],
      ['plan:tr', 'savings', 'plan', 'VIR TRADE REPUBLIC'],
      ['plan:btc', 'savings', 'plan', null],
      [expect.stringMatching(/^det:/), 'subscription', 'detected', 'NETFLIX'],
    ]);
    const loyer = items.find((i) => i.id === 'line:loyer')!;
    // Le loyer saisi sans jour prend celui constaté à la banque, et on sait qu'il est passé ce cycle.
    expect([loyer.day, loyer.nextDate, loyer.paid?.date]).toEqual([5, '2026-11-05', '2026-10-05']);
    expect(items.find((i) => i.id === 'plan:tr')!.paid?.date).toBe('2026-09-27');
    expect(items.find((i) => i.source === 'detected')!.confirmed).toBe(false);
  });

  it('la règle de rapprochement : montant à 10 % près au même moment du mois, ou libellé qui cite l’autre', () => {
    expect(sameFlow({ amount: 40000, day: 27 }, { amount: -41500, day: 28 })).toBe(true);
    expect(sameFlow({ amount: 40000, day: 27 }, { amount: -40000, day: 10 })).toBe(false);
    expect(sameFlow({ amount: 40000, day: 1 }, { amount: 40000, day: 30 })).toBe(true);
    expect(sameFlow({ amount: 25500, label: 'Loyer Foncia' }, { amount: 18000, label: 'PRLV FONCIA' })).toBe(true);
    expect(sameFlow({ amount: 25500, label: 'Loyer' }, { amount: 18000, label: 'PRLV AGENCE' })).toBe(false);
  });

  it('« sauter ce mois » : le BTC n’est plus attendu, ni dans l’épargne du cycle, ni dans la prévision', () => {
    const skips: RecurringSkips = { [CYCLE.start]: [{ id: 'plan:btc', kind: 'savings', amount: 10000 }] };
    const items = list(skips);
    expect(items.find((i) => i.id === 'plan:btc')!.skipped).toBe(true);
    const f = (s?: RecurringSkips) => buildForecast({ today: TODAY, until: '2026-11-06', startBalance: 0, recurring: detected, cats, settings, plans, dailySpend: 0, items: list(s), cycleEnd: CYCLE.end });
    // Le plan BTC tombe le 3 novembre, après ce cycle : il reste dans la prévision du cycle suivant.
    expect(f(skips).events.filter((e) => e.label.includes('Bitcoin')).map((e) => e.date)).toEqual(['2026-11-03']);
    const b = computeBudget({ txs, cats, settings, today: TODAY, recurringSkips: skips });
    expect(b.envelope.savingsDetail.planned).toBe(40000);
  });

  it('une charge sautée ce mois n’est ni retirée de l’enveloppe ni réservée ; les cycles d’avant n’en sont pas touchés', () => {
    const skips: RecurringSkips = { [CYCLE.start]: [{ id: 'line:loyer', kind: 'charge', amount: 25500 }] };
    const noLoyer = txs.filter((t) => !(t.label.includes('FONCIA') && t.date === '2026-10-05'));
    const before = computeBudget({ txs: noLoyer, cats, settings, today: TODAY, balance: 100000, upcoming: [] });
    const after = computeBudget({ txs: noLoyer, cats, settings, today: TODAY, balance: 100000, upcoming: [], recurringSkips: skips });
    expect(after.envelope.fixed).toBe(before.envelope.fixed - 25500);
    expect(before.upcoming.map((u) => u.label)).toContain('Loyer');
    expect(after.upcoming.map((u) => u.label)).not.toContain('Loyer');
    const lastCycle = computeBudget({ txs: noLoyer, cats, settings, today: '2026-09-20', recurringSkips: skips });
    expect(lastCycle.envelope.fixed).toBe(25500);
  });

  it('la prévision ne compte pas un revenu versé directement à un tiers', () => {
    const f = buildForecast({ today: TODAY, until: '2026-11-30', startBalance: 0, recurring: detected, cats, settings, plans, dailySpend: 0 });
    expect(f.events.some((e) => e.label === 'APL')).toBe(false);
    expect(f.events.filter((e) => e.label === 'Loyer').map((e) => e.date)).toEqual(['2026-11-05']);
  });
});
