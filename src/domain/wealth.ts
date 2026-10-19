import type { Account, AssetClass, Goal, GoalMove, Holding, InvestmentOp, InvestmentOpType, ManualAsset, Portfolio, Snapshot, Transaction } from '../db/types';
import { addDays, type ISODate } from '../lib/dates';

/**
 * Patrimoine : tout est calculé à partir des données (mouvements, cours, soldes), rien n'est stocké
 * en double. Montants en centimes entiers ; les quantités (parts, BTC) sont des nombres décimaux.
 */

export interface Position {
  holding: Holding;
  /** Quantité détenue (achats − ventes). */
  quantity: number;
  /** Coût de revient restant (achats − part vendue au prix de revient moyen), en centimes. */
  invested: number;
  /** Valeur au dernier cours (null si aucun cours connu). */
  value: number | null;
  /** Plus-value latente (value − invested). */
  gain: number | null;
  /** Prix de revient unitaire moyen, en centimes. */
  averageCost: number | null;
  /** Dividendes et intérêts reçus, frais payés (net). */
  income: number;
  /** Une quantité a été estimée (plan programmé sans cours exact). */
  estimated: boolean;
}

/** Positions d'une ligne : prix de revient moyen pondéré (PRU), comme les courtiers français. */
export function position(holding: Holding, ops: readonly InvestmentOp[]): Position {
  let quantity = 0;
  let invested = 0;
  let income = 0;
  let estimated = false;
  const sorted = [...ops].filter((o) => o.holdingId === holding.id).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  for (const o of sorted) {
    if (o.estimated) estimated = true;
    switch (o.type) {
      case 'buy':
        quantity += o.quantity;
        invested += o.amount;
        break;
      case 'sell': {
        if (quantity > 0) {
          const share = Math.min(1, o.quantity / quantity);
          invested -= Math.round(invested * share);
        }
        quantity = Math.max(0, quantity - o.quantity);
        break;
      }
      case 'dividend':
      case 'interest':
        income += o.amount;
        break;
      case 'fee':
        income -= o.amount;
        break;
    }
  }
  // Évite les poussières de calcul flottant (0,1 + 0,2…).
  quantity = Math.round(quantity * 1e8) / 1e8;
  const value = holding.price === null ? (holding.assetClass === 'cash' ? invested : null) : Math.round(quantity * holding.price);
  return {
    holding,
    quantity,
    invested,
    value,
    gain: value === null ? null : value - invested,
    averageCost: quantity > 0 ? Math.round(invested / quantity) : null,
    income,
    estimated,
  };
}

export interface PortfolioSummary {
  portfolio: Portfolio;
  positions: Position[];
  value: number;
  invested: number;
  gain: number;
  /** Rendement latent en % du capital investi (null si rien d'investi). */
  gainPercent: number | null;
  /** Des lignes n'ont pas de cours : leur coût de revient remplace la valeur. */
  missingPrices: number;
}

export function summarizePortfolio(portfolio: Portfolio, holdings: readonly Holding[], ops: readonly InvestmentOp[]): PortfolioSummary {
  const positions = holdings
    .filter((h) => h.portfolioId === portfolio.id)
    .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)
    .map((h) => position(h, ops));
  let value = 0;
  let invested = 0;
  let missingPrices = 0;
  for (const p of positions) {
    invested += p.invested;
    if (p.value === null) {
      missingPrices++;
      value += p.invested;
    } else value += p.value;
  }
  const gain = value - invested;
  return { portfolio, positions, value, invested, gain, gainPercent: invested > 0 ? Math.round((gain * 1000) / invested) / 10 : null, missingPrices };
}

export interface NetWorth {
  /** Comptes bancaires (soldes connus, comptes non masqués). */
  cash: number;
  investments: number;
  invested: number;
  other: number;
  debts: number;
  total: number;
}

export function bankCash(accounts: readonly Account[]): number {
  return accounts.filter((a) => !a.hidden && a.balance !== null).reduce((s, a) => s + (a.balance ?? 0), 0);
}

