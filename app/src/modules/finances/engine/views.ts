import { addDays, cycleFor, diffDays, inRange, type Cycle, type ISODate } from '../core/dates';
import { envelopeOf, resolveCategory, weight, type Explanation } from './engine';
import { buildOccurrences, currentCycle } from './occurrences';
import type { Db } from './schema';

/**
 * Ce que montrent les écrans (étape M5) : des séries et des regroupements tirés du moteur. Fonctions pures.
 * Deux vues coexistent, comme dans la conception : la vue **budget** (ce qui pèse dans le quotidien, d'après
 * `weight`) et la vue **analyse** (le montant complet de chaque dépense, là où il a été dépensé).
 */

/** Les cycles, du plus ancien au plus récent, le dernier étant celui de `today`. */
export function lastCycles(db: Db, today: ISODate, n: number): Cycle[] {
  const out = [currentCycle(db, today)];
  while (out.length < n) {
    const prev = cycleFor(addDays(out[0]!.start, -1), db.settings.payday);
    out.unshift({ start: prev.start, end: addDays(out[0]!.start, -1) });
  }
  return out;
}

/** Les opérations qui règlent une échéance prévue, sur ces cycles : elles ne pèsent pas une seconde fois. */
export function settledIn(db: Db, cycles: readonly Cycle[]): Set<string> {
  return new Set(cycles.flatMap((c) => buildOccurrences(db, c).flatMap((o) => o.transactionIds)));
}

/** Vue budget : ce qui a pesé dans le quotidien, jour par jour. */
export function spendByDay(db: Db, settled: ReadonlySet<string>, from: ISODate, to: ISODate): Map<ISODate, number> {
  const dates = new Map(db.transactions.map((t) => [t.id, t.date]));
  const out = new Map<ISODate, number>();
  for (const a of db.allocations) {
    const date = dates.get(a.transactionId);
    if (!date || !inRange(date, from, to)) continue;
    const w = weight(a, settled);
    if (w !== 0 && envelopeOf(db, a.categoryId).inDailyBudget) out.set(date, (out.get(date) ?? 0) + w);
  }
  return out;
}

export interface Slice {
  id: string | null;
  name: string;
  color: string;
  amount: number;
}

/**
 * Vue analyse : les dépenses d'une période par catégorie de premier niveau (une sous-catégorie compte pour sa
 * parente, une catégorie fusionnée pour sa cible). Montants complets ; un remboursement classé réduit sa catégorie ;
 * la part avancée pour quelqu'un n'est pas ta dépense. Les plus grosses d'abord.
 */
export function byCategory(db: Db, from: ISODate, to: ISODate): Slice[] {
  const dates = new Map(db.transactions.map((t) => [t.id, t.date]));
  const cats = new Map(db.categories.map((c) => [c.id, c]));
  const sums = new Map<string | null, number>();
  for (const a of db.allocations) {
    const date = dates.get(a.transactionId);
    if (!date || !inRange(date, from, to)) continue;
    const expense = a.flow === 'EXPENSE' || (a.flow === null && a.amount < 0);
    const refund = a.flow === 'REFUND' && !a.settlesReceivableId && (a.categoryId || a.linkedTransactionId);
    if (!expense && !refund) continue;
    const id = resolveCategory(db, a.categoryId);
    const top = id ? (cats.get(id)?.parentId ?? id) : null;
    sums.set(top, (sums.get(top) ?? 0) - a.amount - (expense ? (a.receivableAmount ?? 0) : 0));
  }
  return [...sums]
    .filter(([, amount]) => amount > 0)
    .map(([id, amount]) => ({ id, name: id ? (cats.get(id)?.name ?? '?') : 'À classer', color: id ? (cats.get(id)?.color ?? '#94a3b8') : '#94a3b8', amount }))
    .sort((a, b) => b.amount - a.amount);
}

