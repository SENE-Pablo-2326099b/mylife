import { addDays, cycleFor, daysInMonth, inRange, parseISO, toISO, weekday, type Cycle, type ISODate } from '../core/dates';
import { normalizeText } from '../core/text';
import type { Allocation, Commitment, Db, Transaction } from './schema';

/**
 * Les cycles (d'une paie à la suivante) et les échéances du prévu, avec leur rapprochement.
 * Rien n'est stocké ici : tout se recalcule à partir des engagements et des opérations. Seules les décisions prises à
 * la main (échéance sautée, échéance réglée par telle opération) sont lues dans `occurrenceOverrides`.
 */

const within = (actual: number, expected: number, tolerance: number) => expected > 0 && Math.abs(Math.abs(actual) - expected) <= expected * tolerance;

/** Les lignes d'une transaction, par transaction. */
function linesByTx(db: Db): Map<string, Allocation[]> {
  const map = new Map<string, Allocation[]>();
  for (const a of db.allocations) map.set(a.transactionId, [...(map.get(a.transactionId) ?? []), a]);
  return map;
}

/** Cette rentrée d'argent est-elle la paie qui ouvre le cycle ? */
function isOpeningIncome(t: Transaction, c: Commitment, lines: Allocation[] | undefined): boolean {
  if (t.amount <= 0 || (c.accountId && t.accountId !== c.accountId)) return false;
  if (lines?.some((l) => l.flow !== null && l.flow !== 'INCOME')) return false;
  return within(t.amount, c.amount, c.tolerance);
}

/**
 * Le cycle qui contient `today`. Nominalement du jour de paie à la veille du suivant ; une paie arrivée jusqu'à
 * `earlyDays` jours en avance ouvre le cycle ce jour-là. Une paie en retard ne repousse rien : le budget du jour ne
 * s'arrête pas faute de virement.
 */
export function currentCycle(db: Db, today: ISODate): Cycle {
  const { payday, earlyDays, openingCommitmentId } = db.settings;
  const nominal = cycleFor(today, payday);
  const opening = db.commitments.find((c) => c.id === openingCommitmentId && c.kind === 'INCOME' && !c.paused && !c.direct);
  if (!opening || earlyDays <= 0) return nominal;
  const lines = linesByTx(db);
  const startOf = (nominalStart: ISODate): ISODate => {
    const from = addDays(nominalStart, -earlyDays);
    const early = db.transactions
      .filter((t) => t.date >= from && t.date < nominalStart && t.date <= today && isOpeningIncome(t, opening, lines.get(t.id)))
      .map((t) => t.date)
      .sort()[0];
    return early ?? nominalStart;
  };
  const nextNominal = addDays(nominal.end, 1);
  const nextStart = startOf(nextNominal);
  if (today >= nextStart) return { start: nextStart, end: cycleFor(nextNominal, payday).end };
  return { start: startOf(nominal.start), end: addDays(nextStart, -1) };
}

/** Les dates d'échéance d'un engagement dans un cycle. */
export function dueDates(c: Commitment, cycle: Cycle): ISODate[] {
  if (c.paused) return [];
  let dates: ISODate[] = [];
  if (c.rhythm === 'MONTHLY') {
    if (c.anchorDay === null) dates = [cycle.end];
    else {
      const a = parseISO(cycle.start);
      for (let i = 0; i <= 2; i++) {
        const idx = a.y * 12 + (a.m - 1) + i;
        const y = Math.floor(idx / 12);
        const m = (idx % 12) + 1;
        dates.push(toISO(y, m, Math.min(c.anchorDay, daysInMonth(y, m))));
      }
    }
  } else if (c.rhythm === 'WEEKLY') {
    for (let d = cycle.start; d <= cycle.end; d = addDays(d, 1)) if (weekday(d) === (c.anchorDay ?? 1)) dates.push(d);
  } else if (c.rhythm === 'BIWEEKLY' && c.anchorDate) {
    let d = c.anchorDate;
    while (d > cycle.start) d = addDays(d, -14);
    for (; d <= cycle.end; d = addDays(d, 14)) dates.push(d);
  } else if (c.rhythm === 'YEARLY' && c.anchorDate) {
    const { m, d } = parseISO(c.anchorDate);
    for (const y of new Set([parseISO(cycle.start).y, parseISO(cycle.end).y])) dates.push(toISO(y, m, Math.min(d, daysInMonth(y, m))));
  } else if (c.rhythm === 'ONCE' && c.anchorDate) dates = [c.anchorDate];
  dates = dates.filter((d) => inRange(d, cycle.start, cycle.end) && (!c.startDate || d >= c.startDate) && (!c.endDate || d <= c.endDate));
  return c.remainingOccurrences === null ? dates : dates.slice(0, Math.max(0, c.remainingOccurrences));
}

