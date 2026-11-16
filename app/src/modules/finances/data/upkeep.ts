import { canUseRelay, Relay } from '../bank/relay';
import { setAfterSync } from '../bank/sync';
import { position } from '../core/budget';
import { addDays, daysInMonth, diffDays, parseISO, todayISO, toISO, weekday, type ISODate } from '../core/dates';
import type { Holding, InvestmentOp } from '../core/model';
import { normalizeText, uid } from '../core/text';
import { bankSettings, facts, getMeta, setMeta, type FactsDB, type RawTx } from './facts';

/**
 * L'entretien du patrimoine, repris de l'ancienne app : les investissements programmés échus deviennent des achats,
 * les prélèvements bancaires d'une ligne reliée aussi, les cours se mettent à jour par le relais, et la photo du jour
 * est prise (c'est elle qui trace la courbe). Tout écrit dans la base des faits, au format de l'ancienne app :
 * rien n'est fait deux fois si elle tourne encore à côté.
 */
type RawHolding = Omit<Holding, 'accountId'> & { portfolioId: string };
type RawOp = InvestmentOp & { planId: string | null; estimated: boolean; bankTxId?: string | null };
interface RawPlan {
  id: string;
  holdingId: string;
  amount: number;
  frequency: 'weekly' | 'biweekly' | 'monthly';
  day: number;
  startDate: string;
  active: boolean;
  lastRunDate: string | null;
}

/** Les échéances d'un investissement programmé dans [from, to], jamais avant son début. */
export function planOccurrences(plan: Pick<RawPlan, 'frequency' | 'day' | 'startDate'>, from: ISODate, to: ISODate): ISODate[] {
  const start = from > plan.startDate ? from : plan.startDate;
  if (start > to) return [];
  const out: ISODate[] = [];
  if (plan.frequency === 'monthly') {
    let { y, m } = parseISO(start);
    for (;;) {
      const d = toISO(y, m, Math.min(plan.day, daysInMonth(y, m)));
      if (d > to) break;
      if (d >= start) out.push(d);
      if (++m > 12) {
        m = 1;
        y++;
      }
    }
    return out;
  }
  let d = plan.startDate;
  while (weekday(d) !== plan.day % 7) d = addDays(d, 1);
  const step = plan.frequency === 'weekly' ? 7 : 14;
  while (d < start) d = addDays(d, step);
  for (; d <= to; d = addDays(d, step)) out.push(d);
  return out;
}

/** Enregistre les échéances passées des investissements programmés (quantité estimée au dernier cours connu). */
export async function runDuePlans(database: FactsDB = facts, today: ISODate = todayISO()): Promise<number> {
  let created = 0;
  const plans = database.table<RawPlan, string>('plans');
  const holdings = database.table<RawHolding, string>('holdings');
  const ops = database.table<RawOp, string>('investmentOps');
  await database.transaction('rw', [plans, holdings, ops], async () => {
    for (const plan of await plans.toArray()) {
      if (!plan.active) continue;
      const holding = await holdings.get(plan.holdingId);
      // Une ligne reliée aux prélèvements bancaires : ce sont eux qui font foi, pas le plan.
      if (!holding || holding.bankKeyword) continue;
      const floor = addDays(today, -400);
      const from = plan.lastRunDate ? addDays(plan.lastRunDate, 1) : plan.startDate;
      const dates = planOccurrences(plan, from > floor ? from : floor, today);
      if (!dates.length) continue;
      await ops.bulkPut(dates.map((date) => ({ id: uid('op'), holdingId: holding.id, date, type: 'buy' as const, quantity: holding.price ? Math.round((plan.amount / holding.price) * 1e8) / 1e8 : 0, amount: plan.amount, planId: plan.id, estimated: true, note: 'Investissement programmé', createdAt: Date.now() })));
      await plans.update(plan.id, { lastRunDate: dates[dates.length - 1] });
      created += dates.length;
    }
  });
  return created;
}

