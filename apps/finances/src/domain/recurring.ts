import type { Category, RecurringOverride, Transaction } from '../db/types';
import { addDays, daysInMonth, diffDays, parseISO, toISO, type ISODate } from '../lib/dates';
import { normalizeText } from '../lib/text';
import { CAT } from './defaults';

/**
 * Détection des récurrences (abonnements, loyers, salaires, versements programmés) à partir des
 * opérations, sans rien saisir : même commerçant, montant stable, intervalle régulier.
 */

export type Cadence = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';

export const CADENCE_LABEL: Record<Cadence, string> = {
  weekly: 'chaque semaine',
  biweekly: 'toutes les 2 semaines',
  monthly: 'chaque mois',
  quarterly: 'chaque trimestre',
  yearly: 'chaque année',
};

const CADENCES: { cadence: Cadence; days: number; min: number; max: number; minCount: number }[] = [
  { cadence: 'weekly', days: 7, min: 5, max: 9, minCount: 4 },
  { cadence: 'biweekly', days: 14, min: 11, max: 17, minCount: 3 },
  { cadence: 'monthly', days: 30.44, min: 25, max: 36, minCount: 3 },
  { cadence: 'quarterly', days: 91.3, min: 80, max: 102, minCount: 2 },
  { cadence: 'yearly', days: 365.25, min: 350, max: 380, minCount: 2 },
];

export interface Recurring {
  key: string;
  label: string;
  categoryId: string | null;
  cadence: Cadence;
  /** Montant habituel signé (médiane), en centimes. */
  amount: number;
  lastAmount: number;
  lastDate: ISODate;
  nextDate: ISODate;
  /** Jour du mois habituel (mensuel), sinon null. */
  dayOfMonth: number | null;
  count: number;
  /** Coût (ou revenu) ramené au mois, signé. */
  monthly: number;
  kind: 'income' | 'expense';
  /** Abonnement : charge fixe régulière (catégorie fixe / abonnements, ou petit montant identique chaque mois). */
  subscription: boolean;
  /** Changement de prix à la dernière échéance. */
  priceChange: { from: number; to: number } | null;
  /** Encore en cours (la dernière échéance n'est pas trop ancienne). */
  active: boolean;
  status: RecurringOverride['status'] | 'auto';
  txIds: string[];
}

const NOISE = new Set([
  'prlv',
  'prelevement',
  'sepa',
  'cb',
  'carte',
  'vir',
  'virement',
  'recu',
  'emis',
  'inst',
  'facture',
  'paiement',
  'payment',
  'achat',
  'du',
  'de',
  'des',
  'la',
  'le',
  'les',
  'fr',
  'www',
  'com',
  'sa',
  'sas',
  'europe',
  'ltd',
  'by',
]);

/** Clé du « même commerçant » : libellé normalisé, sans chiffres ni mots bancaires. */
export function merchantKey(label: string): string {
  return normalizeText(label)
    .replace(/\d+/g, ' ')
    .split(' ')
    .filter((w) => w.length > 1 && !NOISE.has(w))
    .slice(0, 3)
    .join(' ');
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : Math.round(((s[mid - 1] as number) + (s[mid] as number)) / 2);
};

function nextMonthly(last: ISODate, day: number): ISODate {
  let { y, m } = parseISO(last);
  m++;
  if (m > 12) {
    m = 1;
    y++;
  }
  return toISO(y, m, Math.min(day, daysInMonth(y, m)));
}

/** Échéances d'une récurrence entre deux dates (incluses), pour les prévisions. */
export function recurringDates(r: Pick<Recurring, 'cadence' | 'nextDate' | 'dayOfMonth'>, from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  let d = r.nextDate;
  const spec = CADENCES.find((c) => c.cadence === r.cadence)!;
  let guard = 0;
  while (d <= to && guard++ < 400) {
    if (d >= from) out.push(d);
    if (r.cadence === 'monthly' && r.dayOfMonth) d = nextMonthly(d, r.dayOfMonth);
    else d = addDays(d, Math.round(spec.days));
  }
  return out;
}