/** Revenus et dépenses de chaque cycle (vue analyse) : l'épargne et les virements n'y sont pas. */
export function cashflow(db: Db, cycles: readonly Cycle[], today: ISODate): { cycle: Cycle; income: number; expense: number }[] {
  const dates = new Map(db.transactions.map((t) => [t.id, t.date]));
  return cycles.map((cycle) => {
    let income = 0;
    let expense = 0;
    for (const a of db.allocations) {
      const date = dates.get(a.transactionId);
      if (!date || !inRange(date, cycle.start, cycle.end < today ? cycle.end : today)) continue;
      if (a.flow === 'INCOME') income += a.amount;
      else if (a.flow === 'EXPENSE' || (a.flow === null && a.amount < 0)) expense += -a.amount - (a.receivableAmount ?? 0);
      else if (a.flow === 'REFUND' && !a.settlesReceivableId) expense -= a.amount;
    }
    return { cycle, income, expense: Math.max(0, expense) };
  });
}

/** Où part l'argent : les marchands d'une période, par montant dépensé. */
export function topMerchants(db: Db, from: ISODate, to: ISODate, n: number): { id: string; name: string; count: number; amount: number; color: string }[] {
  const names = new Map(db.merchants.map((m) => [m.id, m.name]));
  const cats = new Map(db.categories.map((c) => [c.id, c]));
  const txs = new Map(db.transactions.map((t) => [t.id, t]));
  const out = new Map<string, { id: string; name: string; count: number; amount: number; color: string }>();
  for (const a of db.allocations) {
    const t = txs.get(a.transactionId);
    if (!t || !inRange(t.date, from, to) || !(a.flow === 'EXPENSE' || (a.flow === null && a.amount < 0))) continue;
    const id = t.merchantId ?? `label:${t.rawLabel}`;
    const row = out.get(id) ?? { id, name: (t.merchantId && names.get(t.merchantId)) || t.rawLabel, count: 0, amount: 0, color: '#94a3b8' };
    row.count++;
    row.amount += -a.amount;
    const cat = resolveCategory(db, a.categoryId);
    if (cat) row.color = cats.get(cats.get(cat)?.parentId ?? cat)?.color ?? row.color;
    out.set(id, row);
  }
  return [...out.values()].sort((a, b) => b.amount - a.amount).slice(0, n);
}

export interface ForecastPoint {
  date: ISODate;
  balance: number;
  /** Ce qui tombe ce jour-là (libellés), pour annoter la courbe. */
  events: { label: string; amount: number }[];
}

/**
 * Le solde des comptes du quotidien, jour par jour jusqu'à la fin du cycle : le solde d'aujourd'hui, moins les
 * échéances encore dues à leur date (toutes, réservées ou non : ici on regarde ce qui va vraiment sortir), plus les
 * revenus attendus, moins le budget du jour dépensé chaque jour. Répond à « où j'en serai, et quel sera le point bas ».
 */
export function forecast(db: Db, e: Explanation): { points: ForecastPoint[]; low: ForecastPoint } {
  const daily = new Set(db.accounts.filter((a) => a.includeInDailyCash && !a.archivedAt).map((a) => a.id));
  const points: ForecastPoint[] = [];
  let balance = e.cash;
  for (let date = e.today; date <= e.cycle.end; date = addDays(date, 1)) {
    const events: ForecastPoint['events'] = [];
    for (const o of e.occurrences) {
      if (o.status !== 'DUE' && o.status !== 'PARTIAL') continue;
      // Une échéance en retard est attendue aujourd'hui.
      const when = o.dueDate < e.today ? e.today : o.dueDate;
      if (when !== date || (o.commitment.accountId && !daily.has(o.commitment.accountId))) continue;
      if (o.commitment.kind === 'INCOME') {
        if (!o.commitment.direct) events.push({ label: o.commitment.label, amount: o.expected });
      } else events.push({ label: o.commitment.label, amount: -o.remaining });
    }
    balance += events.reduce((s, x) => s + x.amount, 0);
    // Le quotidien : ce qu'il reste à dépenser aujourd'hui, puis le budget du jour chaque jour suivant.
    balance -= date === e.today ? Math.max(0, e.resteAujourdhui) : e.demain;
    points.push({ date, balance, events });
  }
  const low = points.reduce((a, b) => (b.balance < a.balance ? b : a), points[0] ?? { date: e.today, balance: e.cash, events: [] });
  return { points, low };
}

