import type { Category, FireSettings, Settings, Transaction } from '../db/types';
import { addDays, diffDays, type ISODate } from '../lib/dates';
import { isSpending, spent } from './budget';
import { computeEnvelope, totalFixed } from './defaults';

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