export function detectRecurring(
  txs: readonly Transaction[],
  cats: ReadonlyMap<string, Category>,
  today: ISODate,
  overrides: readonly RecurringOverride[] = [],
): Recurring[] {
  const groups = new Map<string, Transaction[]>();
  const from = addDays(today, -460);
  for (const t of txs) {
    if (t.pending || t.date < from || t.date > today || t.amount === 0) continue;
    // Les transferts entre ses propres comptes s'annulent : ce ne sont pas des flux.
    if (t.categoryId === CAT.transferts || t.transferPairId) continue;
    const m = merchantKey(t.label);
    if (!m) continue;
    const key = `${t.amount < 0 ? '-' : '+'}${m}`;
    const g = groups.get(key);
    if (g) g.push(t);
    else groups.set(key, [t]);
  }
  const byKey = new Map(overrides.map((o) => [o.key, o]));
  const out: Recurring[] = [];

  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    // Plusieurs opérations le même jour (aller-retour, double débit) : on garde la plus grosse.
    const perDay: Transaction[] = [];
    for (const t of sorted) {
      const last = perDay[perDay.length - 1];
      if (last && last.date === t.date) {
        if (Math.abs(t.amount) > Math.abs(last.amount)) perDay[perDay.length - 1] = t;
      } else perDay.push(t);
    }
    if (perDay.length < 2) continue;
    const intervals = perDay.slice(1).map((t, i) => diffDays((perDay[i] as Transaction).date, t.date));
    const mid = median(intervals);
    const spec = CADENCES.find((c) => mid >= c.min && mid <= c.max);
    if (!spec) continue;
    const regular = intervals.filter((d) => d >= spec.min && d <= spec.max).length / intervals.length;
    if (regular < 0.75) continue;
    const amounts = perDay.map((t) => t.amount);
    const med = median(amounts);
    const income = med > 0;
    const tolerance = income ? 0.4 : 0.3;
    const stable = amounts.every((a) => Math.abs(a - med) <= Math.abs(med) * tolerance);
    if (!stable) continue;
    const identical = amounts.every((a) => Math.abs(a - med) <= Math.max(1, Math.abs(med) * 0.01));
    const enough = perDay.length >= spec.minCount || (spec.cadence === 'monthly' && identical && perDay.length >= 2);
    if (!enough) continue;

    const last = perDay[perDay.length - 1] as Transaction;
      const dayOfMonth = spec.cadence === 'monthly' ? median(perDay.map((t) => parseISO(t.date).d)) : null;
    const nextDate = dayOfMonth ? nextMonthly(last.date, dayOfMonth) : addDays(last.date, Math.round(spec.days));
    const active = diffDays(last.date, today) <= Math.round(spec.days * 1.6) + 3;
    const catCount = new Map<string, number>();
    for (const t of perDay) if (t.categoryId) catCount.set(t.categoryId, (catCount.get(t.categoryId) ?? 0) + 1);
    const categoryId = [...catCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const cat = categoryId ? cats.get(categoryId) : undefined;
    // Changement de prix : dernier montant différent d'un montant antérieur, dans les 3 dernières échéances.
    const differs = (a: number) => Math.abs(a - last.amount) >= Math.max(50, Math.abs(last.amount) * 0.02);
    let changeAt = -1;
    for (let i = perDay.length - 2; i >= 0; i--)
      if (differs((perDay[i] as Transaction).amount)) {
        changeAt = i;
        break;
      }
    const priceChange =
      !income && perDay.length >= 3 && (spec.cadence === 'monthly' || spec.cadence === 'yearly') && changeAt >= 0 && perDay.length - 1 - changeAt <= 3
        ? { from: -(perDay[changeAt] as Transaction).amount, to: -last.amount }
        : null;
    const o = byKey.get(key);
    out.push({
      key,
      label: o?.label ?? last.label,
      categoryId,
      cadence: spec.cadence,
      // Après un changement de prix, c'est le nouveau montant qui compte pour la suite.
      amount: priceChange ? last.amount : med,
      lastAmount: last.amount,
      lastDate: last.date,
      nextDate,
      dayOfMonth,
      count: perDay.length,
      monthly: Math.round(((priceChange ? last.amount : med) * 30.44) / spec.days),
      kind: income ? 'income' : 'expense',
      subscription:
        !income &&
        (categoryId === CAT.abonnements || (spec.cadence !== 'weekly' && spec.cadence !== 'biweekly' && identical && -med <= 10000 && categoryId !== CAT.logement && categoryId !== CAT.epargne && cat?.kind !== 'excluded')),
      priceChange,
      active,
      status: o?.status ?? 'auto',
      txIds: perDay.map((t) => t.id),
    });
  }
  return out.sort((a, b) => Math.abs(b.monthly) - Math.abs(a.monthly));
}

/** Coût mensuel total des abonnements actifs (non ignorés). */
export function subscriptionsMonthly(list: readonly Recurring[]): number {
  return list.filter((r) => r.active && r.subscription && r.status !== 'ignored').reduce((s, r) => s - r.monthly, 0);
}
