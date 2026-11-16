import { addDays } from '../core/dates';
import type { FinanceData } from '../core/model';
import type { Account, Db } from '../engine/schema';
import type { EngineState } from '../engine/state';
import type { Simulation } from '../engine/views';

/**
 * Le patrimoine, rangé : les familles de comptes (ce que montre l'écran d'abord), ce que vaut un compte, comment une
 * famille a bougé en trente jours, et les réglages de simulation d'un placement (les siens, sinon ceux par défaut).
 */
export const FAMILIES = [
  { id: 'placements', name: 'Placements', color: 'linear-gradient(135deg,#9bf0b7,#2fb36a)', dot: '#6fe0a0' },
  { id: 'epargne', name: 'Épargne', color: 'linear-gradient(135deg,#7fe6f7,#1da6cc)', dot: '#5ccbe6' },
  { id: 'biens', name: 'Biens', color: 'linear-gradient(135deg,#ffb07a,#f0601c)', dot: '#ff9a62' },
  { id: 'quotidien', name: 'Quotidien', color: 'linear-gradient(135deg,#cdbeff,#7b5cff)', dot: '#a58bff' },
  { id: 'dettes', name: 'Dettes', color: 'linear-gradient(135deg,#ffd0d0,#e06a6a)', dot: '#ffb8b8' },
] as const;
export type Family = (typeof FAMILIES)[number]['id'];

export const familyOf = (a: Account): Family => (a.role === 'LIABILITY' ? 'dettes' : a.includeInDailyCash ? 'quotidien' : a.role === 'INVESTMENT' ? 'placements' : a.role === 'ASSET' ? 'biens' : 'epargne');
export const valueOf = (a: Account): number => Math.round((a.balance ?? 0) * a.ownershipRatio);
/** Un compte qui rapporte : il a une simulation (versements, rendement, frais). */
export const canSimulate = (a: Account): boolean => familyOf(a) === 'placements' || familyOf(a) === 'epargne';

/** Ce que le plan verse chaque mois sur ce compte. */
export function plannedMonthly(db: Db, accountId: string): number {
  return db.commitments
    .filter((c) => c.kind === 'SAVING' && !c.paused && c.counterAccountId === accountId)
    .reduce((s, c) => s + (c.rhythm === 'WEEKLY' ? Math.round((c.amount * 52) / 12) : c.rhythm === 'BIWEEKLY' ? Math.round((c.amount * 26) / 12) : c.rhythm === 'MONTHLY' ? c.amount : 0), 0);
}

export function simulationOf(db: Db, state: EngineState, a: Account): Simulation {
  const base: Simulation = { monthly: plannedMonthly(db, a.id), rateBp: familyOf(a) === 'epargne' ? 200 : (state.projectionRateBp ?? 500), years: 10, entryFeeBp: 0, annualFeeBp: 0 };
  return { ...base, ...state.simulations?.[a.id] };
}

/**
 * La variation d'une famille en trente jours. Comptes du quotidien et d'épargne : la somme de leurs opérations.
 * Placements, biens, dettes : l'écart avec la photo du patrimoine d'il y a trente jours. null : pas de recul.
 */
export function familyChange(db: Db, data: FinanceData, family: Family, total: number, today: string): number | null {
  const since = addDays(today, -30);
  if (family === 'quotidien' || family === 'epargne') {
    const ids = new Set(db.accounts.filter((a) => !a.archivedAt && a.includeInNetWorth && familyOf(a) === family).map((a) => a.id));
    const accounts = new Map(db.accounts.map((a) => [a.id, a]));
    const moves = db.transactions.filter((t) => ids.has(t.accountId) && t.date > since && t.date <= today);
    return moves.length ? moves.reduce((s, t) => s + Math.round(t.amount * (accounts.get(t.accountId)?.ownershipRatio ?? 1)), 0) : null;
  }
  const ref = [...data.snapshots].sort((a, b) => b.date.localeCompare(a.date)).find((s) => s.date <= since);
  if (!ref) return null;
  return total - (family === 'placements' ? ref.investments : family === 'biens' ? ref.other : ref.debts);
}
