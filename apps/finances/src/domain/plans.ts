import type { Goal, Holding, InvestmentOp, InvestmentPlan, PlanFrequency } from '../db/types';
import { addDays, daysInMonth, parseISO, toISO, weekday, type ISODate } from '../lib/dates';

/** Investissements programmés (DCA) : échéances, équivalent mensuel, exécution. */

export const FREQUENCY_LABEL: Record<PlanFrequency, string> = { weekly: 'Chaque semaine', biweekly: 'Toutes les 2 semaines', monthly: 'Chaque mois' };

/** Montant mensuel équivalent (52 semaines / 12 mois). */
export function monthlyEquivalent(plan: Pick<InvestmentPlan, 'amount' | 'frequency' | 'active'>): number {
  if (!plan.active) return 0;
  if (plan.frequency === 'monthly') return plan.amount;
  if (plan.frequency === 'weekly') return Math.round((plan.amount * 52) / 12);
  return Math.round((plan.amount * 26) / 12);
}

/** Échéances d'un plan dans [from, to] (bornes incluses), jamais avant sa date de début. */
export function occurrences(plan: Pick<InvestmentPlan, 'frequency' | 'day' | 'startDate'>, from: ISODate, to: ISODate): ISODate[] {
  const start = from > plan.startDate ? from : plan.startDate;
  if (start > to) return [];
  const out: ISODate[] = [];
  if (plan.frequency === 'monthly') {
    let { y, m } = parseISO(start);
    for (;;) {
      const d = toISO(y, m, Math.min(plan.day, daysInMonth(y, m)));
      if (d > to) break;
      if (d >= start) out.push(d);
      m++;
      if (m > 12) {
        m = 1;
        y++;
      }
    }
    return out;
  }
  // Hebdomadaire : le jour de semaine choisi ; toutes les 2 semaines : à partir de la première échéance après le début.
  let d = plan.startDate;
  while (weekday(d) !== plan.day % 7) d = addDays(d, 1);
  const step = plan.frequency === 'weekly' ? 7 : 14;
  while (d < start) d = addDays(d, step);
  for (; d <= to; d = addDays(d, step)) out.push(d);
  return out;
}

/** Prochaine échéance à partir d'aujourd'hui (inclus). */
export function nextOccurrence(plan: Pick<InvestmentPlan, 'frequency' | 'day' | 'startDate'>, today: ISODate): ISODate | null {
  return occurrences(plan, today, addDays(today, 62))[0] ?? null;
}

/**
 * Mouvements à créer pour les échéances passées depuis la dernière exécution (au plus 400 jours).
 * La quantité est estimée au dernier cours connu ; sans cours, elle reste à 0 et le montant compte
 * quand même dans le capital investi.
 */
export function dueOperations(plan: InvestmentPlan, holding: Holding, today: ISODate, makeId: () => string, now = Date.now()): InvestmentOp[] {
  if (!plan.active) return [];
  const floor = addDays(today, -400);
  const from = plan.lastRunDate ? addDays(plan.lastRunDate, 1) : plan.startDate;
  return occurrences(plan, from > floor ? from : floor, today).map((date) => ({
    id: makeId(),
    holdingId: holding.id,
    date,
    type: 'buy' as const,
    quantity: holding.price ? Math.round((plan.amount / holding.price) * 1e8) / 1e8 : 0,
    amount: plan.amount,
    planId: plan.id,
    estimated: true,
    note: 'Investissement programmé',
    createdAt: now,
  }));
}

/** Épargne mensuelle prévue : plans actifs + contributions des objectifs comptées dans le budget. */
export function plannedMonthlySavings(plans: readonly InvestmentPlan[], goals: readonly Goal[]): number {
  return plans.reduce((s, p) => s + monthlyEquivalent(p), 0) + goals.filter((g) => g.includeInBudget && !g.achievedAt).reduce((s, g) => s + g.monthly, 0);
}
