import type { Category, FireSettings, InvestmentOp, Settings, Transaction } from '../db/types';
import { addDays, diffDays, type ISODate } from '../lib/dates';
import { isSpending, spent } from './budget';
import { computeEnvelope, totalFixed } from './defaults';
import type { PortfolioSummary } from './wealth';

/**
 * Indépendance financière (FIRE) : dans combien de temps tes placements pourraient-ils financer tes
 * dépenses ? Tout est en euros d'aujourd'hui (rendement réel = rendement − inflation), avec intérêts
 * composés mensuels et la règle du taux de retrait (4 % par défaut → capital = 25 ans de dépenses).
 */

export interface FireInput {
  /** Capital investi aujourd'hui (centimes). */
  current: number;
  /** Versement mensuel (centimes). */
  monthly: number;
  annualSpending: number;
  settings: FireSettings;
}

export interface FireProjection {
  target: number;
  /** Rendement réel annuel (ex. 0,0294 pour 5 % − 2 %). */
  realRate: number;
  months: number | null;
  /** Valeur en fin de chaque année (année 0 = aujourd'hui), jusqu'à l'objectif + 5 ans (max 50 ans). */
  series: { year: number; value: number }[];
  progress: number;
}

export function realAnnualRate(s: Pick<FireSettings, 'annualReturnBp' | 'inflationBp'>): number {
  return (1 + s.annualReturnBp / 10000) / (1 + s.inflationBp / 10000) - 1;
}

export function fireTarget(annualSpending: number, withdrawalBp: number): number {
  return withdrawalBp > 0 ? Math.round(annualSpending / (withdrawalBp / 10000)) : 0;
}

/** Nombre de mois pour atteindre `target` (null au-delà de `maxMonths`). */
export function monthsToTarget(current: number, monthly: number, realRate: number, target: number, maxMonths = 12 * 80): number | null {
  if (current >= target) return 0;
  const rm = Math.pow(1 + realRate, 1 / 12) - 1;
  let v = current;
  for (let m = 1; m <= maxMonths; m++) {
    v = v * (1 + rm) + monthly;
    if (v >= target) return m;
  }
  return null;
}

export function projectFire(input: FireInput): FireProjection {
  const realRate = realAnnualRate(input.settings);
  const target = fireTarget(input.annualSpending, input.settings.withdrawalBp);
  const months = target > 0 ? monthsToTarget(input.current, input.monthly, realRate, target) : null;
  const rm = Math.pow(1 + realRate, 1 / 12) - 1;
  const years = Math.min(50, Math.max(10, months === null ? 40 : Math.ceil(months / 12) + 5));
  const series: { year: number; value: number }[] = [{ year: 0, value: input.current }];
  let v = input.current;
  for (let y = 1; y <= years; y++) {
    for (let m = 0; m < 12; m++) v = v * (1 + rm) + input.monthly;
    series.push({ year: y, value: Math.round(v) });
  }
  return { target, realRate, months, series, progress: target > 0 ? Math.min(1, input.current / target) : 0 };
}

/**
 * Dépenses annuelles estimées : les 12 derniers mois réels (ramenés à l'année s'il y a moins d'historique,
 * au moins 60 jours), sinon le budget prévu (charges fixes + enveloppe) × 12.
 */
export function estimateAnnualSpending(txs: readonly Transaction[], cats: ReadonlyMap<string, Category>, settings: Settings, today: ISODate): { amount: number; source: 'history' | 'budget' } {
  if (settings.fire.annualSpendingOverride !== null) return { amount: settings.fire.annualSpendingOverride, source: 'budget' };
  const from = addDays(today, -365);
  const window = txs.filter((t) => t.date > from && t.date <= today && !t.pending);
  const first = window.reduce<ISODate | null>((m, t) => (m === null || t.date < m ? t.date : m), null);
  if (first && diffDays(first, today) >= 60) {
    const days = diffDays(first, today) + 1;
    return { amount: Math.round((spent(window, cats as Map<string, Category>, isSpending) * 365) / days), source: 'history' };
  }
  return { amount: (totalFixed(settings) + Math.max(0, computeEnvelope(settings))) * 12, source: 'budget' };
}

// ---------------------------------------------------------------- v2 : paliers, réel, scénarios

/** Catégories essentielles par défaut : charges fixes + courses, santé, transport. */
export const DEFAULT_ESSENTIAL = ['courses', 'sante', 'transport', 'logement', 'abonnements'];

export function isEssential(cat: Category | undefined, essentialIds: readonly string[] | null): boolean {
  if (!cat) return false;
  if (essentialIds) return essentialIds.includes(cat.id);
  return cat.kind === 'fixed' || DEFAULT_ESSENTIAL.includes(cat.id);
}

