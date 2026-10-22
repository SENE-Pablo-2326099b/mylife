import { db, type BudgetDB } from '../db/db';
import type { AssetClass, Holding, InvestmentOp, InvestmentPlan, Portfolio, QuoteSource } from '../db/types';
import { addDays } from '../lib/dates';
import { hash, normalizeText, uid } from '../lib/text';
import type { TrAccount, TrStatement, TrTrade } from './tradeRepublic';

/**
 * Import d'un relevé Trade Republic dans le patrimoine : un portefeuille par compte (PEA, CTO),
 * une ligne par ISIN, un mouvement par exécution. Rejouable : les mouvements importés ont un
 * identifiant déterministe, et une échéance estimée d'un plan est remplacée par l'exécution réelle.
 */

export interface ExistingWealth {
  portfolios: readonly Portfolio[];
  holdings: readonly Holding[];
  ops: readonly InvestmentOp[];
  plans: readonly InvestmentPlan[];
}

export interface ImportLine {
  account: TrAccount;
  isin: string;
  name: string;
  holdingId: string;
  isNew: boolean;
  newOps: number;
  duplicates: number;
  quantity: number;
  invested: number;
}

export interface TrImportPlan {
  portfolios: Portfolio[];
  holdings: Holding[];
  ops: InvestmentOp[];
  /** Échéances estimées remplacées par les exécutions réelles du relevé. */
  removeOpIds: string[];
  plans: InvestmentPlan[];
  planUpdates: { id: string; lastRunDate: string }[];
  lines: ImportLine[];
  /** Portefeuille (existant ou créé) de chaque compte. */
  portfolioOf: Partial<Record<TrAccount, { id: string; name: string; isNew: boolean }>>;
}

const PROVIDER = 'Trade Republic';
const isTr = (p: Portfolio) => normalizeText(`${p.provider} ${p.name}`).includes('trade republic');
const wrapperOf = (p: Portfolio): TrAccount => (/\bpea\b/i.test(`${p.wrapper} ${p.name}`) ? 'PEA' : 'CTO');

/** Classe d'actif d'après l'ISIN et le nom (XF000… = crypto chez Trade Republic). */
export function guessAssetClass(isin: string, name: string): AssetClass {
  if (isin.startsWith('XF000')) return 'crypto';
  if (/\b(etf|ucits|etc|index|tracker)\b/i.test(name)) return 'etf';
  return 'stock';
}

/** « BNP PARIBAS EASY FR - BNP PARIBAS EASY S&P 500 UCITS ETF EUR C CAPITALISATION » → sans l'émetteur. */
export function cleanName(name: string): string {
  const parts = name.split(' - ');
  const rest = parts.length > 1 ? parts.slice(1).join(' - ') : name;
  return rest.replace(/\s+(CAPITALISATION|DISTRIBUTION)$/i, '').trim() || name;
}

const opKind = (t: TrTrade): InvestmentOp['type'] => (t.kind === 'sell' ? 'sell' : t.kind === 'dividend' ? 'dividend' : 'buy');

