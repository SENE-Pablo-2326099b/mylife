// GÉNÉRÉ depuis MyLife/packages/lumen — ne pas modifier ici (MyLife : npm run vendor).
// ---------------------------------------------------------------- dates (AAAA-MM-JJ, sans fuseau)

const DAY = 86_400_000;
const toMs = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Le lundi de la semaine d'une date. */
export function weekStart(iso: string): string {
  const ms = toMs(iso);
  const dow = (new Date(ms).getUTCDay() + 6) % 7;
  return fromMs(ms - dow * DAY);
}

export const addWeeks = (week: string, n: number): string => fromMs(toMs(week) + n * 7 * DAY);

/** Date du jour en heure locale (AAAA-MM-JJ). */
export function localToday(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Les semaines d'un mois (`AAAA-MM`) : celles dont le lundi tombe dans le mois. */
export function monthWeeks(month: string): { from: string; to: string } {
  const first = `${month}-01`;
  let from = weekStart(first);
  if (from < first) from = addWeeks(from, 1);
  let to = from;
  while (addWeeks(to, 1).slice(0, 7) === month) to = addWeeks(to, 1);
  return { from, to };
}
