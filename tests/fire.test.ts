import { describe, expect, it } from 'vitest';
import type { Settings } from '../src/db/types';
import { CAT, DEFAULT_CATEGORIES, DEFAULT_FIRE, DEFAULT_SETTINGS } from '../src/domain/defaults';
import {
  affordableSpending,
  capitalSeries,
  computeFire,
  cutsMonthly,
  futureValue,
  grossTarget,
  milestoneReached,
  monthsToTarget,
  reducibleSpending,
  requiredMonthly,
  spendingBreakdown,
  spendingCutNeeded,
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

  it('versement nécessaire : exactement ce qu’il faut pour arriver à temps', () => {
    const r = 0.03;
    const need = requiredMonthly(1_000_000, 30_000_000, r, 240)!;
    expect(monthsToTarget(1_000_000, need, r, 30_000_000, 240)).not.toBeNull();
    expect(monthsToTarget(1_000_000, need - 500, r, 30_000_000, 240)).toBeNull();
    expect(requiredMonthly(40_000_000, 30_000_000, r, 12)).toBe(0);
    // Le capital seul y arrive : rien à verser.
    expect(requiredMonthly(20_000_000, 30_000_000, 0.05, 12 * 30)).toBe(0);
    expect(requiredMonthly(0, 30_000_000, r, 0)).toBeNull();
  });

  it('baisse de dépenses : investie et retirée du train de vie, elle suffit à tenir la date', () => {
    const terms = { current: 1_000_000, realRate: 0.03, withdrawalBp: 400, tax: 0 };
    const cut = spendingCutNeeded(terms, 50_000, 1_800_000, 240);
    expect(cut).toBeGreaterThan(0);
    expect(cut % 1000).toBe(0);
    expect(monthsToTarget(terms.current, 50_000 + cut, terms.realRate, grossTarget(1_800_000 - 12 * cut, 400, 0), 240)).not.toBeNull();
    // Il faut moins réduire ses dépenses qu'augmenter ses versements : l'effet joue deux fois.
    expect(cut).toBeLessThan(requiredMonthly(terms.current, grossTarget(1_800_000, 400, 0), terms.realRate, 240)! - 50_000);
    expect(spendingCutNeeded(terms, 5_000_000, 1_800_000, 240)).toBe(0);
  });

  it('revenu permis à une date : cohérent avec le capital atteint', () => {
    const terms = { current: 1_000_000, realRate: 0.03, withdrawalBp: 400, tax: 0.1 };
    const fv = futureValue(terms.current, 50_000, terms.realRate, 120);
    expect(fv).toBe(capitalSeries(terms.current, 50_000, terms.realRate, 10).at(-1));
    expect(affordableSpending(terms, 50_000, 120)).toBe(Math.round(fv * 0.04 * 0.9));
  });

  it('postes réductibles : sans les charges fixes ; économies par poste', () => {
    const b = spendingBreakdown(year(), cats, settings, TODAY);
    const red = reducibleSpending(b, cats);
    expect(red.map((c) => c.id)).toEqual([CAT.courses, CAT.restos]);
    expect(red[1]!.monthly).toBeGreaterThan(18_000);
    expect(cutsMonthly(red, { [CAT.restos]: 0.5 })).toBe(Math.round(red[1]!.monthly * 0.5));
    expect(cutsMonthly(red, { [CAT.restos]: 3, inconnu: 1 })).toBe(red[1]!.monthly);
  });

  it('plan : les économies avancent la date (versées et train de vie plus bas)', () => {
    const input = { summaries: [], savingsAccounts: [{ id: 'l', balance: 2_000_000 }], txs: year(), cats, settings, today: TODAY, monthly: 30_000 };
    const base = computeFire(input);
    const planned = computeFire({ ...input, cutMonthly: 10_000 });
    expect(planned.monthly).toBe(40_000);
    expect(planned.annualSpending).toBe(base.annualSpending - 120_000);
    expect(planned.months!).toBeLessThan(base.months!);
    // Revenu visé saisi : les économies sont investies mais ne le changent pas.
    const fixed = computeFire({ ...input, settings: { ...settings, fire: { ...settings.fire, annualSpendingOverride: 2_400_000 } }, cutMonthly: 10_000 });
    expect(fixed.annualSpending).toBe(2_400_000);
    expect(fixed.spendingAuto).toBe(false);
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
