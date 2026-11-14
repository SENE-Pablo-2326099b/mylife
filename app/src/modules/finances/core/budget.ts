import { cycleFor, daysRemaining, inRange, type Cycle, type ISODate } from './dates';
import type { Account, AccountFamily, FinanceData, Holding, InvestmentOp, Movement, Planned } from './model';

/**
 * Les calculs du budget et du patrimoine, en fonctions pures.
 *
 *   reste à vivre du cycle = revenus prévus − charges prévues − épargne prévue
 *   à dépenser aujourd'hui = (reste à vivre − déjà dépensé avant aujourd'hui) ÷ jours restants − dépensé aujourd'hui
 *
 * « Dépensé » : les dépenses de vie courante (catégories non fixes), remboursements déduits. Les charges fixes, les
 * virements et l'épargne n'y entrent pas : ils sont dans le plan.
 */

/** Montant d'une ligne prévue ramené à un cycle (un mois). */
export function perCycle(p: Pick<Planned, 'amount' | 'rhythm'>): number {
  return p.rhythm === 'weekly' ? Math.round((p.amount * 52) / 12) : p.rhythm === 'biweekly' ? Math.round((p.amount * 26) / 12) : p.amount;
}

export interface PlanTotals {
  revenus: number;
  charges: number;
  epargne: number;
  resteAVivre: number;
}

export function planTotals(planned: readonly Planned[]): PlanTotals {
  const sum = (kind: Planned['kind']) => planned.filter((p) => p.active && p.kind === kind).reduce((s, p) => s + perCycle(p), 0);
  const revenus = sum('revenu');
  const charges = sum('charge');
  const epargne = sum('epargne');
  return { revenus, charges, epargne, resteAVivre: revenus - charges - epargne };
}

/** Ce qu'un mouvement pèse dans les dépenses de vie courante (positif = dépensé, négatif = remboursé). */
export function livingSpend(m: Movement, fixed: ReadonlySet<string>, byId?: ReadonlyMap<string, Movement>): number {
  if (m.pending && m.source === 'bank' && m.nature === null) return 0;
  const living = (categoryId: string | null) => categoryId === null || !fixed.has(categoryId);
  if (m.nature === 'depense') {
    if (m.split?.length) return -m.split.filter((s) => living(s.categoryId)).reduce((s, p) => s + p.amount, 0);
    return living(m.categoryId) ? -m.amount : 0;
  }
  if (m.nature === 'remboursement') {
    const target = m.refundOf ? byId?.get(m.refundOf) : undefined;
    const categoryId = target ? target.categoryId : m.categoryId;
    // Sans dépense ni catégorie rattachée (un ami qui rend de l'argent) : neutre.
    if (!target && categoryId === null) return 0;
    return living(categoryId) ? -m.amount : 0;
  }
  return 0;
}

export interface DayBudget {
  cycle: Cycle;
  plan: PlanTotals;
  /** Dépensé dans le cycle, aujourd'hui compris. */
  spent: number;
  spentToday: number;
  /** Reste à vivre − dépensé (peut être négatif). */
  remaining: number;
  /** Jours restants, aujourd'hui compris. */
  daysLeft: number;
  /** Budget de la journée, avant ses dépenses. */
  daily: number;
  /** Ce qu'il reste à dépenser aujourd'hui (négatif : dépassé). */
  leftToday: number;
  /** Budget par jour à partir de demain. */
  tomorrow: number;
  /** Part du reste à vivre déjà dépensée, de 0 à 1 (plafonnée). */
  used: number;
}

export function dayBudget(data: FinanceData, today: ISODate): DayBudget {
  const cycle = cycleFor(today, data.settings.payday);
  const plan = planTotals(data.planned);
  const fixed = new Set(data.categories.filter((c) => c.fixed).map((c) => c.id));
  const byId = new Map(data.movements.map((m) => [m.id, m]));
  const quotidien = new Set(data.accounts.filter((a) => a.family === 'quotidien' && !a.hidden).map((a) => a.id));
  let spent = 0;
  let spentToday = 0;
  for (const m of data.movements) {
    if (!quotidien.has(m.accountId) || !inRange(m.date, cycle.start, today)) continue;
    const s = livingSpend(m, fixed, byId);
    spent += s;
    if (m.date === today) spentToday += s;
  }
  const daysLeft = Math.max(1, daysRemaining(today, cycle));
  const daily = Math.max(0, Math.round((plan.resteAVivre - (spent - spentToday)) / daysLeft));
  const remaining = plan.resteAVivre - spent;
  return {
    cycle,
    plan,
    spent,
    spentToday,
    remaining,
    daysLeft,
    daily,
    leftToday: daily - spentToday,
    tomorrow: daysLeft > 1 ? Math.max(0, Math.round(remaining / (daysLeft - 1))) : 0,
    used: plan.resteAVivre > 0 ? Math.min(1, Math.max(0, spent / plan.resteAVivre)) : spent > 0 ? 1 : 0,
  };
}

// ---------------------------------------------------------------- patrimoine

export interface Position {
  holding: Holding;
  quantity: number;
  /** Coût de revient restant (prix de revient moyen pondéré), en centimes. */
  invested: number;
  /** Valeur au dernier cours ; sans cours, le coût de revient. */
  value: number;
  gain: number;
}

/** Position d'une ligne : prix de revient moyen pondéré, comme les courtiers français. Un recalage remplace tout. */
export function position(holding: Holding, ops: readonly InvestmentOp[]): Position {
  let quantity = 0;
  let invested = 0;
  const rank = (o: InvestmentOp) => (o.type === 'adjust' ? 1 : 0);
  const sorted = ops.filter((o) => o.holdingId === holding.id).sort((a, b) => a.date.localeCompare(b.date) || rank(a) - rank(b) || a.createdAt - b.createdAt);
  for (const o of sorted) {
    if (o.type === 'buy') {
      quantity += o.quantity;
      invested += o.amount;
    } else if (o.type === 'sell') {
      if (quantity > 0) invested -= Math.round(invested * Math.min(1, o.quantity / quantity));
      quantity = Math.max(0, quantity - o.quantity);
    } else if (o.type === 'adjust') {
      quantity = o.quantity;
      invested = o.amount;
    }
  }
  quantity = Math.round(quantity * 1e8) / 1e8;
  const value = holding.price === null ? invested : Math.round(quantity * holding.price);
  return { holding, quantity, invested, value, gain: value - invested };
}

/** Ce que vaut un compte, en centimes positifs (une dette : ce qu'il reste à rembourser). */
export function accountValue(account: Account, data: Pick<FinanceData, 'holdings' | 'investmentOps'>): number {
  const lines = data.holdings.filter((h) => h.accountId === account.id);
  if (lines.length) return lines.reduce((s, h) => s + position(h, data.investmentOps).value, 0);
  return account.balance ?? 0;
}

export interface NetWorth {
  byFamily: Record<AccountFamily, number>;
  /** Tout ce que tu possèdes. */
  gross: number;
  /** Moins les dettes. */
  net: number;
}

export function netWorth(data: FinanceData): NetWorth {
  const byFamily: Record<AccountFamily, number> = { quotidien: 0, epargne: 0, placements: 0, biens: 0, dettes: 0 };
  for (const a of data.accounts) if (!a.hidden) byFamily[a.family] += accountValue(a, data);
  const gross = byFamily.quotidien + byFamily.epargne + byFamily.placements + byFamily.biens;
  return { byFamily, gross, net: gross - byFamily.dettes };
}