/** L'historique d'un marchand : ce qui y a été dépensé, mois par mois, sur les `months` derniers mois. */
export function merchantMonths(db: Db, merchantId: string, today: ISODate, months: number): { month: string; amount: number }[] {
  const out = new Map<string, number>();
  const [y, m] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  for (let i = months - 1; i >= 0; i--) {
    const idx = y * 12 + (m - 1) - i;
    out.set(`${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`, 0);
  }
  const amounts = new Map<string, number>();
  for (const a of db.allocations) amounts.set(a.transactionId, (amounts.get(a.transactionId) ?? 0) + a.amount);
  for (const t of db.transactions) {
    const key = t.date.slice(0, 7);
    if (t.merchantId === merchantId && out.has(key) && t.amount < 0) out.set(key, out.get(key)! - (amounts.get(t.id) ?? t.amount));
  }
  return [...out].map(([month, amount]) => ({ month, amount }));
}

/**
 * Projection du patrimoine : ce qu'il vaudra dans `years` ans si tu continues à mettre de côté `monthly` par mois,
 * avec un rendement annuel `rateBp` (points de base) sur ce qui est placé. Une hypothèse, pas une promesse.
 */
export function project(net: number, invested: number, monthly: number, rateBp: number, years: number): number {
  const r = rateBp / 10000 / 12;
  let placed = Math.max(0, invested);
  const rest = net - placed;
  for (let i = 0; i < years * 12; i++) placed = placed * (1 + r) + monthly;
  return Math.round(rest + placed);
}

/**
 * Le rythme du cycle : les dépenses du quotidien cumulées jour après jour, face au rythme idéal (le budget du cycle
 * réparti également sur ses jours) et au cycle précédent. `gap` > 0 : de l'avance (moins dépensé que le rythme) ;
 * < 0 : du retard. `current[i]` et `previous[i]` : le cumul au soir du jour i (0 : avant le premier jour).
 */
export interface Pace {
  length: number;
  /** Le rang d'aujourd'hui dans le cycle, à partir de 1. */
  day: number;
  current: number[];
  previous: number[];
  pot: number;
  spent: number;
  ideal: number;
  gap: number;
  /** Où mène le rythme actuel à la fin du cycle. */
  projected: number;
  previousSameDay: number | null;
  previousTotal: number | null;
}

export function pace(db: Db, e: Pick<Explanation, 'cycle' | 'pot'>, today: ISODate): Pace {
  const cycles = lastCycles(db, today, 2);
  const settled = settledIn(db, cycles);
  const cumulate = (c: Cycle, until: ISODate): number[] => {
    const days = spendByDay(db, settled, c.start, until);
    const out = [0];
    for (let d = c.start; d <= until; d = addDays(d, 1)) out.push(out[out.length - 1]! + (days.get(d) ?? 0));
    return out;
  };
  const length = diffDays(e.cycle.start, e.cycle.end) + 1;
  const day = Math.max(1, Math.min(length, diffDays(e.cycle.start, today) + 1));
  const current = cumulate(e.cycle, today);
  const previous = cumulate(cycles[0]!, cycles[0]!.end);
  const hasPrevious = previous[previous.length - 1] !== 0;
  const spent = current[current.length - 1]!;
  const ideal = Math.round((Math.max(0, e.pot) * day) / length);
  return {
    length,
    day,
    current,
    previous: hasPrevious ? previous : [],
    pot: e.pot,
    spent,
    ideal,
    gap: ideal - spent,
    projected: Math.round((spent * length) / day),
    previousSameDay: hasPrevious ? previous[Math.min(day, previous.length - 1)]! : null,
    previousTotal: hasPrevious ? previous[previous.length - 1]! : null,
  };
}
