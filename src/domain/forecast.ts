import type { Account, Category, InvestmentPlan, Settings, Transaction } from '../db/types';
import { addDays, daysInMonth, diffDays, parseISO, toISO, type ISODate } from '../lib/dates';
import { isVariable, spent } from './budget';
import { CAT } from './defaults';
import { occurrences } from './plans';
import { recurringDates, type Recurring } from './recurring';

/**
 * Prévision de trésorerie : le solde des comptes courants jour par jour jusqu'à une date, à partir
 * des revenus et charges récurrents (détectés ou saisis), des investissements programmés et du rythme
 * habituel des dépenses courantes. Répond à « vais-je finir le mois dans le vert ? ».
 */

export interface ForecastEvent {
  date: ISODate;
  label: string;
  /** Signé, en centimes. */
  amount: number;
  source: 'recurring' | 'income' | 'charge' | 'plan';
  categoryId?: string | null;
}

export interface Forecast {
  start: number;
  points: { date: ISODate; balance: number }[];
  events: ForecastEvent[];
  lowest: { date: ISODate; balance: number };
  end: number;
  /** Dépense courante quotidienne retenue. */
  dailySpend: number;
}

/** Comptes pris en compte : comptes courants visibles avec un solde connu (pas l'épargne). */
export function forecastAccounts(accounts: readonly Account[]): Account[] {
  return accounts.filter((a) => !a.hidden && a.balance !== null && (a.kind ?? 'current') !== 'savings');
}

/** Rythme quotidien des dépenses courantes sur les `days` derniers jours (hors aujourd'hui). */
export function averageDailySpend(txs: readonly Transaction[], cats: ReadonlyMap<string, Category>, today: ISODate, days = 56): number {
  const from = addDays(today, -days);
  const window = txs.filter((t) => t.date >= from && t.date < today);
  if (window.length === 0) return 0;
  const first = window.reduce((m, t) => (t.date < m ? t.date : m), today);
  const span = Math.max(7, Math.min(days, diffDays(first, today)));
  return Math.max(0, Math.round(spent(window, cats as Map<string, Category>, isVariable) / span));
}

function monthlyDates(day: number, from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  let { y, m } = parseISO(from);
  for (let i = 0; i < 26; i++) {
    const d = toISO(y, m, Math.min(day, daysInMonth(y, m)));
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

const close = (a: number, b: number) => Math.abs(Math.abs(a) - Math.abs(b)) <= Math.abs(b) * 0.1 + 100;

export function buildForecast(input: {
  today: ISODate;
  until: ISODate;
  startBalance: number;
  recurring: readonly Recurring[];
  cats: ReadonlyMap<string, Category>;
  settings: Pick<Settings, 'incomes' | 'fixedCharges'>;
  plans: readonly (InvestmentPlan & { label: string })[];
  dailySpend: number;
}): Forecast {
  const { today, until, startBalance, cats, dailySpend } = input;
  const from = addDays(today, 1);
  const events: ForecastEvent[] = [];
  // Récurrences détectées (hors dépenses courantes déjà dans le rythme quotidien, hors ignorées).
  const used = input.recurring.filter((r) => {
    if (!r.active || r.status === 'ignored') return false;
    // Virements entre mes comptes : l'argent reste sur les comptes, ni entrée ni sortie.
    if (r.categoryId === CAT.transferts) return false;
    const kind = r.categoryId ? cats.get(r.categoryId)?.kind : undefined;
    return r.kind === 'income' || kind !== 'variable';
  });
  for (const r of used) for (const date of recurringDates(r, from, until)) events.push({ date, label: r.label, amount: r.amount, source: 'recurring', categoryId: r.categoryId });

  const monthlyRecurring = used.filter((r) => r.cadence === 'monthly');
  const covered = (amount: number, day: number | null, kind: 'income' | 'expense') =>
    monthlyRecurring.some((r) => r.kind === kind && close(r.amount, amount) && (day === null || r.dayOfMonth === null || Math.abs(r.dayOfMonth - day) <= 5));

  // Lignes saisies dans les réglages (avec un jour), si les données bancaires ne les montrent pas déjà.
  for (const l of input.settings.incomes) {
    if (!l.day || covered(l.amount, l.day, 'income')) continue;
    for (const date of monthlyDates(l.day, from, until)) events.push({ date, label: l.label, amount: l.amount, source: 'income' });
  }
  for (const l of input.settings.fixedCharges) {
    if (!l.day || covered(-l.amount, l.day, 'expense')) continue;
    for (const date of monthlyDates(l.day, from, until)) events.push({ date, label: l.label, amount: -l.amount, source: 'charge' });
  }
  // Investissements programmés, sauf si un versement récurrent vers l'épargne les représente déjà.
  for (const p of input.plans) {
    if (!p.active) continue;
    const already = used.some((r) => r.kind === 'expense' && r.categoryId === CAT.epargne && close(r.amount, -p.amount) && (r.cadence === 'monthly') === (p.frequency === 'monthly'));
    if (already) continue;
    for (const date of occurrences(p, from, until)) events.push({ date, label: p.label, amount: -p.amount, source: 'plan', categoryId: CAT.epargne });
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || a.amount - b.amount);

  const byDay = new Map<ISODate, number>();
  for (const e of events) byDay.set(e.date, (byDay.get(e.date) ?? 0) + e.amount);
  const points = [{ date: today, balance: startBalance }];
  let balance = startBalance;
  let lowest = { date: today, balance };
  for (let d = from; d <= until; d = addDays(d, 1)) {
    balance += (byDay.get(d) ?? 0) - dailySpend;
    points.push({ date: d, balance });
    if (balance < lowest.balance) lowest = { date: d, balance };
  }
  return { start: startBalance, points, events, lowest, end: balance, dailySpend };
}
