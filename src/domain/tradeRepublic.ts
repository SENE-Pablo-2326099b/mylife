import type { PlanFrequency } from '../db/types';
import { diffDays, toISO, type ISODate } from '../lib/dates';

/**
 * Lecture d'un relevé de compte Trade Republic (PDF « Relevé de compte » exporté depuis l'app),
 * à partir du texte de ses pages. Ne garde que ce qui concerne les placements : achats, ventes,
 * exécutions de plan d'épargne, dividendes. Les paiements par carte et virements arrivent déjà par
 * la synchro bancaire.
 */

export type TrAccount = 'PEA' | 'CTO';

export interface TrTrade {
  account: TrAccount;
  date: ISODate;
  kind: 'buy' | 'sell' | 'dividend';
  isin: string;
  name: string;
  /** Parts (ajustées des divisions détectées). 0 pour un dividende. */
  quantity: number;
  /** Centimes, positif. */
  amount: number;
  /** Exécution d'un plan d'épargne (investissement programmé). */
  savingsPlan: boolean;
}

export interface TrSplit {
  account: TrAccount;
  isin: string;
  name: string;
  /** Date du premier achat après la division. */
  date: ISODate;
  /** 1 part avant = `ratio` parts après. */
  ratio: number;
}

export interface TrPlan {
  account: TrAccount;
  isin: string;
  name: string;
  amount: number;
  frequency: PlanFrequency;
  /** Jour du mois (mensuel) ou de la semaine (0 = dimanche). */
  day: number;
  first: ISODate;
  last: ISODate;
  /** Toujours en cours : une exécution récente par rapport à la fin du relevé. */
  active: boolean;
}

export interface TrStatement {
  period: { from: ISODate; to: ISODate } | null;
  trades: TrTrade[];
  splits: TrSplit[];
  plans: TrPlan[];
}

const MONTHS: Record<string, number> = {
  janv: 1, jan: 1, janvier: 1, january: 1,
  fevr: 2, fev: 2, feb: 2, fevrier: 2, february: 2,
  mars: 3, mar: 3, march: 3,
  avr: 4, avril: 4, apr: 4, april: 4,
  mai: 5, may: 5,
  juin: 6, jun: 6, june: 6,
  juil: 7, juillet: 7, jul: 7, july: 7,
  aout: 8, aug: 8, august: 8,
  sept: 9, sep: 9, september: 9, septembre: 9,
  oct: 10, october: 10, octobre: 10,
  nov: 11, november: 11, novembre: 11,
  dec: 12, december: 12, decembre: 12,
};

const deaccent = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const MONTH_RE = '(janv\\.?|janvier|jan\\.?|january|f[ée]vr\\.?|f[ée]v\\.?|f[ée]vrier|feb\\.?|february|mars|mar\\.?|march|avr\\.?|avril|apr\\.?|april|mai|may|juin|june?|juil\\.?|juillet|jul\\.?|july|ao[ûu]t|aug\\.?|august|sept\\.?|septembre|sep\\.?|september|oct\\.?|octobre|october|nov\\.?|novembre|november|d[ée]c\\.?|d[ée]cembre|dec\\.?|december)';
const DATE_RE = new RegExp(`(?<![\\d])(\\d{1,2}) ${MONTH_RE} (\\d{4})(?![\\d])`, 'gi');
const MONEY = '(-?\\d[\\d\\s\\u202f\\u00a0.]*,\\d{2})\\s*€';
const ISIN = '([A-Z]{2}[A-Z0-9]{9}\\d)';
const TRADE_RE = new RegExp(`(buy trade|sell trade|savings plan execution|saveback execution|round ?up execution|achat|vente|ex[ée]cution du plan d.[ée]pargne)\\s+${ISIN}\\s+(.+?),\\s*(?:quantity|quantit[ée])\\s*:\\s*([\\d.,]+)\\s+${MONEY}`, 'i');
const DIVIDEND_RE = new RegExp(`(dividend|dividende|distribution|cash dividend)[^A-Z]*?${ISIN}\\s+(.+?)(?:,\\s*(?:quantity|quantit[ée])\\s*:\\s*[\\d.,]+)?\\s+${MONEY}`, 'i');

function parseDate(day: string, month: string, year: string): ISODate | null {
  const m = MONTHS[deaccent(month.toLowerCase()).replace(/\.$/, '')];
  return m ? toISO(Number(year), m, Number(day)) : null;
}

function parseMoney(s: string): number {
  const clean = s.replace(/[\s\u202f\u00a0.]/g, '').replace(',', '.');
  return Math.round(Math.abs(Number(clean)) * 100);
}

