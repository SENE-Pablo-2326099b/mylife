import { describe, expect, it } from 'vitest';
import type { Settings } from '../src/db/types';
import { CAT, DEFAULT_CATEGORIES, DEFAULT_FIRE, DEFAULT_SETTINGS } from '../src/domain/defaults';
import {
  compoundSchedule,
  computeFire,
  cutsMonthly,
  effectiveRate,
  grossTarget,
  milestoneReached,
  monthlyNeeded,
  monthsToReach,
  passiveMonthly,
  reducibleSpending,
  spendingBreakdown,
  withdrawalTaxRate,
} from '../src/domain/fire';
import type { PortfolioSummary } from '../src/domain/wealth';
import { tx } from './helpers';

const cats = new Map(DEFAULT_CATEGORIES.map((c) => [c.id, c]));
const settings: Settings = { ...DEFAULT_SETTINGS, fire: { ...DEFAULT_FIRE } };
const TODAY = '2026-10-21';

/** Un an de vie : loyer 500, courses 300, restos 200 par mois ; salaire 2 000. */
function year() {
  const out = [];
  for (let i = 0; i < 12; i++) {
    const m = String(((9 + i) % 12) + 1).padStart(2, '0');
    const y = 9 + i >= 12 ? 2026 : 2025;
    out.push(
      tx({ id: `r${i}`, date: `${y}-${m}-05`, amount: -50000, categoryId: CAT.logement }),
      tx({ id: `c${i}`, date: `${y}-${m}-10`, amount: -30000, categoryId: CAT.courses }),
      tx({ id: `o${i}`, date: `${y}-${m}-15`, amount: -20000, categoryId: CAT.restos }),
      tx({ id: `s${i}`, date: `${y}-${m}-01`, amount: 200000, categoryId: CAT.revenus }),
    );
  }
  return out;
}