/**
 * Les achats tirés des prélèvements bancaires d'une ligne reliée (Bitstack, et tout service sans API) : chaque débit
 * dont le libellé contient le mot-clé devient un achat au cours du jour ; un crédit, une vente. Seuls ceux d'après
 * le dernier recalage comptent ; les opérations « en attente » attendent d'être définitives.
 */
export function bankBuys(holding: RawHolding, txs: readonly RawTx[], ops: readonly RawOp[], priceOn: (date: ISODate) => number | null, now = Date.now()): RawOp[] {
  const keyword = normalizeText(holding.bankKeyword ?? '');
  if (!keyword) return [];
  const mine = ops.filter((o) => o.holdingId === holding.id);
  const lastAdjust = mine.filter((o) => o.type === 'adjust').reduce<ISODate | null>((m, o) => (m === null || o.date > m ? o.date : m), null);
  const before = (d: ISODate) => (lastAdjust !== null && d <= lastAdjust) || (!!holding.bankLinkFrom && d < holding.bankLinkFrom);
  const linked = new Set(mine.map((o) => o.bankTxId).filter(Boolean));
  const out: RawOp[] = [];
  for (const t of txs) {
    if (t.pending || t.amount === 0 || linked.has(t.id) || before(t.date)) continue;
    if (!normalizeText(`${t.label} ${t.rawText}`).includes(keyword)) continue;
    const amount = Math.abs(t.amount);
    const price = priceOn(t.date);
    out.push({ id: `bank-${t.id}`, holdingId: holding.id, date: t.date, type: t.amount < 0 ? 'buy' : 'sell', quantity: price && price > 0 ? Math.round((amount / price) * 1e8) / 1e8 : 0, amount, planId: null, estimated: true, note: `Prélèvement ${t.label}`, createdAt: now, bankTxId: t.id });
  }
  return out;
}

/** Le cours en centimes à une date, d'après un historique quotidien en euros ; sinon le dernier cours connu. */
export function priceLookup(historyEuros: readonly [ISODate, number][], fallback: number | null): (date: ISODate) => number | null {
  const sorted = [...historyEuros].sort((a, b) => a[0].localeCompare(b[0]));
  return (date) => {
    let best: number | null = null;
    for (const [d, p] of sorted) {
      if (d > date) break;
      best = p * 100;
    }
    return best ?? fallback;
  };
}

export async function syncBankBuys(database: FactsDB = facts, today: ISODate = todayISO(), relay?: Relay | null): Promise<number> {
  const holdings = (await database.table<RawHolding, string>('holdings').toArray()).filter((h) => h.bankKeyword);
  if (!holdings.length) return 0;
  const settings = await bankSettings(database);
  const client = relay === undefined ? (canUseRelay(settings) ? new Relay(settings) : null) : relay;
  const opsTable = database.table<RawOp, string>('investmentOps');
  let created = 0;
  for (const h of holdings) {
    // Un achat sans cours (quantité 0) est recalculé dès qu'un cours est disponible.
    const ops = (await opsTable.where('holdingId').equals(h.id).toArray()).filter((o) => !(o.bankTxId && o.quantity === 0));
    const txs = await database.transactions.where('date').aboveOrEqual(h.bankLinkFrom ?? addDays(today, -400)).toArray();
    const pending = bankBuys(h, txs, ops, () => null);
    if (!pending.length) continue;
    let history: [string, number][] = [];
    if (client && h.symbol && h.quoteSource !== 'manual') {
      const oldest = pending.reduce((m, o) => (o.date < m ? o.date : m), today);
      try {
        history = await client.priceHistory(h.quoteSource, h.symbol, diffDays(oldest, today) + 2);
      } catch {
        /* relais injoignable : dernier cours connu */
      }
    }
    const fresh = bankBuys(h, txs, ops, priceLookup(history, h.price));
    if (fresh.length) {
      await opsTable.bulkPut(fresh);
      created += fresh.length;
    }
  }
  return created;
}

