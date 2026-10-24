import type { BudgetLine, Category, InvestmentPlan, Settings, Transaction } from '../db/types';
import { daysInMonth, parseISO, toISO, type Cycle, type ISODate } from '../lib/dates';
import { normalizeText } from '../lib/text';
import { CAT } from './defaults';
import { monthlyEquivalent, nextOccurrence, occurrences } from './plans';
import { recurringDates, type Cadence, type Recurring } from './recurring';

/**
 * Une seule liste de récurrents (refonte de MyFinances, étape 3) : revenus et charges des réglages, investissements
 * programmés et récurrences détectées dans les opérations, rapprochés par **une seule règle** (`sameFlow`). Un
 * prélèvement détecté qui correspond à une ligne des réglages ou à un plan ne fait qu'un avec elle : il lui donne son
 * jour et dit s'il est déjà passé ce cycle. La prévision de trésorerie et le budget lisent cette liste.
 */

export type RecurringKind = 'income' | 'charge' | 'subscription' | 'savings';

export interface RecurringItem {
  /** `line:<id>` (réglages), `plan:<id>` (investissement programmé) ou `det:<clé>` (détecté seulement). */
  id: string;
  kind: RecurringKind;
  label: string;
  /** Montant d'une échéance, positif, en centimes. */
  amount: number;
  /** Équivalent mensuel, positif. */
  monthly: number;
  cadence: Cadence;
  /** Jour du mois (mensuel) : celui des réglages, sinon celui constaté à la banque. */
  day: number | null;
  /** D'où vient la ligne. */
  source: 'settings' | 'plan' | 'detected';
  /** Récurrence détectée qui correspond (même flux vu à la banque), si elle existe. */
  detected: Recurring | null;
  /** Saisi (réglages, plan) ou confirmé ; un détecté seul attend une confirmation. */
  confirmed: boolean;
  /** Revenu versé directement à un tiers (n'arrive jamais sur le compte). */
  direct: boolean;
  categoryId: string | null;
  lineId?: string;
  planId?: string;
  nextDate: ISODate | null;
  /** Opération du cycle qui correspond (déjà payé ou reçu). */
  paid: Transaction | null;
  /** Sauté pour le cycle en cours (« sauter ce mois »). */
  skipped: boolean;
}

/** Échéances sautées, par cycle (date de début). Le montant sert à l'enveloppe des cycles passés aussi. */
export interface RecurringSkip {
  id: string;
  kind: RecurringKind;
  amount: number;
}
export type RecurringSkips = Readonly<Record<string, readonly RecurringSkip[]>>;
/** Clé (table meta, synchronisée) des récurrents sautés. */
export const RECURRING_SKIPS_KEY = 'recurringSkips';

const STOP = new Set(['loyer', 'charge', 'charges', 'abonnement', 'forfait', 'mensuel', 'facture', 'virement', 'prelevement', 'investissement']);
export function significantWords(label: string): string[] {
  return normalizeText(label)
    .split(' ')
    .filter((w) => w.length >= 4 && !STOP.has(w));
}

/**
 * La règle de rapprochement, la seule : même montant à 10 % près (plus 1 €), au même moment du mois (5 jours) quand
 * les deux jours sont connus ; ou un libellé qui cite l'autre.
 */
export function sameFlow(a: { amount: number; day?: number | null; label?: string }, b: { amount: number; day?: number | null; label?: string }): boolean {
  const x = Math.abs(a.amount);
  const y = Math.abs(b.amount);
  const closeAmount = Math.abs(x - y) <= Math.max(x, y) * 0.1 + 100;
  const closeDay = a.day == null || b.day == null || Math.min(Math.abs(a.day - b.day), 31 - Math.abs(a.day - b.day)) <= 5;
  if (closeAmount && closeDay) return true;
  if (!a.label || !b.label) return false;
  const words = significantWords(a.label);
  const other = normalizeText(b.label);
  return words.length > 0 && words.some((w) => other.includes(w));
}

const detectedKind = (r: Recurring): RecurringKind => (r.kind === 'income' ? 'income' : r.categoryId === CAT.epargne ? 'savings' : r.subscription ? 'subscription' : 'charge');

/** Une récurrence détectée qui compte comme un flux (pas une dépense courante, pas un virement entre mes comptes). */
export function isFlow(r: Recurring, cats: ReadonlyMap<string, Category>): boolean {
  if (!r.active || r.status === 'ignored') return false;
  if (r.categoryId === CAT.transferts) return false;
  const kind = r.categoryId ? cats.get(r.categoryId)?.kind : undefined;
  return r.kind === 'income' || kind !== 'variable';
}

