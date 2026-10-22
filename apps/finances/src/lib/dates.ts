/** Dates manipulées en chaînes ISO "YYYY-MM-DD" (jour calendaire, sans fuseau). */
export type ISODate = string;

export interface Cycle {
  start: ISODate;
  end: ISODate;
}

const MS_PER_DAY = 86_400_000;

export function toISO(y: number, m: number, d: number): ISODate {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function parseISO(s: ISODate): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!match) throw new Error(`Date invalide : ${s}`);
  return { y: +match[1], m: +match[2], d: +match[3] };
}

export function isISODate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function toUTC(s: ISODate): number {
  const { y, m, d } = parseISO(s);
  return Date.UTC(y, m - 1, d);
}

function fromUTC(ms: number): ISODate {
  const dt = new Date(ms);
  return toISO(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addDays(s: ISODate, n: number): ISODate {
  return fromUTC(toUTC(s) + n * MS_PER_DAY);
}

/** Nombre de jours de a vers b (b − a). */
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((toUTC(b) - toUTC(a)) / MS_PER_DAY);
}

/** Date du jour dans le fuseau local de l'appareil. */
export function todayISO(now: Date = new Date()): ISODate {
  return toISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** Jour de paie effectif d'un mois : si le jour n'existe pas (ex. 31 en février), dernier jour du mois. */
function paydayOf(y: number, m: number, payday: number): number {
  return Math.min(payday, daysInMonth(y, m));
}

function shiftMonth(y: number, m: number, delta: number): { y: number; m: number } {
  const idx = y * 12 + (m - 1) + delta;
  return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
}

/**
 * Cycle budgétaire contenant `date` : du jour de paie (inclus) à la veille du jour de paie suivant.
 * Exemple avec payday = 26 : le 17/10 appartient au cycle 26/09 → 25/10.
 */
export function cycleFor(date: ISODate, payday: number): Cycle {
  const pd = Math.max(1, Math.min(31, Math.trunc(payday)));
  const { y, m, d } = parseISO(date);
  let startY = y;
  let startM = m;
  if (d < paydayOf(y, m, pd)) {
    ({ y: startY, m: startM } = shiftMonth(y, m, -1));
  }
  const start = toISO(startY, startM, paydayOf(startY, startM, pd));
  const next = shiftMonth(startY, startM, 1);
  const nextStart = toISO(next.y, next.m, paydayOf(next.y, next.m, pd));
  return { start, end: addDays(nextStart, -1) };
}

export function previousCycle(cycle: Cycle, payday: number): Cycle {
  return cycleFor(addDays(cycle.start, -1), payday);
}

export function cycleLength(cycle: Cycle): number {
  return diffDays(cycle.start, cycle.end) + 1;
}

/** Jours restants dans le cycle, aujourd'hui inclus. */
export function daysRemaining(today: ISODate, cycle: Cycle): number {
  return Math.max(0, diffDays(today, cycle.end) + 1);
}

export function eachDay(start: ISODate, end: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

export function inRange(d: ISODate, start: ISODate, end: ISODate): boolean {
  return d >= start && d <= end;
}

const WEEKDAYS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const MONTHS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

export function weekday(s: ISODate): number {
  return new Date(toUTC(s)).getUTCDay();
}

/** "sam. 17 oct." */
export function formatDay(s: ISODate): string {
  const { m, d } = parseISO(s);
  return `${WEEKDAYS[weekday(s)]} ${d} ${MONTHS[m - 1]}`;
}

/** "17/10" */
export function formatShort(s: ISODate): string {
  const { m, d } = parseISO(s);
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}

/** "17 octobre 2026" */
export function formatLong(s: ISODate): string {
  const { y, m, d } = parseISO(s);
  return `${d} ${MONTHS_LONG[m - 1]} ${y}`;
}

export function formatCycle(c: Cycle): string {
  const a = parseISO(c.start);
  const b = parseISO(c.end);
  return `${a.d} ${MONTHS[a.m - 1]} → ${b.d} ${MONTHS[b.m - 1]}${a.y !== b.y ? ' ' + b.y : ''}`;
}
