import { addDays, diffDays } from './dates';

export interface DatedValue {
  date: string;
  value: number;
}

/** One value per day: the last one entered that day (entries in entry order), sorted by date. */
export function dailyValues<T extends DatedValue>(entries: readonly T[]): T[] {
  const byDay = new Map<string, T>();
  for (const e of entries) byDay.set(e.date, e);
  return [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Trailing moving average over `days` calendar days (each entry averaged with the ones of the previous days). */
export function movingAverage(entries: readonly DatedValue[], days = 7): DatedValue[] {
  const sorted = [...entries].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return sorted.map((e) => {
    const window = sorted.filter((x) => x.date <= e.date && diffDays(x.date, e.date) < days);
    return { date: e.date, value: window.reduce((s, x) => s + x.value, 0) / window.length };
  });
}

export interface BodyTrend {
  /** Latest smoothed value. */
  average: number;
  /** kg per week over the last `windowDays` (least squares), null with too little data. */
  ratePerWeek: number | null;
  /** Date the goal would be reached at that rate, null when it is not heading there. */
  goalDate: string | null;
  /** Goal already reached (within 0.2 kg). */
  goalReached: boolean;
}

/**
 * Daily weight is noisy (water, food, salt): the trend is a 7-day average, and the rate a
 * least-squares slope over the last 4 weeks of entries (needs ≥ 2 entries spanning ≥ 7 days).
 */
export function bodyTrend(entries: readonly DatedValue[], goal: number | null, windowDays = 28): BodyTrend | null {
  if (entries.length === 0) return null;
  const smooth = movingAverage(entries);
  const last = smooth[smooth.length - 1];
  if (last === undefined) return null;
  const recent = entries.filter((e) => diffDays(e.date, last.date) < windowDays);
  let rate: number | null = null;
  const first = recent.reduce((m, e) => (e.date < m ? e.date : m), last.date);
  if (recent.length >= 2 && diffDays(first, last.date) >= 7) {
    const xs = recent.map((e) => diffDays(first, e.date));
    const mx = xs.reduce((s, x) => s + x, 0) / xs.length;
    const my = recent.reduce((s, e) => s + e.value, 0) / recent.length;
    const num = recent.reduce((s, e, i) => s + ((xs[i] ?? 0) - mx) * (e.value - my), 0);
    const den = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
    rate = den === 0 ? null : (num / den) * 7;
  }
  const reached = goal !== null && Math.abs(goal - last.value) <= 0.2;
  let goalDate: string | null = null;
  if (goal !== null && !reached && rate !== null && Math.abs(rate) >= 0.02 && Math.sign(goal - last.value) === Math.sign(rate)) {
    goalDate = addDays(last.date, Math.round(((goal - last.value) / rate) * 7));
  }
  return { average: last.value, ratePerWeek: rate, goalDate, goalReached: reached };
}