function nextMonthlyDay(day: number, today: ISODate): ISODate {
  let { y, m } = parseISO(today);
  for (let i = 0; i < 2; i++) {
    const d = toISO(y, m, Math.min(day, daysInMonth(y, m)));
    if (d >= today) return d;
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return toISO(y, m, Math.min(day, daysInMonth(y, m)));
}

export interface RecurringListInput {
  detected: readonly Recurring[];
  cats: ReadonlyMap<string, Category>;
  settings: Pick<Settings, 'incomes' | 'fixedCharges'>;
  plans: readonly (InvestmentPlan & { label: string })[];
  today: ISODate;
  /** Cycle en cours et ses opérations : pour « déjà payé » et « sauté ce mois ». */
  cycle?: Cycle | null;
  txs?: readonly Transaction[];
  skips?: RecurringSkips;
}

export function buildRecurringList(input: RecurringListInput): RecurringItem[] {
  const { cats, today } = input;
  const flows = input.detected.filter((r) => isFlow(r, cats));
  const used = new Set<string>();
  const skipped = new Set((input.cycle ? input.skips?.[input.cycle.start] ?? [] : []).map((s) => s.id));
  const inCycle = (r: Recurring | null) => {
    if (!r || !input.cycle || !input.txs) return null;
    const ids = new Set(r.txIds);
    return input.txs.find((t) => ids.has(t.id) && t.date >= input.cycle!.start && t.date <= input.cycle!.end) ?? null;
  };
  // Le détecté qui correspond, parmi ceux du bon sens (entrée / sortie) pas encore pris.
  const match = (amount: number, day: number | null, label: string, kind: 'income' | 'expense', savings: boolean) => {
    const r = flows.find((x) => !used.has(x.key) && x.kind === kind && (x.categoryId === CAT.epargne) === savings && sameFlow({ amount, day, label }, { amount: x.amount, day: x.dayOfMonth, label: x.label }));
    if (r) used.add(r.key);
    return r ?? null;
  };

  const out: RecurringItem[] = [];
  const fromLine = (l: BudgetLine, kind: 'income' | 'charge') => {
    const detected = l.direct ? null : match(l.amount, l.day, l.label, kind === 'income' ? 'income' : 'expense', false);
    const day = l.day ?? detected?.dayOfMonth ?? null;
    out.push({
      id: `line:${l.id}`,
      kind: kind === 'charge' && detected?.subscription ? 'subscription' : kind,
      label: l.label,
      amount: l.amount,
      monthly: l.amount,
      cadence: 'monthly',
      day,
      source: 'settings',
      detected,
      confirmed: true,
      direct: l.direct === true,
      categoryId: detected?.categoryId ?? null,
      lineId: l.id,
      nextDate: detected?.nextDate ?? (day ? nextMonthlyDay(day, today) : null),
      paid: inCycle(detected),
      skipped: skipped.has(`line:${l.id}`),
    });
  };
  for (const l of input.settings.incomes) if (l.amount > 0) fromLine(l, 'income');
  for (const l of input.settings.fixedCharges) if (l.amount > 0) fromLine(l, 'charge');
  for (const p of input.plans) {
    if (!p.active) continue;
    const detected = match(p.amount, p.frequency === 'monthly' ? p.day : null, p.label, 'expense', true);
    out.push({
      id: `plan:${p.id}`,
      kind: 'savings',
      label: p.label,
      amount: p.amount,
      monthly: monthlyEquivalent(p),
      cadence: p.frequency,
      day: p.frequency === 'monthly' ? p.day : null,
      source: 'plan',
      detected,
      confirmed: true,
      direct: false,
      categoryId: CAT.epargne,
      planId: p.id,
      nextDate: detected?.nextDate ?? nextOccurrence(p, today),
      paid: inCycle(detected),
      skipped: skipped.has(`plan:${p.id}`),
    });
  }
  for (const r of flows) {
    if (used.has(r.key)) continue;
    out.push({
      id: `det:${r.key}`,
      kind: detectedKind(r),
      label: r.label,
      amount: Math.abs(r.amount),
      monthly: Math.abs(r.monthly),
      cadence: r.cadence,
      day: r.dayOfMonth,
      source: 'detected',
      detected: r,
      confirmed: r.status === 'confirmed',
      direct: false,
      categoryId: r.categoryId,
      nextDate: r.nextDate,
      paid: inCycle(r),
      skipped: skipped.has(`det:${r.key}`),
    });
  }
  return out;
}

/** Échéances d'un récurrent entre deux dates (incluses) : le rythme vu à la banque, sinon le jour saisi ou le plan. */
export function itemDates(item: RecurringItem, plans: readonly InvestmentPlan[], from: ISODate, to: ISODate): ISODate[] {
  if (item.detected) return recurringDates(item.detected, from, to);
  if (item.planId) {
    const plan = plans.find((p) => p.id === item.planId);
    return plan ? occurrences(plan, from, to) : [];
  }
  if (!item.day) return [];
  const out: ISODate[] = [];
  let { y, m } = parseISO(from);
  for (let i = 0; i < 26; i++) {
    const d = toISO(y, m, Math.min(item.day, daysInMonth(y, m)));
    if (d > to) break;
    if (d >= from) out.push(d);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/** Montants sautés d'un cycle : charges des réglages (pour l'enveloppe) et épargne (pour l'épargne prévue). */
export function skippedAmounts(skips: RecurringSkips | undefined, cycleStart: ISODate): { lineCharges: number; savings: number; lineIds: Set<string> } {
  const list = skips?.[cycleStart] ?? [];
  const lineIds = new Set(list.filter((s) => s.id.startsWith('line:') && (s.kind === 'charge' || s.kind === 'subscription')).map((s) => s.id.slice(5)));
  return {
    lineCharges: list.filter((s) => s.id.startsWith('line:') && (s.kind === 'charge' || s.kind === 'subscription')).reduce((n, s) => n + s.amount, 0),
    savings: list.filter((s) => s.kind === 'savings').reduce((n, s) => n + s.amount, 0),
    lineIds,
  };
}