export interface SpendingBreakdown {
  /** Dépenses annuelles (12 derniers mois, ramenés à l'année). */
  annual: number;
  essential: number;
  discretionary: number;
  byCategory: { id: string; annual: number; essential: boolean }[];
  source: 'history' | 'budget';
}

/** Dépenses annuelles réelles, réparties en essentielles et confort. */
export function spendingBreakdown(txs: readonly Transaction[], cats: ReadonlyMap<string, Category>, settings: Settings, today: ISODate): SpendingBreakdown {
  const essentialIds = settings.fire.essentialCategoryIds;
  const from = addDays(today, -365);
  const window = txs.filter((t) => t.date > from && t.date <= today && !t.pending && isSpending(t, cats as Map<string, Category>));
  const first = window.reduce<ISODate | null>((m, t) => (m === null || t.date < m ? t.date : m), null);
  if (!first || diffDays(first, today) < 60) {
    const annual = (totalFixed(settings) + Math.max(0, computeEnvelope(settings))) * 12;
    const essential = totalFixed(settings) * 12;
    return { annual, essential, discretionary: annual - essential, byCategory: [], source: 'budget' };
  }
  const scale = 365 / (diffDays(first, today) + 1);
  const byCat = new Map<string, number>();
  for (const t of window) byCat.set(t.categoryId ?? '_none', (byCat.get(t.categoryId ?? '_none') ?? 0) - t.amount);
  const byCategory = [...byCat]
    .map(([id, v]) => ({ id, annual: Math.round(v * scale), essential: isEssential(cats.get(id), essentialIds) }))
    .filter((c) => c.annual > 0)
    .sort((a, b) => b.annual - a.annual);
  const annual = byCategory.reduce((s, c) => s + c.annual, 0);
  const essential = byCategory.filter((c) => c.essential).reduce((s, c) => s + c.annual, 0);
  return { annual, essential, discretionary: annual - essential, byCategory, source: 'history' };
}

export interface FiTier {
  id: 'lean' | 'fi' | 'fat';
  label: string;
  annualSpending: number;
  target: number;
  months: number | null;
}

/**
 * Trois paliers : Lean (dépenses essentielles), FI (train de vie actuel), Fat (×1,5).
 * Les capitaux visés sont bruts d'impôt sur les retraits (`withdrawalTax`, 0 → 1).
 */
export function fiTiers(input: { current: number; monthly: number; breakdown: Pick<SpendingBreakdown, 'annual' | 'essential'>; settings: FireSettings; withdrawalTax: number }): FiTier[] {
  const real = realAnnualRate(input.settings) - input.settings.feesBp / 10000;
  const gross = (spending: number) => Math.round(fireTarget(spending, input.settings.withdrawalBp) / Math.max(0.5, 1 - input.withdrawalTax));
  return (
    [
      { id: 'lean', label: 'Lean FI', annualSpending: input.breakdown.essential },
      { id: 'fi', label: 'FI', annualSpending: input.breakdown.annual },
      { id: 'fat', label: 'Fat FI', annualSpending: Math.round(input.breakdown.annual * 1.5) },
    ] as const
  ).map((t) => {
    const target = gross(t.annualSpending);
    return { ...t, target, months: target > 0 ? monthsToTarget(input.current, input.monthly, real, target) : null };
  });
}

/**
 * Coast FI : capital à partir duquel tu peux arrêter d'épargner et atteindre quand même l'objectif à
 * l'âge de la retraite, par le seul rendement. null sans année de naissance ou si l'âge est passé.
 */
export function coastFi(target: number, realRate: number, birthYear: number | null, retirementAge: number, today: ISODate): number | null {
  if (!birthYear) return null;
  const years = birthYear + retirementAge - Number(today.slice(0, 4));
  if (years <= 0) return null;
  return Math.round(target / Math.pow(1 + realRate, years));
}

export interface MonthRate {
  month: string;
  income: number;
  spending: number;
  /** Part des revenus mise de côté (null sans revenu). */
  rate: number | null;
}