export function planTrImport(st: TrStatement, existing: ExistingWealth, opts: { createPlans: boolean; activePlans?: Record<string, boolean> }, now = Date.now()): TrImportPlan {
  const out: TrImportPlan = { portfolios: [], holdings: [], ops: [], removeOpIds: [], plans: [], planUpdates: [], lines: [], portfolioOf: {} };
  const accounts = (['PEA', 'CTO'] as const).filter((a) => st.trades.some((t) => t.account === a));

  for (const account of accounts) {
    const found = existing.portfolios.find((p) => isTr(p) && wrapperOf(p) === account);
    if (found) out.portfolioOf[account] = { id: found.id, name: found.name, isNew: false };
    else {
      const p: Portfolio = { id: uid('p'), name: `${PROVIDER} ${account}`, provider: PROVIDER, kind: 'broker', wrapper: account, order: now + out.portfolios.length, createdAt: now };
      out.portfolios.push(p);
      out.portfolioOf[account] = { id: p.id, name: p.name, isNew: true };
    }
  }

  const holdingFor = new Map<string, { holding: Holding; isNew: boolean }>();
  const keyOf = (t: { account: TrAccount; isin: string }) => `${t.account}|${t.isin}`;
  for (const t of st.trades) {
    const k = keyOf(t);
    if (holdingFor.has(k)) continue;
    const portfolioId = out.portfolioOf[t.account]!.id;
    const found = existing.holdings.find((h) => h.portfolioId === portfolioId && (h.isin?.toUpperCase() === t.isin || [t.name, cleanName(t.name)].some((n) => normalizeText(n) === normalizeText(h.name))));
    if (found) holdingFor.set(k, { holding: found, isNew: false });
    else {
      const cls = guessAssetClass(t.isin, t.name);
      const h: Holding = {
        id: uid('h'),
        portfolioId,
        name: cleanName(t.name),
        assetClass: cls,
        symbol: null,
        quoteSource: 'manual' as QuoteSource,
        isin: t.isin,
        price: null,
        priceAt: null,
        order: now + holdingFor.size,
        createdAt: now,
      };
      out.holdings.push(h);
      holdingFor.set(k, { holding: h, isNew: true });
    }
  }

  const existingIds = new Set(existing.ops.map((o) => o.id));
  const seenToday = new Map<string, number>();
  const lineOf = new Map<string, ImportLine>();
  for (const t of st.trades) {
    const { holding, isNew } = holdingFor.get(keyOf(t))!;
    const line = lineOf.get(keyOf(t)) ?? { account: t.account, isin: t.isin, name: holding.name, holdingId: holding.id, isNew, newOps: 0, duplicates: 0, quantity: 0, invested: 0 };
    lineOf.set(keyOf(t), line);
    const type = opKind(t);
    // Identifiant stable : même relevé (ou relevé qui se chevauche) → mêmes identifiants.
    const base = `tr-${hash(`${t.account}|${t.isin}|${t.date}|${type}|${t.amount}`)}`;
    const rank = seenToday.get(base) ?? 0;
    seenToday.set(base, rank + 1);
    const id = rank ? `${base}-${rank}` : base;
    line.quantity += type === 'sell' ? -t.quantity : type === 'buy' ? t.quantity : 0;
    line.invested += type === 'buy' ? t.amount : type === 'sell' ? -t.amount : 0;

    const manualTwin = existing.ops.find((o) => !o.id.startsWith('tr-') && !o.estimated && o.holdingId === holding.id && o.date === t.date && o.type === type && o.amount === t.amount);
    if (existingIds.has(id) || manualTwin) {
      line.duplicates++;
      continue;
    }
    // Échéance estimée d'un plan (même ligne, montant identique, ±4 jours) : remplacée par la vraie.
    const estimated = existing.ops.find(
      (o) => o.estimated && o.holdingId === holding.id && o.type === type && o.amount === t.amount && o.date >= addDays(t.date, -4) && o.date <= addDays(t.date, 4) && !out.removeOpIds.includes(o.id),
    );
    if (estimated) out.removeOpIds.push(estimated.id);
    out.ops.push({
      id,
      holdingId: holding.id,
      date: t.date,
      type,
      quantity: type === 'dividend' ? 0 : t.quantity,
      amount: t.amount,
      planId: estimated?.planId ?? null,
      estimated: false,
      note: t.savingsPlan ? 'Plan d’épargne · relevé Trade Republic' : 'Relevé Trade Republic',
      createdAt: now,
    });
    line.newOps++;
  }
  out.lines = [...lineOf.values()];

  // Échéances estimées restées sans exécution réelle sur la période du relevé : elles n'ont pas eu lieu.
  if (st.period) {
    const covered = new Set([...holdingFor.values()].map((v) => v.holding.id));
    for (const o of existing.ops) {
      if (o.estimated && covered.has(o.holdingId) && o.date >= st.period.from && o.date <= st.period.to && !out.removeOpIds.includes(o.id)) out.removeOpIds.push(o.id);
    }
  }

  // Investissements programmés : créés (ou recalés) pour ne pas régénérer les échéances du relevé.
  const lastRun = st.period?.to ?? null;
  for (const p of st.plans) {
    const { holding } = holdingFor.get(keyOf(p))!;
    const current = existing.plans.find((x) => x.holdingId === holding.id);
    const runTo = lastRun && lastRun > p.last ? lastRun : p.last;
    if (current) {
      if (!current.lastRunDate || current.lastRunDate < runTo) out.planUpdates.push({ id: current.id, lastRunDate: runTo });
    } else if (opts.createPlans) {
      out.plans.push({
        id: uid('plan'),
        holdingId: holding.id,
        amount: p.amount,
        frequency: p.frequency,
        day: p.day,
        startDate: p.first,
        active: opts.activePlans?.[keyOf(p)] ?? p.active,
        lastRunDate: runTo,
        createdAt: now,
      });
    }
  }
  return out;
}

