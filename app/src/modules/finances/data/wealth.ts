import { canUseRelay, Relay } from '../bank/relay';
import { todayISO } from '../core/dates';
import { uid } from '../core/text';
import { bankSettings, facts, factsChanged, type FactsDB } from './facts';
import { recordSnapshot, refreshQuotes } from './upkeep';

/**
 * La gestion du patrimoine dans le module : placements (portefeuilles), lignes, mouvements, recalage sur le
 * courtier, objectifs et leurs versements. Tout s'écrit dans la base des faits, au format de l'app d'avant (les
 * mêmes tables, les mêmes champs) : ce qui existait reste lisible, et la synchro entre appareils est la même.
 * Après chaque écriture : la photo du jour est reprise, et les écrans se rechargent.
 */
export type AssetClass = 'etf' | 'stock' | 'crypto' | 'bond' | 'fund' | 'cash' | 'other';
export type OpType = 'buy' | 'sell' | 'dividend' | 'interest' | 'fee' | 'adjust';

export interface RawPortfolio {
  id: string;
  name: string;
  provider: string;
  kind: 'broker' | 'crypto' | 'savings' | 'other';
  wrapper: string;
  order: number;
  createdAt: number;
}
export interface RawHoldingRow {
  id: string;
  portfolioId: string;
  name: string;
  assetClass: AssetClass;
  symbol: string | null;
  quoteSource: 'yahoo' | 'coingecko' | 'manual';
  isin: string | null;
  price: number | null;
  priceAt: number | null;
  order: number;
  createdAt: number;
  bankKeyword?: string | null;
  bankLinkFrom?: string | null;
}
export interface RawOpRow {
  id: string;
  holdingId: string;
  date: string;
  type: OpType;
  quantity: number;
  amount: number;
  planId: string | null;
  estimated: boolean;
  note: string;
  createdAt: number;
  bankTxId?: string | null;
}
export interface RawGoal {
  id: string;
  name: string;
  emoji: string;
  target: number;
  deadline: string | null;
  monthly: number;
  includeInBudget: boolean;
  linkKind: 'manual' | 'account' | 'portfolio';
  linkId: string | null;
  achievedAt: number | null;
  order: number;
  createdAt: number;
}

export const ASSET_CLASSES: readonly (readonly [AssetClass, string])[] = [
  ['etf', 'ETF'],
  ['stock', 'Action'],
  ['crypto', 'Crypto'],
  ['fund', 'Fonds'],
  ['bond', 'Obligation'],
  ['cash', 'Espèces, fonds en euros'],
  ['other', 'Autre'],
];

/** L'identifiant du portefeuille derrière un compte du module (`pf:<id>`), ou null si ce compte n'en est pas un. */
export const portfolioIdOf = (accountId: string): string | null => (accountId.startsWith('pf:') ? accountId.slice(3) : null);

async function done(database: FactsDB): Promise<void> {
  await recordSnapshot(database);
  factsChanged();
}

export async function savePortfolio(p: Partial<RawPortfolio> & { name: string }, database: FactsDB = facts): Promise<string> {
  const now = Date.now();
  const row: RawPortfolio = { id: p.id ?? uid('p'), name: p.name.trim() || p.provider?.trim() || 'Placement', provider: p.provider?.trim() ?? '', kind: p.kind ?? 'broker', wrapper: p.wrapper ?? 'CTO', order: p.order ?? now, createdAt: p.createdAt ?? now };
  await database.table<RawPortfolio, string>('portfolios').put(row);
  await done(database);
  return row.id;
}

/** Supprimer un placement : ses lignes, leurs mouvements et leurs investissements programmés partent avec lui. */
export async function removePortfolio(id: string, database: FactsDB = facts): Promise<void> {
  const holdings = await database.table<RawHoldingRow, string>('holdings').where('portfolioId').equals(id).primaryKeys();
  for (const h of holdings) await dropHolding(h, database);
  await database.table('portfolios').delete(id);
  await done(database);
}

async function dropHolding(id: string, database: FactsDB): Promise<void> {
  await database.table('investmentOps').where('holdingId').equals(id).delete();
  await database.table('plans').where('holdingId').equals(id).delete();
  await database.table('holdings').delete(id);
}

