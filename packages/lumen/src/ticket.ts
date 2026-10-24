import { findFood, foodId, type Aisle } from './chef';

/**
 * MyChef, palier 4 : le ticket de caisse. Une photo ou le texte du ticket passe par l'IA gratuite de ton choix (une
 * demande à copier), ou par un lecteur à règles pour un ticket collé en texte. Ce qui est lu va dans un aperçu ; une fois
 * validé, les articles entrent dans le garde-manger et leurs prix sont retenus (coût estimé de la liste). Montants en
 * centimes, jamais envoyés ailleurs que dans le compte chiffré.
 */

export interface TicketLine {
  name: string;
  qty?: number;
  unit?: string;
  /** Prix payé pour la ligne, en centimes. */
  price?: number;
}

export interface Ticket {
  store?: string;
  date?: string;
  lines: TicketLine[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const cents = (v: unknown) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/\s/g, '').replace(',', '.').replace(/€$/, '')) : NaN;
  return Number.isFinite(n) && n >= 0 && n < 10_000 ? Math.round(n * 100) : undefined;
};

/** La réponse d'une IA (format ci-dessous), lue prudemment. */
export function parseTicket(raw: unknown): Ticket | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const items = (o.items ?? o.articles ?? o.lines) as unknown[];
  if (!Array.isArray(items)) return null;
  const lines: TicketLine[] = [];
  for (const x of items.slice(0, 120)) {
    const i = (x ?? {}) as Record<string, unknown>;
    const name = typeof (i.name ?? i.nom) === 'string' ? String(i.name ?? i.nom).trim().replace(/\s+/g, ' ').slice(0, 60) : '';
    if (!name) continue;
    const qty = typeof (i.qty ?? i.quantite) === 'number' && (i.qty ?? i.quantite) as number > 0 ? Math.round(((i.qty ?? i.quantite) as number) * 100) / 100 : undefined;
    const price = cents(i.price ?? i.prix);
    lines.push({ name, ...(qty !== undefined ? { qty } : {}), ...(typeof (i.unit ?? i.unite) === 'string' && qty !== undefined ? { unit: String(i.unit ?? i.unite).slice(0, 12) } : {}), ...(price !== undefined ? { price } : {}) });
  }
  if (!lines.length) return null;
  return { ...(typeof o.store === 'string' ? { store: o.store.slice(0, 40) } : {}), ...(typeof o.date === 'string' && DATE.test(o.date) ? { date: o.date } : {}), lines };
}

/** Un nom de ticket (« PATES PENNE », « OEUFS PLEIN AIR ») → l'aliment du catalogue : le nom entier, puis de plus en plus court, puis chaque mot. */
function ticketFood(name: string) {
  const words = name.split(/\s+/);
  for (let n = words.length; n >= 1; n--) {
    const f = findFood(words.slice(0, n).join(' '));
    if (f) return f;
  }
  for (const w of words) {
    const f = w.length >= 3 ? findFood(w) : null;
    if (f) return f;
  }
  return null;
}

const SKIP = /\b(total|sous[- ]?total|tva|cb|carte|especes|espèces|rendu|monnaie|ticket|merci|caisse|avoir|remise|fidelite|fidélité|points?|siret|tel|tél)\b/i;
const ABBREV: readonly [RegExp, string][] = [
  [/\bdemi[- ]?ecr\w*\b|\b1\/2 ecr\w*\b/gi, ''],
  [/\buht\b|\bbio\b|\bx\d+\b|\b\d+(?:[.,]\d+)?\s?(?:kg|g|cl|l|ml)\b/gi, ''],
  [/\boeufs?\b/gi, 'Œufs'],
  [/\bpdt\b/gi, 'Pommes de terre'],
  [/\bpq\b/gi, 'Papier toilette'],
];

/** Un ticket collé en texte : une ligne « NOM … 1,99 » = un article ; totaux, paiement et en-têtes écartés. */
export function parseTicketText(text: string): Ticket {
  const lines: TicketLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim();
    const m = /^(.+?)\s+(\d+[.,]\d{2})\s*€?\s*[A-Z]?$/.exec(l);
    if (!m || SKIP.test(m[1]!)) continue;
    let name = m[1]!.replace(/\s{2,}.*$/, '').trim();
    const q = /^(\d+)\s*[x×*]\s*/i.exec(name);
    const qty = q ? Number(q[1]) : undefined;
    if (q) name = name.slice(q[0].length);
    for (const [re, to] of ABBREV) name = name.replace(re, to);
    name = name.replace(/\s+/g, ' ').trim();
    if (!name || /^\d/.test(name)) continue;
    const pretty = ticketFood(name)?.name ?? name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
    lines.push({ name: pretty.slice(0, 60), ...(qty !== undefined ? { qty } : {}), price: cents(m[2])! });
  }
  return { lines };
}

export const TICKET_PROMPT = `Lis ce ticket de caisse et réponds UNIQUEMENT par un objet JSON valide, sans texte autour :

{
  "store": "nom du magasin",
  "date": "AAAA-MM-JJ",
  "items": [ { "name": "aliment en clair (« Lait demi-écrémé » plutôt que « LT DM ECR UHT »)", "qty": nombre d'unités achetées, "price": prix payé pour la ligne en euros } ]
}

Ignore les totaux, la TVA, le paiement, les remises et les lignes qui ne sont pas des articles. Voici le ticket :
`;

/** Prix retenu pour un aliment (le dernier payé, ramené à l'unité achetée). */
export interface Price {
  v: 1;
  name: string;
  /** Prix d'une unité, en centimes. */
  unitPrice: number;
  /** Jour du ticket. */
  day: string;
}

export function parsePrice(raw: unknown): Price | null {
  const o = raw as Partial<Price> | null;
  return o && o.v === 1 && typeof o.name === 'string' && typeof o.unitPrice === 'number' && o.unitPrice >= 0 && o.unitPrice < 1_000_000 && typeof o.day === 'string' && DATE.test(o.day) ? { v: 1, name: o.name.slice(0, 60), unitPrice: Math.round(o.unitPrice), day: o.day } : null;
}

/** Les prix à retenir d'un ticket, par aliment (identifiant commun au garde-manger et à la liste). */
export function pricesFromTicket(t: Ticket, day: string): { id: string; value: Price }[] {
  return t.lines.filter((l) => l.price !== undefined).map((l) => ({ id: foodId(l.name), value: { v: 1, name: findFood(l.name)?.name ?? l.name, unitPrice: Math.round(l.price! / Math.max(1, l.qty ?? 1)), day: t.date ?? day } }));
}

/** Coût estimé d'une liste avec les prix connus : le total des articles chiffrés, et combien ne le sont pas. */
export function estimateList(list: readonly { id: string; value: { name: string; qty?: number; unit?: string; done?: boolean } }[], prices: ReadonlyMap<string, Price>): { total: number; priced: number; unknown: number } {
  let total = 0;
  let priced = 0;
  let unknown = 0;
  for (const l of list) {
    if (l.value.done) continue;
    const p = prices.get(l.id);
    if (!p) {
      unknown++;
      continue;
    }
    // Une quantité en unités (pas en g ou en L) multiplie ; sinon une unité achetée.
    const n = l.value.qty !== undefined && !l.value.unit ? l.value.qty : 1;
    total += p.unitPrice * n;
    priced++;
  }
  return { total, priced, unknown };
}

/** Rayon d'un article lu sur un ticket. */
export const ticketAisle = (name: string): Aisle => findFood(name)?.aisle ?? 'autre';