export const planKey = (p: { account: TrAccount; isin: string }) => `${p.account}|${p.isin}`;

/** Écrit l'import ; renvoie de quoi l'annuler. */
export async function applyTrImport(plan: TrImportPlan, database: BudgetDB = db): Promise<() => Promise<void>> {
  const tables = [database.portfolios, database.holdings, database.investmentOps, database.plans];
  const removed = (await database.investmentOps.bulkGet(plan.removeOpIds)).filter((o): o is InvestmentOp => !!o);
  const previousRuns = (await database.plans.bulkGet(plan.planUpdates.map((u) => u.id))).filter((p): p is InvestmentPlan => !!p);
  await database.transaction('rw', tables, async () => {
    if (plan.portfolios.length) await database.portfolios.bulkPut(plan.portfolios);
    if (plan.holdings.length) await database.holdings.bulkPut(plan.holdings);
    if (plan.removeOpIds.length) await database.investmentOps.bulkDelete(plan.removeOpIds);
    if (plan.ops.length) await database.investmentOps.bulkPut(plan.ops);
    if (plan.plans.length) await database.plans.bulkPut(plan.plans);
    for (const u of plan.planUpdates) await database.plans.update(u.id, { lastRunDate: u.lastRunDate });
  });
  return async () => {
    await database.transaction('rw', tables, async () => {
      await database.investmentOps.bulkDelete(plan.ops.map((o) => o.id));
      if (removed.length) await database.investmentOps.bulkPut(removed);
      await database.plans.bulkDelete(plan.plans.map((p) => p.id));
      if (previousRuns.length) await database.plans.bulkPut(previousRuns);
      await database.holdings.bulkDelete(plan.holdings.map((h) => h.id));
      await database.portfolios.bulkDelete(plan.portfolios.map((p) => p.id));
    });
  };
}

const EUR_SUFFIX = ['.PA', '.AS', '.DE', '.MI', '.BR', '.F', '.SG', '.MU', '.BE', '.DU', '.HM', '.VI', '.MC', '.LS'];

/** Meilleure cotation pour une ligne : crypto chez CoinGecko, sinon une place en euros de préférence. */
export function pickQuote(hits: readonly { source: 'yahoo' | 'coingecko'; symbol: string }[], assetClass: AssetClass): { source: 'yahoo' | 'coingecko'; symbol: string } | null {
  if (assetClass === 'crypto') return hits.find((h) => h.source === 'coingecko') ?? null;
  const yahoo = hits.filter((h) => h.source === 'yahoo');
  const rank = (s: string) => {
    const i = EUR_SUFFIX.findIndex((x) => s.toUpperCase().endsWith(x));
    return i === -1 ? EUR_SUFFIX.length : i;
  };
  return [...yahoo].sort((a, b) => rank(a.symbol) - rank(b.symbol))[0] ?? null;
}

/** Cherche les cours des nouvelles lignes via le relais (sans relais : cours à saisir à la main). */
export async function resolveQuotes(plan: TrImportPlan, search: (query: string) => Promise<{ source: 'yahoo' | 'coingecko'; symbol: string; name: string }[]>): Promise<number> {
  let found = 0;
  await Promise.all(
    plan.holdings.map(async (h) => {
      try {
        const query = h.assetClass === 'crypto' ? h.name : h.isin ?? h.name;
        const best = pickQuote(await search(query), h.assetClass);
        if (best) {
          h.symbol = best.symbol;
          h.quoteSource = best.source;
          found++;
        }
      } catch {
        /* cours introuvable : saisie manuelle */
      }
    }),
  );
  return found;
}