/** Une ligne. Nouvelle, avec une position de départ (quantité, montant investi) : un premier achat est noté. */
export async function saveHolding(h: Partial<RawHoldingRow> & { portfolioId: string; name: string }, start?: { quantity: number; invested: number }, database: FactsDB = facts): Promise<string> {
  const now = Date.now();
  const existing = h.id ? await database.table<RawHoldingRow, string>('holdings').get(h.id) : undefined;
  const row: RawHoldingRow = {
    ...existing,
    id: h.id ?? uid('h'),
    portfolioId: h.portfolioId,
    name: h.name.trim() || h.symbol || 'Ligne',
    assetClass: h.assetClass ?? existing?.assetClass ?? 'etf',
    symbol: h.symbol ?? null,
    quoteSource: h.quoteSource ?? 'manual',
    isin: h.isin ?? existing?.isin ?? null,
    price: h.price === undefined ? (existing?.price ?? null) : h.price,
    priceAt: h.price === undefined ? (existing?.priceAt ?? null) : h.price === null ? null : now,
    order: existing?.order ?? now,
    createdAt: existing?.createdAt ?? now,
  };
  await database.table<RawHoldingRow, string>('holdings').put(row);
  if (!existing && start && (start.quantity > 0 || start.invested > 0)) {
    const cash = row.assetClass === 'cash';
    await database.table<RawOpRow, string>('investmentOps').put({ id: uid('op'), holdingId: row.id, date: todayISO(), type: 'buy', quantity: cash ? 0 : start.quantity, amount: start.invested || (row.price ? Math.round(start.quantity * row.price) : 0), planId: null, estimated: false, note: 'Position initiale', createdAt: now });
  }
  // Une ligne cotée : son cours tout de suite, si le relais répond.
  if (row.quoteSource !== 'manual' && row.symbol) await refreshQuotes({ force: true }, database).catch(() => undefined);
  await done(database);
  return row.id;
}

export async function removeHolding(id: string, database: FactsDB = facts): Promise<void> {
  await dropHolding(id, database);
  await done(database);
}

/** Un mouvement : achat, vente, dividende, frais. Sans quantité pour ce qui n'en a pas. */
export async function saveOp(op: Partial<RawOpRow> & { holdingId: string; type: OpType; amount: number; date: string }, database: FactsDB = facts): Promise<void> {
  const withQty = op.type === 'buy' || op.type === 'sell' || op.type === 'adjust';
  await database.table<RawOpRow, string>('investmentOps').put({ id: op.id ?? uid(op.type === 'adjust' ? 'adj' : 'op'), holdingId: op.holdingId, date: op.date, type: op.type, quantity: withQty ? Math.max(0, op.quantity ?? 0) : 0, amount: Math.abs(op.amount), planId: op.planId ?? null, estimated: false, note: op.note ?? (op.type === 'adjust' ? 'Recalé sur l’app du courtier' : ''), createdAt: op.createdAt ?? Date.now(), bankTxId: op.bankTxId ?? null });
  await done(database);
}

export async function removeOp(id: string, database: FactsDB = facts): Promise<void> {
  await database.table('investmentOps').delete(id);
  await done(database);
}

export async function saveGoal(g: Partial<RawGoal> & { name: string; target: number }, database: FactsDB = facts): Promise<string> {
  const now = Date.now();
  const existing = g.id ? await database.table<RawGoal, string>('goals').get(g.id) : undefined;
  const row: RawGoal = { emoji: '', monthly: 0, includeInBudget: false, achievedAt: null, order: now, createdAt: now, ...existing, ...g, id: g.id ?? uid('g'), name: g.name.trim() || 'Objectif', deadline: g.deadline || null, linkKind: g.linkKind ?? existing?.linkKind ?? 'manual', linkId: g.linkId ?? null };
  await database.table<RawGoal, string>('goals').put(row);
  await done(database);
  return row.id;
}

export async function removeGoal(id: string, database: FactsDB = facts): Promise<void> {
  await database.table('goalMoves').where('goalId').equals(id).delete();
  await database.table('goals').delete(id);
  await done(database);
}

/** Un versement (positif) ou un retrait (négatif) sur un objectif suivi à la main. */
export async function addGoalMove(goalId: string, amount: number, database: FactsDB = facts): Promise<void> {
  if (!amount) return;
  await database.table('goalMoves').put({ id: uid('gm'), goalId, date: todayISO(), amount, note: '', createdAt: Date.now() });
  await done(database);
}

export interface AssetHit {
  source: 'yahoo' | 'coingecko';
  symbol: string;
  name: string;
  assetClass: 'etf' | 'stock' | 'crypto' | 'fund' | 'other';
  exchange: string | null;
}

/** Chercher un titre ou une crypto par son nom, par le relais. Sans relais : aucune proposition, la saisie reste libre. */
export async function searchAsset(query: string, database: FactsDB = facts): Promise<AssetHit[]> {
  const settings = await bankSettings(database);
  if (!canUseRelay(settings) || query.trim().length < 2) return [];
  return new Relay(settings).searchAsset(query.trim());
}

export const rawPortfolio = (id: string, database: FactsDB = facts) => database.table<RawPortfolio, string>('portfolios').get(id);
export const rawGoals = (database: FactsDB = facts) => database.table<RawGoal, string>('goals').toArray();
