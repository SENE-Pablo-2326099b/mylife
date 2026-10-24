import { describe, expect, it } from 'vitest';
import type { InvestmentPlan, Settings } from '../src/db/types';
import { CAT, DEFAULT_CATEGORIES, DEFAULT_FIRE, DEFAULT_SETTINGS } from '../src/domain/defaults';
import { estimateAnnualSpending, fireTarget, monthsToTarget, projectFire, realAnnualRate } from '../src/domain/fire';
import { averageDailySpend, buildForecast } from '../src/domain/forecast';
import { detectRecurring, merchantKey, subscriptionsMonthly } from '../src/domain/recurring';
import { addDays } from '../src/lib/dates';
import { tx } from './helpers';

const cats = new Map(DEFAULT_CATEGORIES.map((c) => [c.id, c]));
const TODAY = '2026-10-20';
let n = 0;
const monthly = (label: string, amount: number, day: number, months: number, categoryId: string | null, end = '2026-10') => {
  const [y, m] = end.split('-').map(Number) as [number, number];
  return Array.from({ length: months }, (_, i) => {
    const total = y * 12 + (m - 1) - i;
    const date = `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return tx({ id: `t${n++}`, date, amount, label, categoryId });
  });
};

describe('récurrences', () => {
  it('clé commerçant sans bruit bancaire ni chiffres', () => {
    expect(merchantKey('PRLV SEPA NETFLIX.COM 2026-10')).toBe('netflix');
    expect(merchantKey('CB SPOTIFY P2B3C 12/10')).toBe('spotify');
  });

  it('abonnement mensuel, salaire, rythme hebdomadaire', () => {
    const txs = [
      ...monthly('NETFLIX.COM', -1349, 15, 5, CAT.abonnements),
      ...monthly('ACME SAS SALAIRE', 210000, 28, 4, CAT.revenus, '2026-09'),
      ...Array.from({ length: 8 }, (_, i) => tx({ id: `w${i}`, date: addDays('2026-10-19', -7 * i), amount: -1000, label: 'BITSTACK', categoryId: CAT.epargne })),
    ];
    const r = detectRecurring(txs, cats, TODAY);
    const netflix = r.find((x) => x.label === 'NETFLIX.COM')!;
    expect(netflix).toMatchObject({ cadence: 'monthly', amount: -1349, dayOfMonth: 15, nextDate: '2026-11-15', subscription: true, active: true, kind: 'expense' });
    expect(r.find((x) => /ACME/.test(x.label))).toMatchObject({ kind: 'income', cadence: 'monthly', nextDate: '2026-10-28' });
    expect(r.find((x) => x.label === 'BITSTACK')).toMatchObject({ cadence: 'weekly', monthly: -4349, subscription: false });
    expect(subscriptionsMonthly(r)).toBe(1349);
  });

  it('hausse de prix détectée et prise en compte pour la suite', () => {
    const txs = [...monthly('FREE MOBILE', -1599, 12, 4, CAT.abonnements, '2026-08'), ...monthly('FREE MOBILE', -1999, 12, 2, CAT.abonnements)];
    const free = detectRecurring(txs, cats, TODAY)[0]!;
    expect(free.priceChange).toEqual({ from: 1599, to: 1999 });
    expect(free.amount).toBe(-1999);
  });

  it('ignore l’irrégulier, les transferts internes et l’opération unique ; marque l’arrêté inactif', () => {
    const irregular = ['2026-06-03', '2026-06-10', '2026-08-29', '2026-09-02', '2026-10-15'].map((date, i) => tx({ id: `i${i}`, date, amount: -2500, label: 'CARREFOUR' }));
    const transfers = monthly('VIR VERS MOI', -50000, 2, 4, CAT.transferts);
    const stopped = monthly('DEEZER', -1199, 5, 4, CAT.abonnements, '2026-05');
    const r = detectRecurring([...irregular, ...transfers, ...stopped, tx({ id: 'one', date: '2026-10-01', amount: -999, label: 'UNIQUE' })], cats, TODAY);
    expect(r.map((x) => x.label)).toEqual(['DEEZER']);
    expect(r[0]?.active).toBe(false);
  });

  it('choix de l’utilisateur : écarté', () => {
    const r = detectRecurring(monthly('NETFLIX.COM', -1349, 15, 4, CAT.abonnements), cats, TODAY, [{ key: '-netflix', status: 'ignored', label: null }]);
    expect(r[0]?.status).toBe('ignored');
    expect(subscriptionsMonthly(r)).toBe(0);
  });
});

describe('prévision de trésorerie', () => {
  const settings = { incomes: [{ id: 's', label: 'Salaire', amount: 200000, day: 28 }], fixedCharges: [{ id: 'l', label: 'Loyer', amount: 70000, day: 5 }] } as Pick<Settings, 'incomes' | 'fixedCharges'>;
  const plan = { id: 'p', holdingId: 'h', amount: 15000, frequency: 'monthly', day: 2, startDate: '2026-01-01', active: true, lastRunDate: null, createdAt: 0, label: 'Investissement · ETF' } as InvestmentPlan & { label: string };

  it('solde jour par jour, point bas, événements', () => {
    const f = buildForecast({ today: TODAY, until: '2026-11-06', startBalance: 50000, recurring: [], cats, settings, plans: [plan], dailySpend: 1000 });
    expect(f.points).toHaveLength(18);
    expect(f.events.map((e) => `${e.date} ${e.label} ${e.amount}`)).toEqual(['2026-10-28 Salaire 200000', '2026-11-02 Investissement · ETF -15000', '2026-11-05 Loyer -70000']);
    expect(f.lowest).toEqual({ date: '2026-10-27', balance: 43000 });
    expect(f.end).toBe(50000 + 200000 - 15000 - 70000 - 17 * 1000);
  });

  it('une ligne saisie déjà visible dans les opérations n’est pas comptée deux fois', () => {
    const recurring = detectRecurring(
      [...monthly('FONCIA LOYER', -70000, 5, 4, CAT.logement), ...monthly('TRADE REPUBLIC', -15000, 2, 4, CAT.epargne)],
      cats,
      TODAY,
    );
    const f = buildForecast({ today: TODAY, until: '2026-11-06', startBalance: 0, recurring, cats, settings: { incomes: [], fixedCharges: settings.fixedCharges }, plans: [plan], dailySpend: 0 });
    // Une seule échéance chacun : le virement Trade Republic rejoint le plan, le prélèvement Foncia la ligne « Loyer »
    // (avec le jour et le montant vus à la banque).
    expect(f.events.map((e) => `${e.date} ${e.label} ${e.amount} ${e.source}`)).toEqual(['2026-11-02 Investissement · ETF -15000 recurring', '2026-11-05 Loyer -70000 recurring']);
  });

  it('un virement récurrent entre mes comptes n’est pas une sortie d’argent', () => {
    const recurring = detectRecurring(monthly('VIR VERS REVOLUT', -30000, 3, 4, CAT.transferts), cats, TODAY);
    const f = buildForecast({ today: TODAY, until: '2026-11-06', startBalance: 0, recurring, cats, settings: { incomes: [], fixedCharges: [] }, plans: [], dailySpend: 0 });
    expect(f.events).toEqual([]);
  });

  it('rythme quotidien des dépenses courantes', () => {
    const txs = Array.from({ length: 28 }, (_, i) => tx({ id: `d${i}`, date: addDays(TODAY, -1 - i), amount: -1500, categoryId: CAT.courses }));
    txs.push(tx({ id: 'rent', date: addDays(TODAY, -3), amount: -70000, categoryId: CAT.logement }));
    expect(averageDailySpend(txs, cats, TODAY)).toBe(1500);
  });
});

describe('indépendance financière', () => {
  const f = { ...DEFAULT_FIRE, annualReturnBp: 500, inflationBp: 200, withdrawalBp: 400, annualSpendingOverride: null };

  it('capital visé = 25 ans de dépenses (4 %) ; rendement réel', () => {
    expect(fireTarget(2400000, 400)).toBe(60000000);
    expect(realAnnualRate(f)).toBeCloseTo(0.02941, 4);
  });

  it('mois nécessaires (intérêts composés mensuels), cas limites', () => {
    expect(monthsToTarget(100, 0, 0.03, 50)).toBe(0);
    expect(monthsToTarget(0, 0, 0.03, 100)).toBeNull();
    expect(monthsToTarget(0, 1000, 0, 12000)).toBe(12);
    const p = projectFire({ current: 1000000, monthly: 50000, annualSpending: 2400000, settings: f });
    expect(p.target).toBe(60000000);
    expect(p.months).toBeGreaterThan(520);
    expect(p.months).toBeLessThan(560); // ≈ 45 ans : 100 € + 500 €/mois vers 600 000 €
    expect(p.series[0]).toEqual({ year: 0, value: 1000000 });
    const faster = projectFire({ current: 1000000, monthly: 60000, annualSpending: 2400000, settings: f });
    expect(faster.months!).toBeLessThan(p.months!);
  });

  it('dépenses annuelles : historique ramené à l’année, sinon budget × 12', () => {
    const s: Settings = { ...DEFAULT_SETTINGS, incomes: [{ id: 'i', label: 'S', amount: 200000, day: 1 }], fixedCharges: [{ id: 'f', label: 'L', amount: 80000, day: 1 }] };
    expect(estimateAnnualSpending([], cats, s, TODAY)).toEqual({ amount: (80000 + 120000) * 12, source: 'budget' });
    const txs = Array.from({ length: 91 }, (_, i) => tx({ id: `s${i}`, date: addDays(TODAY, -i), amount: -1000, categoryId: CAT.courses }));
    expect(estimateAnnualSpending(txs, cats, s, TODAY)).toEqual({ amount: 365000, source: 'history' });
  });
});