/** Taux d'épargne réel des `months` derniers mois complets : (revenus − dépenses) ÷ revenus. */
export function savingsRateHistory(txs: readonly Transaction[], cats: ReadonlyMap<string, Category>, today: ISODate, months = 12): MonthRate[] {
  const out: MonthRate[] = [];
  const [y0, m0] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  for (let i = months; i >= 1; i--) {
    const idx = y0 * 12 + (m0 - 1) - i;
    const key = `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
    let income = 0;
    let spending = 0;
    for (const t of txs) {
      if (!t.date.startsWith(key) || t.pending) continue;
      const kind = t.categoryId ? cats.get(t.categoryId)?.kind : undefined;
      if (kind === 'income' && t.amount > 0) income += t.amount;
      else if (isSpending(t, cats as Map<string, Category>)) spending -= t.amount;
    }
    out.push({ month: key, income, spending, rate: income > 0 ? (income - spending) / income : null });
  }
  return out;
}

/** Revenus passifs des 12 derniers mois : dividendes et intérêts, frais déduits. */
export function passiveIncome(ops: readonly InvestmentOp[], today: ISODate): number {
  const from = addDays(today, -365);
  return ops.filter((o) => o.date > from && o.date <= today).reduce((s, o) => s + (o.type === 'dividend' || o.type === 'interest' ? o.amount : o.type === 'fee' ? -o.amount : 0), 0);
}

/**
 * Impôt moyen sur les retraits (France), pondéré par enveloppe et par la part de plus-value :
 * PEA et assurance-vie : prélèvements sociaux 17,2 % ; CTO, crypto, PER, autres : flat tax 30 % ;
 * livrets : 0 %. Approximation (PEA de plus de 5 ans, assurance-vie de plus de 8 ans, sans abattement).
 */
export function withdrawalTaxRate(summaries: readonly PortfolioSummary[]): number {
  let total = 0;
  let tax = 0;
  for (const s of summaries) {
    if (s.value <= 0) continue;
    const w = `${s.portfolio.wrapper} ${s.portfolio.kind}`.toLowerCase();
    const rate = /livret|ldds|lep|savings/.test(w) ? 0 : /\bpea\b|assurance|\bav\b/.test(w) ? 0.172 : 0.3;
    const gainShare = Math.max(0, s.gain) / s.value;
    total += s.value;
    tax += s.value * gainShare * rate;
  }
  return total > 0 ? tax / total : 0;
}

export interface Lever {
  id: string;
  label: string;
  /** Mois gagnés (positif) ou perdus. */
  months: number | null;
}

/** Ce que changent quelques décisions simples sur la date d'indépendance. */
export function fireLevers(input: { current: number; monthly: number; target: number; settings: FireSettings }): Lever[] {
  const real = realAnnualRate(input.settings) - input.settings.feesBp / 10000;
  const base = monthsToTarget(input.current, input.monthly, real, input.target);
  const delta = (m: number | null) => (base === null || m === null ? null : base - m);
  return [
    { id: 'plus100', label: '+100 € épargnés par mois', months: delta(monthsToTarget(input.current, input.monthly + 10000, real, input.target)) },
    { id: 'spend5', label: '−5 % de dépenses', months: delta(monthsToTarget(input.current, input.monthly, real, Math.round(input.target * 0.95))) },
    { id: 'fees', label: 'Frais réduits de 0,3 %/an', months: delta(monthsToTarget(input.current, input.monthly, real + 0.003, input.target)) },
    { id: 'return1', label: '1 % de rendement en moins', months: delta(monthsToTarget(input.current, input.monthly, real - 0.01, input.target)) },
  ];
}

/** Trois scénarios de rendement (réel, frais déduits) : courbes de capital année par année. */
export function scenarioSeries(input: { current: number; monthly: number; settings: FireSettings; years: number }): { id: 'low' | 'mid' | 'high'; rate: number; values: number[] }[] {
  const mid = realAnnualRate(input.settings) - input.settings.feesBp / 10000;
  return (
    [
      ['low', mid - 0.02],
      ['mid', mid],
      ['high', mid + 0.02],
    ] as const
  ).map(([id, rate]) => {
    const rm = Math.pow(1 + rate, 1 / 12) - 1;
    const values = [input.current];
    let v = input.current;
    for (let y = 1; y <= input.years; y++) {
      for (let m = 0; m < 12; m++) v = v * (1 + rm) + input.monthly;
      values.push(Math.round(v));
    }
    return { id, rate, values };
  });
}

export const MILESTONES = [0.1, 0.25, 0.5, 0.75, 1];

/** Palier le plus haut atteint (0 si aucun). */
export function milestoneReached(progress: number): number {
  return MILESTONES.filter((m) => progress >= m).pop() ?? 0;
}

// ---------------------------------------------------------------- Monte-Carlo

export interface MonteCarloInput {
  current: number;
  monthly: number;
  target: number;
  /** Rendement réel annuel moyen (frais déduits). */
  realRate: number;
  /** Volatilité annuelle (0,15 ≈ actions mondiales). */
  volatility: number;
  annualSpending: number;
  runs?: number;
  seed?: number;
}

export interface MonteCarloResult {
  /** Mois avant l'indépendance : percentiles 10, 50, 90 (null = pas atteint en 60 ans). */
  p10: number | null;
  p50: number | null;
  p90: number | null;
  /** Probabilité d'atteindre l'objectif à la date du scénario médian déterministe. */
  reachedByMedianDate: number;
  /** Probabilité que le capital visé tienne 40 ans de retraits (dépenses annuelles, réel). */
  sustainable40: number;
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Rendements mensuels aléatoires (log-normaux) : combien de temps pour l'objectif, avec quelle
 * probabilité, et le capital visé tient-il 40 ans ? Déterministe pour une graine donnée.
 */
export function monteCarlo(input: MonteCarloInput): MonteCarloResult {
  const runs = input.runs ?? 1000;
  const rand = rng(input.seed ?? 42);
  const sigma = input.volatility / Math.sqrt(12);
  // Rendement « géométrique » : la trajectoire médiane compose au taux réel, comme la projection.
  const mu = Math.log(1 + input.realRate) / 12;
  const normal = () => {
    const u = Math.max(1e-12, rand());
    const v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const monthly = () => Math.exp(mu + sigma * normal()) - 1;
  const deterministic = monthsToTarget(input.current, input.monthly, input.realRate, input.target, 720);
  const reached: (number | null)[] = [];
  let byMedian = 0;
  let sustained = 0;
  for (let r = 0; r < runs; r++) {
    let v = input.current;
    let hit: number | null = v >= input.target ? 0 : null;
    for (let m = 1; m <= 720 && hit === null; m++) {
      v = v * (1 + monthly()) + input.monthly;
      if (v >= input.target) hit = m;
    }
    reached.push(hit);
    if (hit !== null && deterministic !== null && hit <= deterministic) byMedian++;
    // Retraits : 40 ans à partir du capital visé.
    let c = input.target;
    let ok = true;
    for (let m = 0; m < 480; m++) {
      c = c * (1 + monthly()) - input.annualSpending / 12;
      if (c <= 0) {
        ok = false;
        break;
      }
    }
    if (ok) sustained++;
  }
  const sorted = reached.map((x) => x ?? Infinity).sort((a, b) => a - b);
  const pct = (p: number) => {
    const v = sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? Infinity;
    return Number.isFinite(v) ? v : null;
  };
  return { p10: pct(0.1), p50: pct(0.5), p90: pct(0.9), reachedByMedianDate: deterministic === null ? 0 : byMedian / runs, sustainable40: sustained / runs };
}

// ---------------------------------------------------------------- calcul commun (écrans Patrimoine et FI)

export interface FireState {
  current: number;
  breakdown: SpendingBreakdown;
  /** Dépenses réelles, avant un éventuel montant saisi. */
  breakdownReal: SpendingBreakdown;
  tax: number;
  realNet: number;
  tiers: FiTier[];
  main: FiTier;
  progress: number;
}

/**
 * Capital pris en compte (placements + comptes épargne, sauf exclusions), dépenses (réelles ou saisies),
 * impôt sur les retraits, paliers. Une seule source pour tous les écrans : ils affichent la même date.
 */
export function computeFire(input: {
  summaries: readonly PortfolioSummary[];
  savingsAccounts: readonly { id: string; balance: number | null }[];
  txs: readonly Transaction[];
  cats: ReadonlyMap<string, Category>;
  settings: Settings;
  today: ISODate;
  monthly: number;
}): FireState {
  const f = input.settings.fire;
  const excluded = new Set(f.excludedIds);
  const summaries = input.summaries.filter((s) => !excluded.has(s.portfolio.id));
  const current = summaries.reduce((s, x) => s + x.value, 0) + input.savingsAccounts.filter((a) => !excluded.has(a.id)).reduce((s, a) => s + (a.balance ?? 0), 0);
  const breakdownReal = spendingBreakdown(input.txs, input.cats, input.settings, input.today);
  const override = f.annualSpendingOverride;
  // Dépenses visées saisies : même part d'essentiel que les dépenses réelles.
  const breakdown =
    override === null ? breakdownReal : { ...breakdownReal, annual: override, essential: Math.round(override * (breakdownReal.annual ? breakdownReal.essential / breakdownReal.annual : 0.7)) };
  const tax = withdrawalTaxRate(summaries);
  const tiers = fiTiers({ current, monthly: input.monthly, breakdown, settings: f, withdrawalTax: tax });
  const main = tiers[1]!;
  return { current, breakdown, breakdownReal, tax, realNet: realAnnualRate(f) - f.feesBp / 10000, tiers, main, progress: main.target > 0 ? Math.min(1, current / main.target) : 0 };
}
