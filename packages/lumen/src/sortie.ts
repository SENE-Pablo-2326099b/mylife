/**
 * Sortie : un événement (festival, week-end, soirée) partagé par une bande, dans un espace chiffré
 * (server/space.ts). Lignes de l'espace :
 * - `info` / `main` : nom, lieu, dates, notes (écrite par le créateur) ;
 * - `rsvp` / <uid> : « chaud », « peut-être », « non » (chacun la sienne) ;
 * - `set` / <id> : un set du planning (jour, heure, scène, artiste), ouvert à tous ;
 * - `going` / <uid> : les sets où chacun compte aller ;
 * - `expense` / <id> : une dépense (montant en centimes, payée par, pour qui) ;
 * - `item` / <id> : une chose à emporter (cochable par tous) ;
 * - `id` / <id> : un morceau à identifier (« ID ? »), complétable par tous.
 * Fonctions pures : lecture prudente, décision, remboursements, set en cours, souvenir.
 */

export const SORTIE_TABLES = ['info', 'rsvp', 'set', 'going', 'expense', 'item', 'id'] as const;
export type SortieTable = (typeof SORTIE_TABLES)[number];

export type Answer = 'chaud' | 'peutetre' | 'non';

export interface SortieInfo {
  name: string;
  place: string;
  /** Dates locales AAAA-MM-JJ (fin incluse). */
  start: string;
  end: string;
  notes: string;
  /** « Ça se fait » à partir de ce nombre de « chaud ». */
  threshold: number;
}

export interface SortieSet {
  id: string;
  day: string;
  /** « HH:MM », fin éventuellement après minuit (« 02:00 »). */
  start: string;
  end: string;
  stage: string;
  artist: string;
}

export interface Expense {
  id: string;
  label: string;
  cents: number;
  paidBy: string;
  /** Pour qui (vide : tous les membres). */
  forUids: string[];
  at: number;
}

export interface Item {
  id: string;
  text: string;
  done: boolean;
}

export interface IdNote {
  id: string;
  at: number;
  setId: string | null;
  stage: string;
  artist: string;
  note: string;
  found: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

export function parseInfo(raw: unknown): SortieInfo | null {
  const o = obj(raw);
  const name = text(o.name, 80);
  const start = typeof o.start === 'string' && DATE.test(o.start) ? o.start : '';
  if (!name || !start) return null;
  const end = typeof o.end === 'string' && DATE.test(o.end) && o.end >= start ? o.end : start;
  const threshold = typeof o.threshold === 'number' && Number.isInteger(o.threshold) && o.threshold >= 1 && o.threshold <= 50 ? o.threshold : 3;
  return { name, place: text(o.place, 120), start, end, notes: text(o.notes, 1000), threshold };
}

export const parseAnswer = (raw: unknown): Answer | null => {
  const a = obj(raw).answer;
  return a === 'chaud' || a === 'peutetre' || a === 'non' ? a : null;
};

export function parseSet(id: string, raw: unknown): SortieSet | null {
  const o = obj(raw);
  const day = typeof o.day === 'string' && DATE.test(o.day) ? o.day : '';
  const start = typeof o.start === 'string' && TIME.test(o.start) ? o.start : '';
  const artist = text(o.artist, 80);
  if (!day || !start || !artist) return null;
  return { id, day, start, end: typeof o.end === 'string' && TIME.test(o.end) ? o.end : '', stage: text(o.stage, 60), artist };
}

export const parseGoing = (raw: unknown): string[] => {
  const s = obj(raw).sets;
  return Array.isArray(s) ? s.filter((x): x is string => typeof x === 'string').slice(0, 300) : [];
};

export function parseExpense(id: string, raw: unknown): Expense | null {
  const o = obj(raw);
  const cents = typeof o.cents === 'number' && Number.isInteger(o.cents) && o.cents > 0 && o.cents <= 10_000_000 ? o.cents : 0;
  const paidBy = typeof o.paidBy === 'string' ? o.paidBy : '';
  if (!cents || !paidBy) return null;
  const forUids = Array.isArray(o.forUids) ? o.forUids.filter((x): x is string => typeof x === 'string') : [];
  return { id, label: text(o.label, 80) || 'Dépense', cents, paidBy, forUids, at: typeof o.at === 'number' ? o.at : 0 };
}

export function parseItem(id: string, raw: unknown): Item | null {
  const o = obj(raw);
  const t = text(o.text, 120);
  return t ? { id, text: t, done: o.done === true } : null;
}

export function parseIdNote(id: string, raw: unknown): IdNote | null {
  const o = obj(raw);
  if (typeof o.at !== 'number') return null;
  return { id, at: o.at, setId: typeof o.setId === 'string' ? o.setId : null, stage: text(o.stage, 60), artist: text(o.artist, 80), note: text(o.note, 200), found: text(o.found, 160) };
}

// ---------------------------------------------------------------- réponses

export interface Decision {
  chaud: string[];
  peutetre: string[];
  non: string[];
  /** Pas encore répondu. */
  silent: string[];
  /** Assez de « chaud » : ça se fait. */
  on: boolean;
}

export function decide(members: readonly string[], answers: ReadonlyMap<string, Answer>, threshold: number): Decision {
  const d: Decision = { chaud: [], peutetre: [], non: [], silent: [], on: false };
  for (const uid of members) {
    const a = answers.get(uid);
    if (a) d[a].push(uid);
    else d.silent.push(uid);
  }
  d.on = d.chaud.length >= Math.max(1, Math.min(threshold, members.length));
  return d;
}

// ---------------------------------------------------------------- budget

/** Ce que chacun a payé moins ce qu'il doit (positif : on lui doit ; négatif : il doit). En centimes. */
export function balances(expenses: readonly Expense[], members: readonly string[]): Map<string, number> {
  const out = new Map(members.map((m) => [m, 0]));
  for (const e of expenses) {
    const shared = (e.forUids.length ? e.forUids : members).filter((u) => out.has(u));
    if (!shared.length || !out.has(e.paidBy)) continue;
    out.set(e.paidBy, out.get(e.paidBy)! + e.cents);
    // Partage au centime près : les premiers absorbent le reste, la somme reste exacte.
    const base = Math.floor(e.cents / shared.length);
    let rest = e.cents - base * shared.length;
    for (const u of shared) {
      const part = base + (rest > 0 ? 1 : 0);
      if (rest > 0) rest -= 1;
      out.set(u, out.get(u)! - part);
    }
  }
  return out;
}

/** Les remboursements les plus simples : le plus gros débiteur rembourse le plus gros créancier, et ainsi de suite. */
export function settle(bal: ReadonlyMap<string, number>): { from: string; to: string; cents: number }[] {
  const debtors = [...bal].filter(([, v]) => v < 0).map(([u, v]) => ({ u, v: -v }));
  const creditors = [...bal].filter(([, v]) => v > 0).map(([u, v]) => ({ u, v }));
  const out: { from: string; to: string; cents: number }[] = [];
  debtors.sort((a, b) => b.v - a.v || a.u.localeCompare(b.u));
  creditors.sort((a, b) => b.v - a.v || a.u.localeCompare(b.u));
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i]!.v, creditors[j]!.v);
    if (pay > 0) out.push({ from: debtors[i]!.u, to: creditors[j]!.u, cents: pay });
    debtors[i]!.v -= pay;
    creditors[j]!.v -= pay;
    if (debtors[i]!.v === 0) i++;
    if (creditors[j]!.v === 0) j++;
  }
  return out;
}