export function netWorth(accounts: readonly Account[], summaries: readonly PortfolioSummary[], assets: readonly ManualAsset[]): NetWorth {
  const cash = bankCash(accounts);
  const investments = summaries.reduce((s, p) => s + p.value, 0);
  const invested = summaries.reduce((s, p) => s + p.invested, 0);
  const other = assets.filter((a) => a.kind === 'asset').reduce((s, a) => s + a.value, 0);
  const debts = assets.filter((a) => a.kind === 'debt').reduce((s, a) => s + a.value, 0);
  return { cash, investments, invested, other, debts, total: cash + investments + other - debts };
}

export const OP_LABEL: Record<InvestmentOpType, string> = { buy: 'Achat', sell: 'Vente', dividend: 'Dividende', fee: 'Frais', interest: 'Intérêts' };

export const ASSET_CLASS_LABEL: Record<AssetClass, string> = {
  etf: 'ETF',
  stock: 'Actions',
  crypto: 'Crypto',
  bond: 'Obligations',
  fund: 'Fonds',
  cash: 'Liquidités',
  other: 'Autre',
};

/** Répartition par classe d'actifs (valeur, ou coût de revient à défaut de cours). */
export function allocationByClass(summaries: readonly PortfolioSummary[]): { assetClass: AssetClass; value: number }[] {
  const map = new Map<AssetClass, number>();
  for (const s of summaries) for (const p of s.positions) map.set(p.holding.assetClass, (map.get(p.holding.assetClass) ?? 0) + (p.value ?? p.invested));
  return [...map.entries()].map(([assetClass, value]) => ({ assetClass, value })).filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
}

/**
 * Historique du solde bancaire reconstitué à rebours : solde d'aujourd'hui − opérations postérieures.
 * Donne une courbe dès la première synchro, sans attendre d'accumuler des photos quotidiennes.
 */
export function cashHistory(accounts: readonly Account[], txs: readonly Transaction[], from: ISODate, to: ISODate): { date: ISODate; cash: number }[] {
  const visible = new Set(accounts.filter((a) => !a.hidden && a.balance !== null).map((a) => a.id));
  let balance = bankCash(accounts);
  const byDay = new Map<ISODate, number>();
  for (const t of txs) {
    if (!visible.has(t.accountId) || t.pending) continue;
    byDay.set(t.date, (byDay.get(t.date) ?? 0) + t.amount);
  }
  // Les opérations postérieures à `to` sont déjà dans le solde actuel : on les retire d'abord.
  for (const [d, amount] of byDay) if (d > to) balance -= amount;
  const out: { date: ISODate; cash: number }[] = [];
  for (let d = to; d >= from; d = addDays(d, -1)) {
    out.push({ date: d, cash: balance });
    balance -= byDay.get(d) ?? 0;
  }
  return out.reverse();
}

/** Photo du jour (une par jour, la dernière l'emporte). */
export function makeSnapshot(date: ISODate, worth: NetWorth): Snapshot {
  return { date, cash: worth.cash, investments: worth.investments, invested: worth.invested, other: worth.other, debts: worth.debts };
}

export const snapshotTotal = (s: Snapshot): number => s.cash + s.investments + s.other - s.debts;

// ---------------------------------------------------------------- objectifs

export interface GoalProgress {
  goal: Goal;
  saved: number;
  /** 0..1 */
  ratio: number;
  remaining: number;
  achieved: boolean;
  /** Mois restants avant l'échéance (null sans échéance). */
  monthsLeft: number | null;
  /** Versement mensuel nécessaire pour tenir l'échéance. */
  requiredMonthly: number | null;
  /** Date atteinte au rythme prévu (null sans contribution). */
  projectedDate: ISODate | null;
  status: 'achieved' | 'on-track' | 'behind' | 'no-plan';
}

function monthsBetween(from: ISODate, to: ISODate): number {
  const [y1, m1, d1] = from.split('-').map(Number) as [number, number, number];
  const [y2, m2, d2] = to.split('-').map(Number) as [number, number, number];
  return (y2 - y1) * 12 + (m2 - m1) + (d2 - d1) / 30;
}

