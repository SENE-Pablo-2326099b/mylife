import { describe, expect, it } from 'vitest';
import type { Settings } from '../src/db/types';
import { CAT, DEFAULT_CATEGORIES, DEFAULT_FIRE, DEFAULT_SETTINGS } from '../src/domain/defaults';
import { coastFi, fiTiers, fireLevers, milestoneReached, monteCarlo, monthsToTarget, passiveIncome, realAnnualRate, savingsRateHistory, scenarioSeries, spendingBreakdown, withdrawalTaxRate } from '../src/domain/fire';
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

describe('indépendance financière v2', () => {
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

  it('trois paliers, du plus proche au plus lointain ; l’impôt sur les retraits gonfle le capital visé', () => {
    const breakdown = { annual: 1_200_000, essential: 960_000 };
    const [lean, fi, fat] = fiTiers({ current: 5_000_000, monthly: 100_000, breakdown, settings: settings.fire, withdrawalTax: 0 });
    expect(fi!.target).toBe(30_000_000);
    expect(lean!.target).toBe(24_000_000);
    expect(fat!.target).toBe(45_000_000);
    expect(lean!.months!).toBeLessThan(fi!.months!);
    expect(fi!.months!).toBeLessThan(fat!.months!);
    const taxed = fiTiers({ current: 0, monthly: 0, breakdown, settings: settings.fire, withdrawalTax: 0.1 });
    expect(taxed[1]!.target).toBe(Math.round(30_000_000 / 0.9));
  });

  it('Coast FI : il suffit de moins aujourd’hui si la retraite est loin', () => {
    const r = realAnnualRate(settings.fire);
    const coast = coastFi(30_000_000, r, 2000, 64, TODAY)!;
    expect(coast).toBe(Math.round(30_000_000 / Math.pow(1 + r, 38)));
    expect(coastFi(30_000_000, r, null, 64, TODAY)).toBeNull();
    expect(coastFi(30_000_000, r, 1950, 64, TODAY)).toBeNull();
  });

  it('taux d’épargne mois par mois, revenus passifs', () => {
    const h = savingsRateHistory(year(), cats, TODAY, 12);
    expect(h).toHaveLength(12);
    expect(h.at(-1)?.month).toBe('2026-09');
    expect(h.at(-1)?.rate).toBeCloseTo(0.5, 5);
    const ops = [
      { id: 'd', holdingId: 'h', date: '2026-06-01', type: 'dividend' as const, quantity: 0, amount: 1200, planId: null, estimated: false, note: '', createdAt: 0 },
      { id: 'f', holdingId: 'h', date: '2026-06-01', type: 'fee' as const, quantity: 0, amount: 200, planId: null, estimated: false, note: '', createdAt: 0 },
      { id: 'old', holdingId: 'h', date: '2024-01-01', type: 'dividend' as const, quantity: 0, amount: 9999, planId: null, estimated: false, note: '', createdAt: 0 },
    ];
    expect(passiveIncome(ops, TODAY)).toBe(1000);
  });

  it('impôt sur les retraits : PEA 17,2 % et CTO 30 % sur la part de plus-value', () => {
    const s = (wrapper: string, value: number, gain: number) => ({ portfolio: { id: wrapper, name: wrapper, provider: '', kind: 'broker', wrapper, order: 0, createdAt: 0 }, value, gain }) as unknown as PortfolioSummary;
    expect(withdrawalTaxRate([s('PEA', 100_000, 50_000)])).toBeCloseTo(0.086, 3);
    expect(withdrawalTaxRate([s('CTO', 100_000, 50_000)])).toBeCloseTo(0.15, 3);
    expect(withdrawalTaxRate([s('Livret A', 100_000, 0)])).toBe(0);
    expect(withdrawalTaxRate([])).toBe(0);
  });

  it('leviers : épargner plus ou payer moins de frais rapproche, moins de rendement éloigne', () => {
    const l = Object.fromEntries(fireLevers({ current: 1_000_000, monthly: 50_000, target: 30_000_000, settings: settings.fire }).map((x) => [x.id, x.months]));
    expect(l.plus100!).toBeGreaterThan(0);
    expect(l.spend5!).toBeGreaterThan(0);
    expect(l.fees!).toBeGreaterThan(0);
    expect(l.return1!).toBeLessThan(0);
  });

  it('scénarios : prudent < médian < optimiste', () => {
    const [low, mid, high] = scenarioSeries({ current: 1_000_000, monthly: 50_000, settings: settings.fire, years: 20 });
    expect(low!.values.at(-1)!).toBeLessThan(mid!.values.at(-1)!);
    expect(mid!.values.at(-1)!).toBeLessThan(high!.values.at(-1)!);
  });

  it('Monte-Carlo : déterministe, cohérent avec la projection, sans volatilité = certitude', () => {
    const base = { current: 2_000_000, monthly: 100_000, target: 30_000_000, realRate: 0.03, annualSpending: 1_200_000 };
    const a = monteCarlo({ ...base, volatility: 0.15, runs: 400, seed: 7 });
    const b = monteCarlo({ ...base, volatility: 0.15, runs: 400, seed: 7 });
    expect(a).toEqual(b);
    expect(a.p10!).toBeLessThanOrEqual(a.p50!);
    expect(a.p50!).toBeLessThanOrEqual(a.p90!);
    expect(a.sustainable40).toBeGreaterThan(0.5);
    // La médiane aléatoire suit la projection (un peu en dessous : versements réguliers + volatilité).
    const det = monthsToTarget(base.current, base.monthly, base.realRate, base.target, 720)!;
    expect(Math.abs(a.p50! - det) / det).toBeLessThan(0.2);
    const calm = monteCarlo({ ...base, volatility: 0, runs: 50 });
    expect(calm.p50).toBe(monthsToTarget(base.current, base.monthly, base.realRate, base.target, 720));
    expect(calm.sustainable40).toBe(1);
  });

  it('paliers fêtés', () => {
    expect(milestoneReached(0.05)).toBe(0);
    expect(milestoneReached(0.3)).toBe(0.25);
    expect(milestoneReached(1.2)).toBe(1);
  });
});
