/** Local-calendar date helpers. Dates are `YYYY-MM-DD` strings in the device's local time. */

const pad = (n: number) => (n < 10 ? `0${n}` : String(n));

export function toDateString(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function today(): string {
  return toDateString(new Date());
}

export function parseDate(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export function addDays(value: string, days: number): string {
  const date = parseDate(value);
  date.setDate(date.getDate() + days);
  return toDateString(date);
}

/** Whole days from `a` to `b` (b - a). DST-safe because it goes through UTC midnights. */
export function diffDays(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const ua = Date.UTC(ay ?? 1970, (am ?? 1) - 1, ad ?? 1);
  const ub = Date.UTC(by ?? 1970, (bm ?? 1) - 1, bd ?? 1);
  return Math.round((ub - ua) / 86_400_000);
}

/** 0 = Monday … 6 = Sunday. */
export function weekday(value: string): number {
  return (parseDate(value).getDay() + 6) % 7;
}

/** Monday of the week containing `value`; used as the weekly bucket key. */
export function startOfWeek(value: string): string {
  return addDays(value, -weekday(value));
}

export function startOfMonth(value: string): string {
  return `${value.slice(0, 7)}-01`;
}

export function addMonths(value: string, months: number): string {
  const date = parseDate(startOfMonth(value));
  date.setMonth(date.getMonth() + months);
  return toDateString(date);
}

export function daysInMonth(value: string): number {
  const date = parseDate(startOfMonth(value));
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

const WEEKDAYS_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const WEEKDAYS_LONG = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const MONTHS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];
const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

export function weekdayShort(index: number): string {
  return WEEKDAYS_SHORT[index] ?? '';
}

export function formatLongDate(value: string): string {
  const d = parseDate(value);
  return `${WEEKDAYS_LONG[weekday(value)]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function formatShortDate(value: string): string {
  const d = parseDate(value);
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

export function formatMonth(value: string): string {
  const d = parseDate(value);
  const month = MONTHS[d.getMonth()] ?? '';
  return `${month.charAt(0).toUpperCase()}${month.slice(1)} ${d.getFullYear()}`;
}

export function formatDuration(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  // A session left open for days reads « 2 j 4 h », not « 52h13 ».
  if (h >= 24) return `${Math.floor(h / 24)} j ${h % 24} h`;
  return h > 0 ? `${h}h${pad(m)}` : `${m} min`;
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}