function addMonths(date: ISODate, n: number): ISODate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const dim = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, dim)).padStart(2, '0')}`;
}

/** Montant mis de côté pour un objectif selon son suivi (versements, compte ou portefeuille). */
export function goalSaved(goal: Goal, moves: readonly GoalMove[], accounts: readonly Account[], summaries: readonly PortfolioSummary[]): number {
  if (goal.linkKind === 'account') return accounts.find((a) => a.id === goal.linkId)?.balance ?? 0;
  if (goal.linkKind === 'portfolio') return summaries.find((s) => s.portfolio.id === goal.linkId)?.value ?? 0;
  return moves.filter((m) => m.goalId === goal.id).reduce((s, m) => s + m.amount, 0);
}

export function goalProgress(goal: Goal, saved: number, today: ISODate): GoalProgress {
  const remaining = Math.max(0, goal.target - saved);
  const achieved = goal.target > 0 && saved >= goal.target;
  const monthsLeft = goal.deadline ? Math.max(0, monthsBetween(today, goal.deadline)) : null;
  const requiredMonthly = monthsLeft === null ? null : remaining === 0 ? 0 : Math.ceil(remaining / Math.max(1, monthsLeft));
  const projectedDate = remaining === 0 ? today : goal.monthly > 0 ? addMonths(today, Math.ceil(remaining / goal.monthly)) : null;
  let status: GoalProgress['status'];
  if (achieved) status = 'achieved';
  else if (goal.monthly <= 0 && requiredMonthly !== null) status = 'no-plan';
  else if (requiredMonthly !== null && goal.monthly < requiredMonthly) status = 'behind';
  else if (goal.monthly > 0) status = 'on-track';
  else status = 'no-plan';
  return {
    goal,
    saved,
    ratio: goal.target > 0 ? Math.min(1, Math.max(0, saved / goal.target)) : 0,
    remaining,
    achieved,
    monthsLeft: monthsLeft === null ? null : Math.round(monthsLeft * 10) / 10,
    requiredMonthly,
    projectedDate,
    status,
  };
}

export { addMonths, monthsBetween };

/**
 * Historique du patrimoine sur [from, to] : les photos quotidiennes quand elles existent ; avant la
 * première, une estimation (solde bancaire reconstitué + capital investi à cette date + autres actifs).
 */
export function wealthHistory(input: {
  from: ISODate;
  to: ISODate;
  snapshots: readonly Snapshot[];
  cash: readonly { date: ISODate; cash: number }[];
  ops: readonly InvestmentOp[];
  worth: NetWorth;
}): { date: ISODate; total: number; estimated: boolean }[] {
  const snaps = new Map(input.snapshots.map((s) => [s.date, s]));
  const cashBy = new Map(input.cash.map((c) => [c.date, c.cash]));
  const buys = [...input.ops].filter((o) => o.type === 'buy' || o.type === 'sell').sort((a, b) => a.date.localeCompare(b.date));
  const out: { date: ISODate; total: number; estimated: boolean }[] = [];
  let invested = 0;
  let k = 0;
  let lastSnap: Snapshot | null = null;
  for (let d = input.from; d <= input.to; d = addDays(d, 1)) {
    while (k < buys.length && (buys[k] as InvestmentOp).date <= d) {
      const o = buys[k] as InvestmentOp;
      invested += o.type === 'buy' ? o.amount : -o.amount;
      k++;
    }
    const s = snaps.get(d);
    if (s) {
      lastSnap = s;
      out.push({ date: d, total: snapshotTotal(s), estimated: false });
    } else if (lastSnap) {
      // Entre deux photos (jour sans ouverture de l'app) : on prolonge la dernière, corrigée du solde bancaire.
      const c = cashBy.get(d);
      out.push({ date: d, total: snapshotTotal(lastSnap) + (c === undefined ? 0 : c - lastSnap.cash), estimated: true });
    } else {
      out.push({ date: d, total: (cashBy.get(d) ?? input.worth.cash) + Math.max(0, invested) + input.worth.other - input.worth.debts, estimated: true });
    }
  }
  return out;
}
