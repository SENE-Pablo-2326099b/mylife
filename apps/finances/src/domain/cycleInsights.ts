import type { Transaction } from '../db/types';
import { addDays, weekday, type Cycle, type ISODate } from '../lib/dates';
import { isSpending, type CatMap } from './budget';
import { daySeries, refundMap, variableSpend } from './budgetEngine';

/**
 * Statistiques de la page Budget, au-delà du total : le cycle jour par jour (calendrier), les jours de
 * la semaine où l'on dépense, l'historique des cycles, les commerçants et les plus grosses dépenses.
 * Même règle que le budget du jour : dépenses de vie courante, remboursements rattachés déduits.
 */

export interface HeatDay {
  date: ISODate;
  /** Dépense de vie courante du jour (centimes, ≥ 0). */
  spent: number;
  /** Budget du jour tel qu'il était ce jour-là. */
  budget: number;
  /** Jour pas encore arrivé (cycle en cours). */
  future: boolean;
}

/** Une case par jour du cycle (les jours à venir restent vides). */
export function cycleHeatmap(txs: readonly Transaction[], cats: CatMap, cycle: Cycle, envelope: number, until: ISODate): HeatDay[] {
  const points = daySeries(txs, cats, cycle, envelope, until);
  const out: HeatDay[] = points.map((p) => ({ date: p.date, spent: Math.max(0, p.spent), budget: p.budget, future: false }));
  for (let d = addDays(until, 1); d <= cycle.end; d = addDays(d, 1)) out.push({ date: d, spent: 0, budget: 0, future: true });
  return out;
}

/** Moyenne de dépense de vie courante par jour de la semaine (lundi d'abord), sur [from, to]. */
export function weekdayProfile(txs: readonly Transaction[], cats: CatMap, from: ISODate, to: ISODate): { day: number; average: number; total: number; days: number }[] {
  const refunds = refundMap(txs);
  const totals = Array.from({ length: 7 }, () => 0);
  const days = Array.from({ length: 7 }, () => 0);
  for (let d = from; d <= to; d = addDays(d, 1)) days[(weekday(d) + 6) % 7]! += 1;
  for (const t of txs) {
    if (t.date < from || t.date > to) continue;
    totals[(weekday(t.date) + 6) % 7]! += variableSpend(t, cats, refunds);
  }
  return totals.map((total, i) => ({ day: i, total, days: days[i]!, average: days[i] ? Math.round(total / days[i]!) : 0 }));
}

/** Dépense de vie courante de chaque cycle, face à son enveloppe. */
export function cycleHistory(txs: readonly Transaction[], cats: CatMap, cycles: readonly Cycle[], envelopeOf: (c: Cycle) => number): { cycle: Cycle; spent: number; envelope: number }[] {
  const refunds = refundMap(txs);
  return cycles.map((cycle) => ({
    cycle,
    envelope: envelopeOf(cycle),
    spent: txs.filter((t) => t.date >= cycle.start && t.date <= cycle.end).reduce((s, t) => s + variableSpend(t, cats, refunds), 0),
  }));
}

/** Commerçants où part le plus d'argent sur [from, to] (dépenses réelles, hors virements et épargne). */
export function topMerchants(txs: readonly Transaction[], cats: CatMap, from: ISODate, to: ISODate, n = 5): { label: string; total: number; count: number; categoryId: string | null }[] {
  const map = new Map<string, { label: string; total: number; count: number; categoryId: string | null }>();
  for (const t of txs) {
    if (t.date < from || t.date > to || !isSpending(t, cats)) continue;
    const key = t.label.trim().toLowerCase();
    const cur = map.get(key) ?? { label: t.label, total: 0, count: 0, categoryId: t.categoryId };
    cur.total -= t.amount;
    cur.count += 1;
    map.set(key, cur);
  }
  return [...map.values()]
    .filter((m) => m.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, n);
}

/** Plus grosses dépenses sur [from, to]. */
export function biggestExpenses(txs: readonly Transaction[], cats: CatMap, from: ISODate, to: ISODate, n = 5): Transaction[] {
  return txs
    .filter((t) => t.date >= from && t.date <= to && isSpending(t, cats) && t.amount < 0)
    .sort((a, b) => a.amount - b.amount)
    .slice(0, n);
}