// ---------------------------------------------------------------- planning

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Début et fin d'un set en minutes depuis minuit du jour du set (une fin « avant » le début passe minuit). */
function span(s: SortieSet): [number, number] {
  const a = minutes(s.start);
  let b = s.end ? minutes(s.end) : a + 60;
  if (b <= a) b += 24 * 60;
  return [a, b];
}

const dayIndex = (iso: string) => Math.round(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000);

/**
 * Le set qui se joue à ce moment (date locale + « HH:MM »), sur une scène donnée si on la connaît. Un set de
 * la veille qui passe minuit compte. Sans correspondance exacte : le dernier commencé dans l'heure.
 */
export function setAt(sets: readonly SortieSet[], day: string, time: string, stage?: string): SortieSet | null {
  const now = dayIndex(day) * 1440 + minutes(time);
  const candidates = sets
    .filter((s) => !stage || s.stage === stage)
    .map((s) => {
      const [a, b] = span(s);
      return { s, a: dayIndex(s.day) * 1440 + a, b: dayIndex(s.day) * 1440 + b };
    });
  const playing = candidates.filter((c) => c.a <= now && now < c.b).sort((x, y) => y.a - x.a);
  if (playing[0]) return playing[0].s;
  const recent = candidates.filter((c) => c.a <= now && now - c.a <= 60).sort((x, y) => y.a - x.a);
  return recent[0]?.s ?? null;
}

/** Les sets triés par jour puis heure (les fins de nuit après ceux de la soirée). */
export function sortSets(sets: readonly SortieSet[]): SortieSet[] {
  const key = (s: SortieSet) => {
    const m = minutes(s.start);
    return `${s.day}-${String(m < 6 * 60 ? m + 1440 : m).padStart(4, '0')}-${s.stage}`;
  };
  return [...sets].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

// ---------------------------------------------------------------- statut et souvenir

export type Phase = 'avant' | 'pendant' | 'apres';
export function phaseOf(info: SortieInfo, today: string): Phase {
  return today < info.start ? 'avant' : today > info.end ? 'apres' : 'pendant';
}

export interface Memory {
  people: number;
  sets: number;
  ids: number;
  found: number;
  totalCents: number;
  myCents: number;
}

export function memoryOf(input: { chaud: readonly string[]; going: ReadonlyMap<string, string[]>; ids: readonly IdNote[]; expenses: readonly Expense[]; members: readonly string[]; me: string }): Memory {
  const seen = new Set<string>();
  for (const list of input.going.values()) for (const s of list) seen.add(s);
  const bal = balances(input.expenses, input.members);
  const total = input.expenses.reduce((n, e) => n + e.cents, 0);
  const paid = input.expenses.filter((e) => e.paidBy === input.me).reduce((n, e) => n + e.cents, 0);
  return {
    people: input.chaud.length,
    sets: seen.size,
    ids: input.ids.length,
    found: input.ids.filter((i) => i.found).length,
    totalCents: total,
    // Ma part réelle = ce que j'ai payé − ce qu'on me doit (+ ce que je dois).
    myCents: paid - (bal.get(input.me) ?? 0),
  };
}
