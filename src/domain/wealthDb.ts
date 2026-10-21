import { db, getMeta, setMeta, type BudgetDB } from '../db/db';
import { getSettings, updateSettings } from '../db/seed';
import { changeWithUndo } from '../db/undo';
import type { Holding } from '../db/types';
import { addDays, diffDays, todayISO, type ISODate } from '../lib/dates';
import { uid } from '../lib/text';
import { EbClient } from '../sync/ebClient';
import { bankBuys, priceLookup } from './bankBuys';
import { dueOperations, plannedMonthlySavings } from './plans';
import { makeSnapshot, netWorth, summarizePortfolio } from './wealth';

/** Opérations sur le patrimoine qui touchent la base. */

/** Recalcule l'épargne mensuelle prévue (plans + objectifs) utilisée par l'enveloppe en mode auto. */
export async function refreshPlannedSavings(database: BudgetDB = db): Promise<number> {
  const [plans, goals] = await Promise.all([database.plans.toArray(), database.goals.toArray()]);
  const amount = plannedMonthlySavings(plans, goals);
  const s = await getSettings(database);
  if (s.plannedSavingsAuto !== amount) await updateSettings({ plannedSavingsAuto: amount }, database);
  return amount;
}

/** Enregistre les échéances passées des investissements programmés. Renvoie le nombre de mouvements créés. */
export async function runDuePlans(database: BudgetDB = db, today: ISODate = todayISO()): Promise<number> {
  let created = 0;
  await database.transaction('rw', [database.plans, database.holdings, database.investmentOps], async () => {
    const plans = await database.plans.toArray();
    for (const plan of plans) {
      if (!plan.active) continue;
      const holding = await database.holdings.get(plan.holdingId);
      // Ligne reliée aux prélèvements bancaires : ce sont eux qui font foi, pas le plan.
      if (!holding || holding.bankKeyword) continue;
      const ops = dueOperations(plan, holding, today, () => uid('op'));
      if (ops.length === 0) continue;
      await database.investmentOps.bulkPut(ops);
      await database.plans.update(plan.id, { lastRunDate: ops[ops.length - 1]?.date ?? today });
      created += ops.length;
    }
  });
  return created;
}

/**
 * Achats automatiques depuis les prélèvements bancaires (lignes avec un mot-clé, ex. Bitstack) :
 * quantité au cours du jour du prélèvement (historique via le relais, sinon dernier cours connu).
 * Renvoie le nombre d'achats créés.
 */
export async function syncBankBuys(database: BudgetDB = db, today: ISODate = todayISO()): Promise<number> {
  const holdings = (await database.holdings.toArray()).filter((h) => h.bankKeyword);
  if (!holdings.length) return 0;
  const settings = await getSettings(database);
  const client = settings.bridgePassword ? new EbClient(settings.bridgePassword) : null;
  let created = 0;
  for (const h of holdings) {
    // Un achat sans cours (quantité 0) est recalculé dès qu'un cours est disponible.
    const ops = (await database.investmentOps.where('holdingId').equals(h.id).toArray()).filter((o) => !(o.bankTxId && o.quantity === 0));
    const from = h.bankLinkFrom ?? addDays(today, -400);
    const txs = await database.transactions.where('date').aboveOrEqual(from).toArray();
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
      await database.investmentOps.bulkPut(fresh);
      created += fresh.length;
    }
  }
  return created;
}

/** Photo du patrimoine du jour (historique). */
export async function recordSnapshot(database: BudgetDB = db, today: ISODate = todayISO()): Promise<void> {
  const [accounts, portfolios, holdings, ops, assets] = await Promise.all([
    database.accounts.toArray(),
    database.portfolios.toArray(),
    database.holdings.toArray(),
    database.investmentOps.toArray(),
    database.manualAssets.toArray(),
  ]);
  if (accounts.length === 0 && portfolios.length === 0 && assets.length === 0) return;
  const worth = netWorth(
    accounts,
    portfolios.map((p) => summarizePortfolio(p, holdings, ops)),
    assets,
  );
  await database.snapshots.put(makeSnapshot(today, worth));
}

const QUOTES_KEY = 'quotesAt';

/**
 * Met à jour les cours via le relais (au plus toutes les `maxAgeHours`, sauf `force`).
 * Renvoie le nombre de cours mis à jour et les erreurs par ligne.
 */
