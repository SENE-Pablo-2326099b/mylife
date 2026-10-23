import { addWeeks, monthWeeks, recap, yearWeeks, type Recap, type StatsByApp } from './vendor/lumen';

/** Mise en mots des bilans (semaine, mois, année), partagée par les pages Bilan et Wrapped. */

const day = (iso: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('fr-FR', opts).format(new Date(`${iso}T12:00:00`));

/** « du 19 au 25 octobre », « du 28 septembre au 4 octobre ». */
export function weekRange(week: string): string {
  const end = addWeeks(week, 1);
  const last = new Date(Date.parse(`${end}T12:00:00`) - 86_400_000).toISOString().slice(0, 10);
  const sameMonth = week.slice(0, 7) === last.slice(0, 7);
  return `du ${day(week, sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'long' })} au ${day(last, { day: 'numeric', month: 'long' })}`;
}

/** « octobre », « l'année 2026 ». */
export function periodName(period: string): string {
  return period.length === 4 ? `l’année ${period}` : day(`${period}-01`, { month: 'long' });
}

/** Bilan d'un mois (`AAAA-MM`) ou d'une année (`AAAA`). */
export function periodRecap(stats: StatsByApp, today: string, period: string, rest: readonly string[]): Recap {
  const { from, to } = period.length === 4 ? yearWeeks(period) : monthWeeks(period);
  return recap(stats, today, from, to, rest);
}