export interface Occurrence {
  /** `<engagement>@<date>`. */
  id: string;
  commitment: Commitment;
  dueDate: ISODate;
  /** Montant prévu, positif. */
  expected: number;
  status: 'DUE' | 'PAID' | 'SKIPPED';
  transactionId: string | null;
  /** Montant réel une fois réglée, positif. */
  actual: number | null;
}

const words = (s: string) => new Set(normalizeText(s).split(' ').filter((w) => w.length >= 3));

/** Une opération peut-elle régler cette échéance ? 2 : sûr (libellé et montant) ; 1 : plausible ; 0 : non. */
function affinity(c: Commitment, t: Transaction, lines: Allocation[] | undefined, txAccount: (id: string) => string | undefined): number {
  const flows = new Set((lines ?? []).map((l) => l.flow));
  if (c.accountId && t.accountId !== c.accountId) return 0;
  if (c.kind === 'INCOME') {
    if (t.amount <= 0 || [...flows].some((f) => f !== null && f !== 'INCOME')) return 0;
    return within(t.amount, c.amount, c.tolerance) ? 2 : 0;
  }
  if (t.amount >= 0) return 0;
  if (c.kind === 'SAVING') {
    if (!flows.has('SAVING')) return 0;
    const to = lines?.find((l) => l.linkedTransactionId)?.linkedTransactionId;
    if (c.counterAccountId && to && txAccount(to) !== c.counterAccountId) return 0;
    return within(t.amount, c.amount, c.tolerance) ? 2 : 0;
  }
  // Charge ou échéance de paiement fractionné : une dépense, pas un virement ni une mise de côté.
  if ([...flows].some((f) => f !== null && f !== 'EXPENSE')) return 0;
  const mine = words(c.label);
  const shared = [...words(t.rawLabel)].some((w) => mine.has(w));
  if (shared && within(t.amount, c.amount, c.tolerance)) return 2;
  // Sans mot en commun, le montant doit tomber juste (à 2 % près).
  return within(t.amount, c.amount, Math.min(c.tolerance, 0.02)) ? 1 : 0;
}

/** Les échéances du cycle, chacune rapprochée d'une opération au plus, chaque opération d'une échéance au plus. */
export function buildOccurrences(db: Db, cycle: Cycle): Occurrence[] {
  const lines = linesByTx(db);
  const txById = new Map(db.transactions.map((t) => [t.id, t]));
  const overrides = new Map(db.occurrenceOverrides.map((o) => [o.id, o]));
  const explicit = new Map<string, string>();
  for (const a of db.allocations) if (a.occurrenceId) explicit.set(a.occurrenceId, a.transactionId);
  const from = addDays(cycle.start, -db.settings.earlyDays);
  const candidates = db.transactions.filter((t) => inRange(t.date, from, cycle.end));
  const used = new Set<string>([...explicit.values(), ...db.occurrenceOverrides.flatMap((o) => (o.transactionId ? [o.transactionId] : []))]);

  const out: Occurrence[] = db.commitments.flatMap((c) => dueDates(c, cycle).map((dueDate) => ({ id: `${c.id}@${dueDate}`, commitment: c, dueDate, expected: c.amount, status: 'DUE' as const, transactionId: null, actual: null })));
  const settle = (o: Occurrence, transactionId: string | null) => {
    o.status = 'PAID';
    o.transactionId = transactionId;
    const t = transactionId ? txById.get(transactionId) : undefined;
    o.actual = t ? Math.abs(t.amount) : o.expected;
  };
  // 1. Ce qui a été décidé à la main, et les revenus versés à un tiers (jamais sur le compte : réputés reçus).
  for (const o of out) {
    const ov = overrides.get(o.id);
    if (ov?.status === 'SKIPPED') o.status = 'SKIPPED';
    else if (ov?.status === 'PAID') settle(o, ov.transactionId);
    else if (explicit.has(o.id)) settle(o, explicit.get(o.id)!);
    else if (o.commitment.direct) settle(o, null);
  }
  // 2. Le reste : d'abord les rapprochements sûrs, puis les plausibles ; la date la plus proche l'emporte.
  for (const level of [2, 1])
    for (const o of out.filter((x) => x.status === 'DUE').sort((a, b) => a.dueDate.localeCompare(b.dueDate))) {
      // Un revenu peut arriver en avance (c'est lui qui ouvre le cycle) ; une charge se cherche dans le cycle.
      const pool = candidates.filter((t) => !used.has(t.id) && (o.commitment.kind === 'INCOME' || t.date >= cycle.start) && affinity(o.commitment, t, lines.get(t.id), (id) => txById.get(id)?.accountId) >= level);
      const best = pool.sort((a, b) => Math.abs(Date.parse(a.date) - Date.parse(o.dueDate)) - Math.abs(Date.parse(b.date) - Date.parse(o.dueDate)))[0];
      if (best) {
        used.add(best.id);
        settle(o, best.id);
      }
    }
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
}