const QUOTES_KEY = 'quotesAt';

/** Met à jour les cours par le relais, au plus toutes les `maxAgeHours` (sauf `force`). */
export async function refreshQuotes(opts: { force?: boolean; maxAgeHours?: number } = {}, database: FactsDB = facts, relay?: Relay): Promise<{ updated: number; errors: string[] }> {
  const settings = await bankSettings(database);
  if (!relay && !canUseRelay(settings)) return { updated: 0, errors: [] };
  if (typeof navigator !== 'undefined' && !navigator.onLine) return { updated: 0, errors: [] };
  const last = (await getMeta<number>(QUOTES_KEY, database)) ?? 0;
  if (!opts.force && Date.now() - last < (opts.maxAgeHours ?? 6) * 3600_000) return { updated: 0, errors: [] };
  const table = database.table<RawHolding, string>('holdings');
  const holdings = (await table.toArray()).filter((h): h is RawHolding & { symbol: string; quoteSource: 'yahoo' | 'coingecko' } => h.quoteSource !== 'manual' && !!h.symbol);
  if (!holdings.length) return { updated: 0, errors: [] };
  const items = [...new Map(holdings.map((h) => [`${h.quoteSource}:${h.symbol}`, { source: h.quoteSource, symbol: h.symbol }])).values()];
  const quotes = await (relay ?? new Relay(settings)).quotes(items);
  let updated = 0;
  const errors: string[] = [];
  await database.transaction('rw', table, async () => {
    for (const h of holdings) {
      const quote = quotes[`${h.quoteSource}:${h.symbol}`];
      if (quote && 'price' in quote) {
        // En centimes, avec des décimales pour les actifs à très petit prix.
        await table.update(h.id, { price: Math.round(quote.price * 100 * 10000) / 10000, priceAt: quote.at });
        updated++;
      } else errors.push(`${h.name} : ${quote && 'error' in quote ? quote.error : 'cours indisponible'}`);
    }
  });
  await setMeta(QUOTES_KEY, Date.now(), database);
  return { updated, errors };
}

/** La photo du patrimoine du jour (une par jour, la dernière l'emporte). */
export async function recordSnapshot(database: FactsDB = facts, today: ISODate = todayISO()): Promise<void> {
  const [accounts, portfolios, holdings, ops, assets] = await Promise.all([
    database.accounts.toArray(),
    database.table<{ id: string }, string>('portfolios').toArray(),
    database.table<RawHolding, string>('holdings').toArray(),
    database.table<RawOp, string>('investmentOps').toArray(),
    database.table<{ kind: 'asset' | 'debt'; value: number }, string>('manualAssets').toArray(),
  ]);
  if (!accounts.length && !portfolios.length && !assets.length) return;
  const known = new Set(portfolios.map((p) => p.id));
  const positions = holdings.filter((h) => known.has(h.portfolioId)).map((h) => position({ ...h, accountId: h.portfolioId }, ops));
  await database.table('snapshots').put({
    date: today,
    cash: accounts.filter((a) => !a.hidden && a.balance !== null).reduce((s, a) => s + (a.balance ?? 0), 0),
    investments: positions.reduce((s, p) => s + p.value, 0),
    invested: positions.reduce((s, p) => s + p.invested, 0),
    other: assets.filter((a) => a.kind === 'asset').reduce((s, a) => s + a.value, 0),
    debts: assets.filter((a) => a.kind === 'debt').reduce((s, a) => s + a.value, 0),
  });
}

/** Au lancement et après chaque synchro bancaire. Silencieux : un relais injoignable laisse les derniers cours. */
export async function housekeeping(opts: { force?: boolean } = {}, database: FactsDB = facts): Promise<void> {
  await runDuePlans(database).catch(() => 0);
  await syncBankBuys(database).catch(() => 0);
  await refreshQuotes(opts, database).catch(() => undefined);
  await recordSnapshot(database);
}

setAfterSync(() => housekeeping({ force: true }));
