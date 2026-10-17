import type { Category, Settings, Transaction } from '../db/types';
import { cycleFor, daysRemaining, eachDay, cycleLength, diffDays, type Cycle, type ISODate } from '../lib/dates';
import { computeEnvelope } from './defaults';

export type CatMap = Map<string, Category>;
export type Status = 'good' | 'warn' | 'bad';

/** Une opération consomme-t-elle l'enveloppe « vie courante » ? (non classée = oui si c'est un débit) */
export function isVariable(tx: Pick<Transaction, 'categoryId' | 'amount'>, cats: CatMap): boolean {
  if (tx.categoryId === null) return tx.amount < 0;
  return cats.get(tx.categoryId)?.kind === 'variable';
}

/** Une opération est-elle une dépense du cycle (courante ou charge fixe) ? */
export function isSpending(tx: Pick<Transaction, 'categoryId' | 'amount'>, cats: CatMap): boolean {
  if (tx.categoryId === null) return tx.amount < 0;
  const kind = cats.get(tx.categoryId)?.kind;
  return kind === 'variable' || kind === 'fixed';
}

/** Montant dépensé (positif) ; un remboursement dans une catégorie de dépense vient en déduction. */
export function spent(txs: Pick<Transaction, 'categoryId' | 'amount'>[], cats: CatMap, filter: (t: Pick<Transaction, 'categoryId' | 'amount'>, c: CatMap) => boolean = isVariable): number {
  let total = 0;
  for (const t of txs) if (filter(t, cats)) total -= t.amount;
  return total;
}

export interface DailyBudget {
  cycle: Cycle;
  today: ISODate;
  envelope: number;
  /** Dépenses courantes du cycle avant aujourd'hui. */
  spentBefore: number;
  spentToday: number;
  /** Jours restants, aujourd'hui inclus. */
  daysLeft: number;
  /** (enveloppe − dépenses du cycle avant aujourd'hui) ÷ jours restants. */
  dailyBudget: number;
  remainingToday: number;
  remainingCycle: number;
  /** Budget par jour des jours suivants si on ne dépense plus rien aujourd'hui. */
  nextDailyBudget: number;
  /** Part du budget du jour consommée, en % (peut dépasser 100). */
  usedPercent: number;
  status: Status;
}

export function statusFor(spentToday: number, dailyBudget: number): Status {
  if (dailyBudget <= 0) return spentToday > 0 || dailyBudget < 0 ? 'bad' : 'warn';
  if (spentToday * 100 <= dailyBudget * 75) return 'good';
  if (spentToday <= dailyBudget) return 'warn';
  return 'bad';
}

/**
 * Budget du jour = (enveloppe vie courante − dépenses courantes du cycle jusqu'à hier) ÷ jours restants (aujourd'hui inclus).
 * Les dépenses d'aujourd'hui ne réduisent pas le budget du jour : elles le consomment.
 */
export function computeDailyBudget(txs: Transaction[], cats: CatMap, settings: Settings, today: ISODate): DailyBudget {
  const cycle = cycleFor(today, settings.payday);
  const envelope = computeEnvelope(settings);
  const inCycle = txs.filter((t) => t.date >= cycle.start && t.date <= cycle.end);
  const spentBefore = spent(inCycle.filter((t) => t.date < today), cats);
  const spentToday = spent(inCycle.filter((t) => t.date === today), cats);
  const daysLeft = daysRemaining(today, cycle);
  const available = envelope - spentBefore;
  const dailyBudget = daysLeft > 0 ? Math.floor(available / daysLeft) : available;
  const remainingCycle = available - spentToday;
  const nextDailyBudget = daysLeft > 1 ? Math.floor(remainingCycle / (daysLeft - 1)) : remainingCycle;
  return {
    cycle,
    today,
    envelope,
    spentBefore,
    spentToday,
    daysLeft,
    dailyBudget,
    remainingToday: dailyBudget - spentToday,
    remainingCycle,
    nextDailyBudget,
    usedPercent: dailyBudget > 0 ? Math.round((spentToday * 100) / dailyBudget) : spentToday > 0 ? 999 : 0,
    status: statusFor(spentToday, dailyBudget),
  };
}

export interface DayPoint {
  date: ISODate;
  /** Dépensé ce jour-là. */
  spent: number;
  /** Cumul depuis le début du cycle. */
  cumulative: number;
  /** Trajectoire idéale (enveloppe répartie uniformément). */
  ideal: number;
  /** Budget du jour tel qu'il était calculé ce jour-là. */
  budget: number;
}

/** Série jour par jour d'un cycle (jusqu'à `until` inclus). */
export function dailySeries(txs: Transaction[], cats: CatMap, cycle: Cycle, envelope: number, until: ISODate = cycle.end): DayPoint[] {
  const byDay = new Map<string, number>();
  for (const t of txs) {
    if (t.date < cycle.start || t.date > cycle.end || !isVariable(t, cats)) continue;
    byDay.set(t.date, (byDay.get(t.date) ?? 0) - t.amount);
  }
  const length = cycleLength(cycle);
  const points: DayPoint[] = [];
  let cumulative = 0;
  for (const date of eachDay(cycle.start, until < cycle.end ? until : cycle.end)) {
    const index = diffDays(cycle.start, date);
    const left = length - index;
    const budget = Math.floor((envelope - cumulative) / left);
    const day = byDay.get(date) ?? 0;
    cumulative += day;
    points.push({ date, spent: day, cumulative, ideal: Math.round((envelope * (index + 1)) / length), budget });
  }
  return points;
}

/** Nombre de jours consécutifs (finissant au dernier jour de la série) où le budget du jour a été dépassé, et le record. */
export function overrunStreaks(points: DayPoint[]): { current: number; longest: number; longestEnd: ISODate | null } {
  let current = 0;
  let longest = 0;
  let longestEnd: ISODate | null = null;
  for (const p of points) {
    if (p.spent > p.budget) {
      current++;
      if (current > longest) {
        longest = current;
        longestEnd = p.date;
      }
    } else current = 0;
  }
  return { current, longest, longestEnd };
}
