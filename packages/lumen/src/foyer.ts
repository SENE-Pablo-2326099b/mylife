import { addWeeks, weekStart } from './character';

/**
 * MyFoyer (V4, 3.3) : la vie commune d'un foyer, dans le même espace chiffré que la liste de courses de MyChef (genre
 * « liste ») : les dépenses communes (moteur de budget des Sorties : `parseExpense`, `balances`, `settle`), les corvées
 * tournantes et les échéances du logement. Moteur pur ; jamais de classement entre colocataires.
 */

export interface Chore {
  v: 1;
  name: string;
  /** Jour de la semaine où elle est à faire (0 = lundi … 6 = dimanche). */
  weekday: number;
  /** Ordre du tour (identifiants des membres) ; un membre parti est sauté. */
  order: string[];
  /** Lundi de la semaine où le tour commence (le premier de `order`). */
  start: string;
}

export interface ChoreDone {
  by: string;
  at: number;
}

export interface Bill {
  v: 1;
  label: string;
  /** Jour du mois (1-31). */
  day: number;
  /** Montant habituel en centimes (facultatif). */
  cents?: number;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');

export function parseChore(raw: unknown): Chore | null {
  const o = raw as Partial<Chore> | null;
  const name = text(o?.name, 60);
  if (!o || o.v !== 1 || !name || !Number.isInteger(o.weekday) || o.weekday! < 0 || o.weekday! > 6 || typeof o.start !== 'string' || !DATE.test(o.start) || !Array.isArray(o.order)) return null;
  const order = o.order.filter((u): u is string => typeof u === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(u)).slice(0, 50);
  return order.length ? { v: 1, name, weekday: o.weekday!, order, start: weekStart(o.start) } : null;
}

export function parseChoreDone(raw: unknown): ChoreDone | null {
  const o = raw as Partial<ChoreDone> | null;
  return o && typeof o.by === 'string' && typeof o.at === 'number' ? { by: o.by, at: o.at } : null;
}

export function parseBill(raw: unknown): Bill | null {
  const o = raw as Partial<Bill> | null;
  const label = text(o?.label, 60);
  if (!o || o.v !== 1 || !label || !Number.isInteger(o.day) || o.day! < 1 || o.day! > 31) return null;
  return { v: 1, label, day: o.day!, ...(typeof o.cents === 'number' && o.cents > 0 && o.cents < 10_000_000 ? { cents: Math.round(o.cents) } : {}) };
}

const weeksBetween = (a: string, b: string) => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / (7 * 86_400_000));

/** À qui le tour, la semaine de `day` (les membres partis sont sautés ; null si plus personne). */
export function turnOf(chore: Chore, day: string, members: readonly string[]): string | null {
  const order = chore.order.filter((u) => members.includes(u));
  if (!order.length) return null;
  const n = weeksBetween(chore.start, weekStart(day));
  return order[((n % order.length) + order.length) % order.length]!;
}

/** Le jour où la corvée tombe, la semaine de `day`. */
export function choreDay(chore: Chore, day: string): string {
  const monday = weekStart(day);
  const d = new Date(`${monday}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + chore.weekday);
  return d.toISOString().slice(0, 10);
}

/** Identifiant de la ligne « faite » d'une corvée pour une semaine. */
export const choreDoneId = (choreId: string, day: string) => `${choreId}.${weekStart(day)}`;

/** Les corvées faites par chacun, par semaine (compteurs du Personnage : la stat Foyer, seulement les siennes). */
export function choresByWeek(done: readonly { rid: string; value: ChoreDone }[], uid: string): Record<string, Record<string, number>> {
  const weeks: Record<string, Record<string, number>> = {};
  for (const d of done) {
    if (d.value.by !== uid) continue;
    const week = d.rid.slice(d.rid.lastIndexOf('.') + 1);
    if (!DATE.test(week)) continue;
    const w = (weeks[week] ??= {});
    w.chores = (w.chores ?? 0) + 1;
  }
  return weeks;
}

/** Prochaine échéance d'une facture à partir d'aujourd'hui (inclus). */
export function nextBill(bill: Bill, today: string): string {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const make = (yy: number, mm: number) => {
    const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
    return `${yy}-${String(mm).padStart(2, '0')}-${String(Math.min(bill.day, last)).padStart(2, '0')}`;
  };
  const thisMonth = make(y, m);
  return thisMonth >= today ? thisMonth : make(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1);
}

/** Ce qui est à faire aujourd'hui pour la maison (tableau du foyer). */
export function todayForHome(input: { chores: readonly { id: string; value: Chore }[]; done: ReadonlySet<string>; bills: readonly { id: string; value: Bill }[]; members: readonly string[]; today: string; uid: string }): { mine: { id: string; chore: Chore; day: string }[]; others: { id: string; chore: Chore; who: string }[]; billsSoon: { id: string; bill: Bill; date: string }[] } {
  const mine: { id: string; chore: Chore; day: string }[] = [];
  const others: { id: string; chore: Chore; who: string }[] = [];
  for (const c of input.chores) {
    if (input.done.has(choreDoneId(c.id, input.today))) continue;
    const who = turnOf(c.value, input.today, input.members);
    if (!who) continue;
    if (who === input.uid) mine.push({ id: c.id, chore: c.value, day: choreDay(c.value, input.today) });
    else others.push({ id: c.id, chore: c.value, who });
  }
  const in7 = addWeeks(input.today, 1);
  const billsSoon = input.bills.map((b) => ({ id: b.id, bill: b.value, date: nextBill(b.value, input.today) })).filter((b) => b.date <= in7).sort((a, b) => a.date.localeCompare(b.date));
  return { mine: mine.sort((a, b) => a.day.localeCompare(b.day)), others, billsSoon };
}