export async function refreshQuotes(opts: { force?: boolean; maxAgeHours?: number } = {}, database: BudgetDB = db): Promise<{ updated: number; errors: string[]; skipped?: string }> {
  const settings = await getSettings(database);
  if (!settings.bridgePassword) return { updated: 0, errors: [], skipped: 'Mot de passe du relais non saisi (Réglages → Banques).' };
  if (typeof navigator !== 'undefined' && !navigator.onLine) return { updated: 0, errors: [], skipped: 'Hors ligne.' };
  const last = (await getMeta<number>(QUOTES_KEY, database)) ?? 0;
  if (!opts.force && Date.now() - last < (opts.maxAgeHours ?? 6) * 3600_000) return { updated: 0, errors: [], skipped: 'Cours récents.' };
  const holdings = (await database.holdings.toArray()).filter((h): h is Holding & { symbol: string; quoteSource: 'yahoo' | 'coingecko' } => h.quoteSource !== 'manual' && !!h.symbol);
  if (holdings.length === 0) return { updated: 0, errors: [] };
  const items = [...new Map(holdings.map((h) => [`${h.quoteSource}:${h.symbol}`, { source: h.quoteSource, symbol: h.symbol }])).values()];
  const quotes = await new EbClient(settings.bridgePassword).quotes(items);
  let updated = 0;
  const errors: string[] = [];
  await database.transaction('rw', database.holdings, async () => {
    for (const h of holdings) {
      const q = quotes[`${h.quoteSource}:${h.symbol}`];
      if (q && 'price' in q) {
        // Prix en centimes ; on garde des décimales pour les actifs à très petit prix.
        await database.holdings.update(h.id, { price: Math.round(q.price * 100 * 10000) / 10000, priceAt: q.at });
        updated++;
      } else errors.push(`${h.name} : ${q && 'error' in q ? q.error : 'cours indisponible'}`);
    }
  });
  await setMeta(QUOTES_KEY, Date.now(), database);
  return { updated, errors };
}

/** Au lancement : plans échus, épargne prévue, photo du jour. Silencieux. */
export async function wealthHousekeeping(database: BudgetDB = db): Promise<void> {
  await runDuePlans(database);
  try {
    await syncBankBuys(database);
  } catch {
    /* sans incidence : réessayé au prochain lancement */
  }
  await refreshPlannedSavings(database);
  try {
    await refreshQuotes({}, database);
  } catch {
    /* relais indisponible : les derniers cours connus restent affichés */
  }
  await recordSnapshot(database);
}

// ---------------------------------------------------------------- suppressions annulables

export async function deletePortfolio(id: string): Promise<void> {
  const holdings = await db.holdings.where('portfolioId').equals(id).toArray();
  const hIds = holdings.map((h) => h.id);
  const p = await db.portfolios.get(id);
  await changeWithUndo(
    `${p?.name ?? 'Portefeuille'} supprimé`,
    async () => ({
      portfolios: p ? [p] : [],
      holdings,
      investmentOps: await db.investmentOps.where('holdingId').anyOf(hIds).toArray(),
      plans: await db.plans.where('holdingId').anyOf(hIds).toArray(),
    }),
    async () => {
      await db.transaction('rw', [db.portfolios, db.holdings, db.investmentOps, db.plans], async () => {
        await db.investmentOps.where('holdingId').anyOf(hIds).delete();
        await db.plans.where('holdingId').anyOf(hIds).delete();
        await db.holdings.bulkDelete(hIds);
        await db.portfolios.delete(id);
      });
      await refreshPlannedSavings();
    },
    refreshPlannedSavings,
  );
}

export async function deleteHolding(id: string): Promise<void> {
  const h = await db.holdings.get(id);
  await changeWithUndo(
    `${h?.name ?? 'Ligne'} supprimée`,
    async () => ({ holdings: h ? [h] : [], investmentOps: await db.investmentOps.where('holdingId').equals(id).toArray(), plans: await db.plans.where('holdingId').equals(id).toArray() }),
    async () => {
      await db.transaction('rw', [db.holdings, db.investmentOps, db.plans], async () => {
        await db.investmentOps.where('holdingId').equals(id).delete();
        await db.plans.where('holdingId').equals(id).delete();
        await db.holdings.delete(id);
      });
      await refreshPlannedSavings();
    },
    refreshPlannedSavings,
  );
}

export async function deleteGoal(id: string): Promise<void> {
  const g = await db.goals.get(id);
  await changeWithUndo(
    `Objectif « ${g?.name ?? ''} » supprimé`,
    async () => ({ goals: g ? [g] : [], goalMoves: await db.goalMoves.where('goalId').equals(id).toArray() }),
    async () => {
      await db.transaction('rw', [db.goals, db.goalMoves], async () => {
        await db.goalMoves.where('goalId').equals(id).delete();
        await db.goals.delete(id);
      });
      await refreshPlannedSavings();
    },
    refreshPlannedSavings,
  );
}
