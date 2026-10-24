import type { Account, Category, InvestmentPlan, Settings, Transaction } from '../db/types';
import { addDays, diffDays, type ISODate } from '../lib/dates';
import { isVariable, spent } from './budget';
import { CAT } from './defaults';
import type { Recurring } from './recurring';
import { buildRecurringList, itemDates, type RecurringItem } from './recurringList';

/**
 * Prévision de trésorerie : le solde des comptes courants jour par jour jusqu'à une date, à partir
 * de la liste unique des récurrents (revenus et charges saisis ou détectés, investissements programmés, voir
 * recurringList.ts) et du rythme habituel des dépenses courantes. Répond à « vais-je finir le mois dans le vert ? ».
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

export function buildForecast(input: {
  today: ISODate;
  until: ISODate;
  startBalance: number;
  recurring: readonly Recurring[];
  cats: ReadonlyMap<string, Category>;
  settings: Pick<Settings, 'incomes' | 'fixedCharges'>;
  plans: readonly (InvestmentPlan & { label: string })[];
  dailySpend: number;
  /** La liste unique des récurrents, si elle est déjà calculée (sinon construite ici). */
  items?: readonly RecurringItem[];
  /** Fin du cycle en cours : les récurrents sautés ce mois n'y ont pas d'échéance. */
  cycleEnd?: ISODate;
}): Forecast {
  const { today, until, startBalance, dailySpend } = input;
  const from = addDays(today, 1);
  const events: ForecastEvent[] = [];
  // Une seule liste (réglages, plans, détectés rapprochés) : chaque flux n'y est qu'une fois.
  const items = input.items ?? buildRecurringList({ detected: input.recurring, cats: input.cats, settings: input.settings, plans: input.plans, today });
  for (const item of items) {
    if (item.direct) continue;
    const sign = item.kind === 'income' ? 1 : -1;
    const source: ForecastEvent['source'] = item.detected ? 'recurring' : item.source === 'plan' ? 'plan' : item.kind === 'income' ? 'income' : 'charge';
    const amount = item.detected ? item.detected.amount : sign * item.amount;
    for (const date of itemDates(item, input.plans, from, until)) {
      if (item.skipped && input.cycleEnd && date <= input.cycleEnd) continue;
      events.push({ date, label: item.label, amount, source, categoryId: item.kind === 'savings' ? CAT.epargne : item.categoryId });
    }
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