describe('indépendance financière : objectif et plan', () => {
  it('dépenses réelles : essentielles (loyer, courses) et confort (restos)', () => {
    const b = spendingBreakdown(year(), cats, settings, TODAY);
    expect(b.source).toBe('history');
    // 11 mois dans la fenêtre des 12 derniers mois, ramenés à l'année.
    expect(b.annual).toBeGreaterThan(1_100_000);
    expect(b.annual).toBeLessThan(1_250_000);
    expect(b.essential / b.annual).toBeCloseTo(0.8, 1);
    // Choix personnalisé : seuls les restos sont essentiels.
    const custom = spendingBreakdown(year(), cats, { ...settings, fire: { ...settings.fire, essentialCategoryIds: [CAT.restos] } }, TODAY);
    expect(custom.essential / custom.annual).toBeCloseTo(0.2, 1);
  });

  it('capital nécessaire : dépenses ÷ taux de retrait, brut de l’impôt sur les retraits', () => {
    expect(grossTarget(1_200_000, 400, 0)).toBe(30_000_000);
    expect(grossTarget(1_200_000, 350, 0)).toBe(Math.round(1_200_000 / 0.035));
    expect(grossTarget(1_200_000, 400, 0.1)).toBe(Math.round(30_000_000 / 0.9));
  });

  it('intérêts composés : mêmes conventions que les calculatrices usuelles (exemple Finary)', () => {
    // 10 000 € + 100 €/mois pendant 20 ans à 5 % → 67 113 €.
    const y = compoundSchedule({ initial: 1_000_000, monthly: 10_000, annualRate: 0.05 }, 20);
    expect(y).toHaveLength(21);
    expect(Math.round(y[20]!.total / 100)).toBe(67_113);
    expect(y[20]!.contributions).toBe(3_400_000);
    expect(y[20]!.interest).toBe(y[20]!.total - y[20]!.contributions);
    expect(y[0]).toEqual({ year: 0, contributions: 1_000_000, interest: 0, total: 1_000_000 });
  });

  it('épargne en hausse chaque année, taux net (frais, inflation)', () => {
    const flat = compoundSchedule({ initial: 0, monthly: 10_000, annualRate: 0.05 }, 10)[10]!;
    const rising = compoundSchedule({ initial: 0, monthly: 10_000, annualRate: 0.05, savingsGrowth: 0.03 }, 10)[10]!;
    expect(rising.contributions).toBeGreaterThan(flat.contributions);
    expect(compoundSchedule({ initial: 0, monthly: 10_000, annualRate: 0.05, savingsGrowth: 0.03 }, 1)[1]!.contributions).toBe(120_000);
    expect(effectiveRate(500, 20, null)).toBeCloseTo(0.048, 10);
    expect(effectiveRate(500, 20, 200)).toBeCloseTo(1.048 / 1.02 - 1, 10);
  });

  it('date atteinte et épargne nécessaire : cohérentes entre elles', () => {
    const p = { initial: 1_000_000, annualRate: 0.03 };
    const need = monthlyNeeded(p, 30_000_000, 240);
    expect(monthsToReach({ ...p, monthly: need }, 30_000_000, 240)).not.toBeNull();
    expect(monthsToReach({ ...p, monthly: need - 200 }, 30_000_000, 240)).toBeNull();
    expect(monthlyNeeded({ initial: 40_000_000, annualRate: 0.03 }, 30_000_000, 12)).toBe(0);
    expect(monthsToReach({ initial: 0, monthly: 0, annualRate: 0.05 }, 100, 600)).toBeNull();
  });

  it('revenu à vie d’un capital : taux de retrait, impôt déduit', () => {
    expect(passiveMonthly(30_000_000, 400, 0)).toBe(100_000);
    expect(passiveMonthly(30_000_000, 400, 0.1)).toBe(90_000);
  });

  it('postes réductibles : sans les charges fixes ; économies par poste', () => {
    const b = spendingBreakdown(year(), cats, settings, TODAY);
    const red = reducibleSpending(b, cats);
    expect(red.map((c) => c.id)).toEqual([CAT.courses, CAT.restos]);
    expect(red[1]!.monthly).toBeGreaterThan(18_000);
    expect(cutsMonthly(red, { [CAT.restos]: 0.5 })).toBe(Math.round(red[1]!.monthly * 0.5));
    expect(cutsMonthly(red, { [CAT.restos]: 3, inconnu: 1 })).toBe(red[1]!.monthly);
  });

  it('indépendance sur tes données : capital, train de vie réel ou choisi', () => {
    const input = { summaries: [], savingsAccounts: [{ id: 'l', balance: 2_000_000 }], txs: year(), cats, settings, today: TODAY, monthly: 30_000 };
    const base = computeFire(input);
    expect(base.current).toBe(2_000_000);
    expect(base.spendingAuto).toBe(true);
    expect(base.target).toBe(grossTarget(base.annualSpending, settings.fire.withdrawalBp, 0));
    expect(computeFire({ ...input, monthly: 60_000 }).months!).toBeLessThan(base.months!);
    const fixed = computeFire({ ...input, settings: { ...settings, fire: { ...settings.fire, annualSpendingOverride: 2_400_000, excludedIds: ['l'] } } });
    expect(fixed.annualSpending).toBe(2_400_000);
    expect(fixed.current).toBe(0);
  });

  it('impôt sur les retraits (2026) : PEA 18,6 %, assurance-vie 17,2 %, CTO 31,4 % sur la part de plus-value', () => {
    const s = (wrapper: string, value: number, gain: number) => ({ portfolio: { id: wrapper, name: wrapper, provider: '', kind: 'broker', wrapper, order: 0, createdAt: 0 }, value, gain }) as unknown as PortfolioSummary;
    expect(withdrawalTaxRate([s('PEA', 100_000, 50_000)])).toBeCloseTo(0.093, 3);
    expect(withdrawalTaxRate([s('Assurance vie', 100_000, 50_000)])).toBeCloseTo(0.086, 3);
    expect(withdrawalTaxRate([s('CTO', 100_000, 50_000)])).toBeCloseTo(0.157, 3);
    expect(withdrawalTaxRate([s('Livret A', 100_000, 0)])).toBe(0);
    expect(withdrawalTaxRate([])).toBe(0);
  });

  it('paliers fêtés', () => {
    expect(milestoneReached(0.05)).toBe(0);
    expect(milestoneReached(0.3)).toBe(0.25);
    expect(milestoneReached(1.2)).toBe(1);
  });
});
