import type { Category, FireSettings, Settings, Transaction } from '../db/types';
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

// ---------------------------------------------------------------- dépenses réelles

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

// ---------------------------------------------------------------- objectif et plan

/**
 * Impôt moyen sur les retraits (France, règles 2026), pondéré par enveloppe et par la part de plus-value :
 * PEA (+5 ans) : prélèvements sociaux 18,6 % ; assurance-vie (+8 ans) : 17,2 % ; compte-titres, crypto,
 * PER, autres : flat tax 31,4 % ; livrets : 0 %. Approximation (sans abattements ni barème).
 */
export function withdrawalTaxRate(summaries: readonly PortfolioSummary[]): number {
  let total = 0;
  let tax = 0;
  for (const s of summaries) {
    if (s.value <= 0) continue;
    const w = `${s.portfolio.wrapper} ${s.portfolio.kind}`.toLowerCase();
    const rate = /livret|ldds|lep|savings/.test(w) ? 0 : /\bpea\b/.test(w) ? 0.186 : /assurance|\bav\b/.test(w) ? 0.172 : 0.314;
    const gainShare = Math.max(0, s.gain) / s.value;
    total += s.value;
    tax += s.value * gainShare * rate;
  }
  return total > 0 ? tax / total : 0;
}

/** Capital nécessaire pour retirer `annualSpending` net par an : dépenses ÷ taux de retrait, brut d'impôt. */
export function grossTarget(annualSpending: number, withdrawalBp: number, tax: number): number {
  return Math.round(fireTarget(Math.max(0, annualSpending), withdrawalBp) / Math.max(0.5, 1 - tax));
}

// ---------------------------------------------------------------- simulateur d'intérêts composés

/**
 * Paramètres du simulateur. Conventions (celles des calculatrices usuelles) : taux annuel effectif,
 * versements en fin de mois au taux mensuel équivalent ; l'épargne mensuelle peut augmenter chaque année.
 */
export interface CompoundParams {
  initial: number;
  monthly: number;
  /** Taux annuel effectif retenu (frais et, en euros d'aujourd'hui, inflation déjà déduits). */
  annualRate: number;
  /** Hausse annuelle de l'épargne mensuelle (0,02 = +2 % par an). */
  savingsGrowth?: number;
}

export interface CompoundYear {
  year: number;
  /** Capital initial + versements cumulés. */
  contributions: number;
  interest: number;
  total: number;
}

/** Taux effectif net : rendement − frais, et moins l'inflation pour raisonner en euros d'aujourd'hui. */
export function effectiveRate(returnBp: number, feesBp: number, inflationBp: number | null): number {
  const nominal = (returnBp - feesBp) / 10000;
  return inflationBp === null ? nominal : (1 + nominal) / (1 + inflationBp / 10000) - 1;
}

function stepper(p: CompoundParams) {
  const rm = Math.pow(1 + p.annualRate, 1 / 12) - 1;
  let value = p.initial;
  let paid = p.initial;
  let month = 0;
  return {
    next() {
      const deposit = p.monthly * Math.pow(1 + (p.savingsGrowth ?? 0), Math.floor(month / 12));
      value = value * (1 + rm) + deposit;
      paid += deposit;
      month++;
      return { value, paid };
    },
  };
}

/** Capital, versements et intérêts à la fin de chaque année (année 0 = aujourd'hui). */
export function compoundSchedule(p: CompoundParams, years: number): CompoundYear[] {
  const out: CompoundYear[] = [{ year: 0, contributions: p.initial, interest: 0, total: p.initial }];
  const s = stepper(p);
  for (let y = 1; y <= years; y++) {
    let r = { value: 0, paid: 0 };
    for (let m = 0; m < 12; m++) r = s.next();
    out.push({ year: y, contributions: Math.round(r.paid), interest: Math.round(r.value - r.paid), total: Math.round(r.value) });
  }
  return out;
}

/** Mois pour que le capital atteigne `target` (null au-delà de `maxMonths`). */
export function monthsToReach(p: CompoundParams, target: number, maxMonths = 12 * 80): number | null {
  if (p.initial >= target) return 0;
  const s = stepper(p);
  for (let m = 1; m <= maxMonths; m++) if (s.next().value >= target) return m;
  return null;
}