function parseQuantity(s: string): number {
  // « 0.701647 » (point décimal) ou « 1,5 » (virgule) ; jamais de séparateur de milliers dans les quantités.
  const n = Number(s.includes('.') ? s.replace(/,/g, '') : s.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function accountOf(product: string): TrAccount | null {
  const p = deaccent(product.toLowerCase());
  if (/\bpea\b/.test(p)) return 'PEA';
  if (/compte (courant|titres?|especes)|securities|cash account|depot/.test(p)) return 'CTO';
  return null;
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Ratio de division « propre » le plus proche (log), si le saut de prix en est vraiment un. */
const NICE = [2, 3, 4, 5, 8, 10, 15, 20, 25, 40, 50, 100, 150, 200, 250, 300, 400, 500, 1000];
function niceRatio(r: number): number {
  let best = NICE[0];
  for (const n of NICE) if (Math.abs(Math.log(n / r)) < Math.abs(Math.log(best / r))) best = n;
  return best;
}

/** Texte des pages (dans l'ordre) → opérations de placement. */
export function parseTrStatement(pages: readonly string[]): TrStatement {
  let period: TrStatement['period'] = null;
  let account: TrAccount | null = null;
  const raw: TrTrade[] = [];

  for (const pageText of pages) {
    const text = squash(pageText);
    if (!period) {
      const m = new RegExp(`DATE (\\d{1,2}) ${MONTH_RE} (\\d{4}) - (\\d{1,2}) ${MONTH_RE} (\\d{4})`, 'i').exec(text);
      const from = m && parseDate(m[1], m[2], m[3]);
      const to = m && parseDate(m[4], m[5], m[6]);
      if (from && to) period = { from, to };
    }
    // Nouveau compte : la synthèse donne le produit (« Compte PEA », « Compte courant »).
    const synth = /SOLDE FIN DE P[ÉE]RIODE\s+(.+?)\s+-?\d[\d\s.]*,\d{2}\s*€/i.exec(text);
    if (synth) account = accountOf(synth[1]) ?? account;
    if (!account) continue;

    // Corps du tableau : après l'en-tête de colonnes, avant les remarques / l'aperçu du solde.
    const header = /DATE TYPE DESCRIPTION ENTR[ÉE]E D.ARGENT SORTIE D.ARGENT SOLDE/i.exec(text);
    if (!header) continue;
    let body = text.slice(header.index + header[0].length);
    const end = /REMARQUES SUR LE RELEV|APER[ÇC]U DU SOLDE|FONDS MON[ÉE]TAIRE/i.exec(body);
    if (end) body = body.slice(0, end.index);

    // Une ligne commence par sa date (« 16 juin 2026 »).
    const starts = [...body.matchAll(DATE_RE)];
    starts.forEach((s, i) => {
      const date = parseDate(s[1], s[2], s[3]);
      if (!date) return;
      const row = body.slice(s.index! + s[0].length, starts[i + 1]?.index ?? body.length);
      const t = TRADE_RE.exec(row);
      if (t) {
        const verb = deaccent(t[1].toLowerCase());
        raw.push({
          account: account!,
          date,
          kind: /sell|vente/.test(verb) ? 'sell' : 'buy',
          isin: t[2].toUpperCase(),
          name: squash(t[3]),
          quantity: parseQuantity(t[4]),
          amount: parseMoney(t[5]),
          savingsPlan: /savings plan|plan d.epargne|saveback|round/.test(verb),
        });
        return;
      }
      const d = DIVIDEND_RE.exec(row);
      if (d) raw.push({ account: account!, date, kind: 'dividend', isin: d[2].toUpperCase(), name: squash(d[3]), quantity: 0, amount: parseMoney(d[4]), savingsPlan: false });
    });
  }

  raw.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const splits = adjustSplits(raw);
  return { period, trades: raw, splits, plans: detectPlans(raw, period?.to ?? raw[raw.length - 1]?.date ?? null) };
}

/**
 * Divisions (« splits ») : le relevé ne les mentionne pas, mais le prix unitaire chute d'un coup
 * (ex. 1 966 €/part puis 9 €/part). On ramène les quantités antérieures à l'échelle actuelle.
 */
function adjustSplits(trades: TrTrade[]): TrSplit[] {
  const splits: TrSplit[] = [];
  const groups = new Map<string, TrTrade[]>();
  for (const t of trades) {
    if (t.kind === 'dividend' || t.quantity <= 0) continue;
    const k = `${t.account}|${t.isin}`;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  for (const list of groups.values()) {
    for (let i = 1; i < list.length; i++) {
      const before = list[i - 1].amount / list[i - 1].quantity;
      const after = list[i].amount / list[i].quantity;
      const jump = before / after;
      if (jump < 12 && jump > 1 / 12) continue;
      const ratio = jump >= 12 ? niceRatio(jump) : 1 / niceRatio(1 / jump);
      for (let j = 0; j < i; j++) list[j].quantity = Math.round(list[j].quantity * ratio * 1e6) / 1e6;
      splits.push({ account: list[i].account, isin: list[i].isin, name: list[i].name, date: list[i].date, ratio });
    }
  }
  return splits;
}

function detectPlans(trades: readonly TrTrade[], end: ISODate | null): TrPlan[] {
  const groups = new Map<string, TrTrade[]>();
  for (const t of trades) {
    if (!t.savingsPlan || t.kind !== 'buy') continue;
    const k = `${t.account}|${t.isin}`;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  const plans: TrPlan[] = [];
  for (const list of groups.values()) {
    const last = list[list.length - 1];
    const gaps = list.slice(1).map((t, i) => diffDays(list[i].date, t.date));
    const typical = gaps.length ? gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 30;
    const frequency: PlanFrequency = typical <= 9 ? 'weekly' : typical <= 20 ? 'biweekly' : 'monthly';
    const day = frequency === 'monthly' ? Number(last.date.slice(8, 10)) : new Date(`${last.date}T12:00:00Z`).getUTCDay();
    const period = frequency === 'weekly' ? 7 : frequency === 'biweekly' ? 14 : 31;
    const active = end ? diffDays(last.date, end) <= period * 1.4 : true;
    plans.push({ account: last.account, isin: last.isin, name: last.name, amount: last.amount, frequency, day, first: list[0].date, last: last.date, active });
  }
  return plans;
}