/** Épargne mensuelle (de départ) nécessaire pour atteindre `target` en `months` mois, à 1 € près. */
export function monthlyNeeded(p: Omit<CompoundParams, 'monthly'>, target: number, months: number): number {
  if (monthsToReach({ ...p, monthly: 0 }, target, months) !== null) return 0;
  let lo = 0;
  let hi = Math.max(100, target);
  for (let i = 0; i < 60 && hi - lo > 100; i++) {
    const mid = (lo + hi) / 2;
    if (monthsToReach({ ...p, monthly: mid }, target, months) !== null) hi = mid;
    else lo = mid;
  }
  return Math.ceil(hi / 100) * 100;
}

/** Revenu mensuel net qu'un capital peut verser durablement (taux de retrait, impôt sur les retraits). */
export function passiveMonthly(capital: number, withdrawalBp: number, tax: number): number {
  return Math.round((capital * (withdrawalBp / 10000) * Math.max(0.5, 1 - tax)) / 12);
}

/** Postes de dépense qu'on peut réduire (hors charges fixes), du plus gros au plus petit, par mois. */
export function reducibleSpending(breakdown: Pick<SpendingBreakdown, 'byCategory'>, cats: ReadonlyMap<string, Category>, limit = 6): { id: string; monthly: number }[] {
  return breakdown.byCategory
    .filter((c) => c.id !== '_none' && cats.get(c.id)?.kind !== 'fixed')
    .slice(0, limit)
    .map((c) => ({ id: c.id, monthly: Math.round(c.annual / 12) }));
}

/** Somme mensuelle libérée par des baisses par poste (`cuts` : id → part de 0 à 1). */
export function cutsMonthly(reducible: readonly { id: string; monthly: number }[], cuts: Readonly<Record<string, number>>): number {
  return reducible.reduce((s, c) => s + Math.round(c.monthly * Math.min(1, Math.max(0, cuts[c.id] ?? 0))), 0);
}

export const MILESTONES = [0.1, 0.25, 0.5, 0.75, 1];

/** Palier le plus haut atteint (0 si aucun). */
export function milestoneReached(progress: number): number {
  return MILESTONES.filter((m) => progress >= m).pop() ?? 0;
}

// ---------------------------------------------------------------- calcul commun (écrans Patrimoine et FI)

export interface FireState {
  /** Capital pris en compte aujourd'hui. */
  current: number;
  /** Rendement réel net (frais et inflation déduits). */
  realRate: number;
  withdrawalBp: number;
  /** Impôt moyen sur les retraits (0 → 1). */
  tax: number;
  /** Dépenses réelles (12 derniers mois ramenés à l'année, ou budget × 12). */
  breakdown: SpendingBreakdown;
  /** Train de vie visé une fois indépendant, par an (saisi, ou dépenses réelles). */
  annualSpending: number;
  /** Le train de vie visé suit les dépenses réelles (pas de montant saisi). */
  spendingAuto: boolean;
  monthly: number;
  /** Capital nécessaire pour vivre de ses placements. */
  target: number;
  /** Mois avant l'objectif à ce rythme (null au-delà de 80 ans). */
  months: number | null;
  progress: number;
}

/**
 * Capital pris en compte (placements + comptes épargne, sauf exclusions), train de vie visé, impôt sur
 * les retraits, date atteinte au rythme donné. Une seule source pour tous les écrans.
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
  const breakdown = spendingBreakdown(input.txs, input.cats, input.settings, input.today);
  const spendingAuto = f.annualSpendingOverride === null;
  const annualSpending = spendingAuto ? breakdown.annual : (f.annualSpendingOverride ?? 0);
  const tax = withdrawalTaxRate(summaries);
  const realRate = effectiveRate(f.annualReturnBp, f.feesBp, f.inflationBp);
  const target = grossTarget(annualSpending, f.withdrawalBp, tax);
  const monthly = Math.max(0, input.monthly);
  const months = target > 0 ? monthsToTarget(current, monthly, realRate, target) : null;
  return { current, realRate, withdrawalBp: f.withdrawalBp, tax, breakdown, annualSpending, spendingAuto, monthly, target, months, progress: target > 0 ? Math.min(1, current / target) : 0 };
}
