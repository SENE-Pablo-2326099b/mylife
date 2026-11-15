import { addDays, cycleFor, daysInMonth, parseISO, toISO, type ISODate } from '../core/dates';
import { automate, type RecurringSuggestion } from './automation';
import { compute } from './engine';
import { buildOccurrences, currentCycle, isProvisioned, nextDue } from './occurrences';
import type { Account, Allocation, Commitment, Db, EngineSettings, Envelope, Flow, InstallmentPlan, OccurrenceOverride, Provision, Receivable, Rule } from './schema';

/**
 * Ce que l'utilisateur règle et ce que le moteur retient d'un cycle à l'autre (étape M2). Les faits (comptes,
 * opérations) viennent de la reprise ; tout le reste vit ici : engagements, enveloppes, poches, paiements
 * fractionnés, décisions sur les échéances et sur les lignes, réglages, reports et cycles clos.
 * Fonctions pures : un état en entrée, un nouvel état en sortie.
 */

/** Les leviers posés sur une ligne. */
export type AllocationPatch = Partial<Pick<Allocation, 'smoothed' | 'fundedBySavings' | 'incomeUse' | 'flow' | 'categoryId' | 'tagIds' | 'linkedTransactionId' | 'settlesReceivableId'>>;
/** Ce que l'utilisateur change à un compte : son rôle et ses drapeaux. */
export type AccountPatch = Partial<Pick<Account, 'role' | 'includeInDailyCash' | 'includeInNetWorth' | 'deferredDebit' | 'ownershipRatio'>>;

export interface ClosedCycle {
  start: ISODate;
  end: ISODate;
  closedAt: number;
  rav: number;
  spent: number;
  /** Pot du quotidien − dépensé : positif = excédent, négatif = dépassement. */
  result: number;
  envelopes: { id: string; name: string; budget: number; spent: number; result: number }[];
  /** Ce qui passe au cycle suivant. */
  carryOut: Db['carryIn'];
  /** Excédent qu'il est proposé d'envoyer vers l'épargne (politiques RESET et AUTO_SAVE). */
  toSave: number;
}

export interface EngineState {
  version: 1;
  commitments: Commitment[];
  envelopes: Envelope[];
  provisions: Provision[];
  installmentPlans: InstallmentPlan[];
  occurrenceOverrides: OccurrenceOverride[];
  allocationPatches: Record<string, AllocationPatch>;
  accountPatches?: Record<string, AccountPatch>;
  rules?: Rule[];
  /** Les marchands classés par l'utilisateur : ils s'imposent à toutes leurs opérations non décidées à la main. */
  merchantDefaults?: Record<string, { flow: Flow; categoryId: string | null }>;
  receivables?: Receivable[];
  /** Récurrents détectés que l'utilisateur ne veut pas au plan. */
  ignoredSuggestions?: string[];
  settings: EngineSettings;
  carryIn: Db['carryIn'];
  /** Début du cycle en cours la dernière fois que le moteur a tourné : sert à détecter qu'un cycle s'est terminé. */
  lastCycleStart: ISODate | null;
  /** Les plus récents d'abord. */
  closedCycles: ClosedCycle[];
}

/** Premier lancement : les réglages de départ issus de la reprise deviennent ceux de l'utilisateur. */
export function initState(base: Db): EngineState {
  return { version: 1, commitments: base.commitments, envelopes: base.envelopes, provisions: [], installmentPlans: [], occurrenceOverrides: [], allocationPatches: {}, settings: base.settings, carryIn: { global: 0, envelopes: {} }, lastCycleStart: null, closedCycles: [] };
}

/**
 * Les faits de la reprise, vus à travers les réglages de l'utilisateur. Dans l'ordre : ses comptes, ses règles et
 * ses marchands ; le classement automatique et l'appariement des virements ; puis ce qu'il a décidé à la main, qui a
 * toujours le dernier mot.
 */
export function applyState(base: Db, s: EngineState): Db {
  const cats = new Set(base.categories.map((c) => c.id));
  const envelopes = s.envelopes.map((e) => ({ ...e, categoryIds: e.categoryIds.filter((id) => cats.has(id)) }));
  if (!envelopes.some((e) => e.isDefault)) envelopes.unshift(...base.envelopes.filter((e) => e.isDefault));
  const accounts = base.accounts.map((a) => (s.accountPatches?.[a.id] ? { ...a, ...s.accountPatches[a.id] } : a));
  const accountIds = new Set(accounts.map((a) => a.id));
  const defaults = s.merchantDefaults ?? {};
  const merchants = base.merchants.map((m) => (defaults[m.id] ? { ...m, ...defaults[m.id] } : m));
  // Ce qui est décidé à la main (nature, catégorie, lien) est marqué avant tout : les automatismes n'y touchent pas.
  const decided = (p: AllocationPatch | undefined) => !!p && ('flow' in p || 'categoryId' in p || 'linkedTransactionId' in p || 'settlesReceivableId' in p);
  const patched = base.allocations.map((a) => (decided(s.allocationPatches[a.id]) ? { ...a, origin: 'manual' as const } : a));
  const automated = automate({ ...base, accounts, merchants, rules: s.rules ?? [], allocations: patched, settings: { ...base.settings, ...s.settings } }, new Set(Object.keys(defaults)));
  const receivables = (s.receivables ?? []).filter((r) => base.allocations.some((a) => a.id === r.allocationId));
  const advanced = new Map<string, number>();
  for (const r of receivables) advanced.set(r.allocationId, (advanced.get(r.allocationId) ?? 0) + r.amount);
  return {
    ...automated,
    commitments: s.commitments,
    envelopes,
    provisions: s.provisions.filter((p) => accountIds.has(p.accountId)),
    installmentPlans: s.installmentPlans,
    occurrenceOverrides: s.occurrenceOverrides,
    receivables,
    allocations: automated.allocations.map((a) => {
      const p = s.allocationPatches[a.id];
      const part = advanced.get(a.id);
      if (!p && part === undefined) return a;
      // La part avancée ne dépasse jamais la dépense.
      return { ...a, ...p, ...(part !== undefined ? { receivableAmount: Math.min(part, Math.max(0, -a.amount)) } : {}) };
    }),
    carryIn: s.carryIn,
  };
}

// ---------------------------------------------------------------- petites opérations

const upsert = <T extends { id: string }>(list: readonly T[], item: T): T[] => (list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item]);

export const saveCommitment = (s: EngineState, c: Commitment): EngineState => ({ ...s, commitments: upsert(s.commitments, c) });
export const removeCommitment = (s: EngineState, id: string): EngineState => ({
  ...s,
  commitments: s.commitments.filter((c) => c.id !== id),
  provisions: s.provisions.filter((p) => !(p.auto && p.commitmentId === id)).map((p) => (p.commitmentId === id ? { ...p, commitmentId: null } : p)),
  occurrenceOverrides: s.occurrenceOverrides.filter((o) => !o.id.startsWith(`${id}@`)),
  settings: s.settings.openingCommitmentId === id ? { ...s.settings, openingCommitmentId: null } : s.settings,
});
export const saveProvision = (s: EngineState, p: Provision): EngineState => ({ ...s, provisions: upsert(s.provisions, p) });
export const removeProvision = (s: EngineState, id: string): EngineState => ({ ...s, provisions: s.provisions.filter((p) => p.id !== id) });
export const patchAllocation = (s: EngineState, id: string, patch: AllocationPatch): EngineState => ({ ...s, allocationPatches: { ...s.allocationPatches, [id]: { ...s.allocationPatches[id], ...patch } } });
export const decideOccurrence = (s: EngineState, id: string, decision: OccurrenceOverride | null): EngineState => ({ ...s, occurrenceOverrides: [...s.occurrenceOverrides.filter((o) => o.id !== id), ...(decision ? [decision] : [])] });
export const resetCarry = (s: EngineState): EngineState => ({ ...s, carryIn: { global: 0, envelopes: {} } });
export const patchAccount = (s: EngineState, id: string, patch: AccountPatch): EngineState => ({ ...s, accountPatches: { ...s.accountPatches, [id]: { ...s.accountPatches?.[id], ...patch } } });
export const saveRule = (s: EngineState, r: Rule): EngineState => ({ ...s, rules: upsert(s.rules ?? [], r) });
export const removeRule = (s: EngineState, id: string): EngineState => ({ ...s, rules: (s.rules ?? []).filter((r) => r.id !== id) });
/** Classer un marchand : toutes ses opérations suivent, sauf celles décidées une à une. */
export const classifyMerchant = (s: EngineState, merchantId: string, flow: Flow, categoryId: string | null): EngineState => ({ ...s, merchantDefaults: { ...s.merchantDefaults, [merchantId]: { flow, categoryId: flow === 'EXPENSE' ? categoryId : null } } });
/** Classer une seule ligne, à la main. */
export const classifyAllocation = (s: EngineState, id: string, flow: Flow, categoryId: string | null): EngineState => patchAllocation(s, id, { flow, categoryId: flow === 'EXPENSE' || flow === 'REFUND' ? categoryId : null });
export const ignoreSuggestion = (s: EngineState, key: string): EngineState => ({ ...s, ignoredSuggestions: [...new Set([...(s.ignoredSuggestions ?? []), key])] });

/** Un récurrent détecté devient un engagement du plan. */
export function acceptSuggestion(s: EngineState, x: RecurringSuggestion): EngineState {
  const c: Commitment = { id: `rec:${x.key}`, kind: x.kind, label: x.label, amount: x.amount, tolerance: 0.2, rhythm: x.rhythm, anchorDay: x.anchorDay, anchorDate: x.rhythm === 'BIWEEKLY' ? x.anchorDate : null, accountId: x.accountId, counterAccountId: null, categoryId: null, startDate: null, endDate: null, remainingOccurrences: null, installmentPlanId: null, direct: false, paused: false, reserveInCash: null, provisionMonthly: false };
  return saveCommitment(s, c);
}

// ---- créances : une part de dépense avancée pour quelqu'un

/** Avancer une part : elle sort du budget et devient une créance à récupérer. */
export const addReceivable = (s: EngineState, r: { id: string; person: string; amount: number; allocationId: string }, now: number = Date.now()): EngineState => ({ ...s, receivables: [...(s.receivables ?? []), { ...r, status: 'OPEN', createdAt: now, writtenOffAt: null }] });

/** Récupérée : la créance est soldée. Si une rentrée d'argent la rembourse, celle-ci lui est liée et pèse zéro. */
export function settleReceivable(s: EngineState, id: string, allocationId: string | null): EngineState {
  const next = { ...s, receivables: (s.receivables ?? []).map((r) => (r.id === id ? { ...r, status: 'SETTLED' as const } : r)) };
  return allocationId ? patchAllocation(next, allocationId, { flow: 'REFUND', categoryId: null, settlesReceivableId: id }) : next;
}

/** Abandonnée : la part redevient une dépense, à la date de l'abandon. */
export const writeOffReceivable = (s: EngineState, id: string, today: ISODate): EngineState => ({ ...s, receivables: (s.receivables ?? []).map((r) => (r.id === id ? { ...r, status: 'WRITTEN_OFF' as const, writtenOffAt: today } : r)) });
/** Supprimée (saisie par erreur) : la dépense pèse de nouveau en entier, à sa date. */
export const removeReceivable = (s: EngineState, id: string): EngineState => ({ ...s, receivables: (s.receivables ?? []).filter((r) => r.id !== id) });

/** Une catégorie n'appartient qu'à une enveloppe : l'enregistrer dans l'une la retire des autres. L'enveloppe par défaut ne se supprime pas. */
export function saveEnvelope(s: EngineState, e: Envelope): EngineState {
  const others = s.envelopes.filter((x) => x.id !== e.id).map((x) => ({ ...x, categoryIds: x.categoryIds.filter((id) => !e.categoryIds.includes(id)) }));
  const exists = s.envelopes.some((x) => x.id === e.id);
  return { ...s, envelopes: exists ? s.envelopes.map((x) => (x.id === e.id ? e : others.find((o) => o.id === x.id)!)) : [...others, e] };
}
export const removeEnvelope = (s: EngineState, id: string): EngineState => ({ ...s, envelopes: s.envelopes.filter((e) => e.id !== id || e.isDefault) });

const addMonths = (date: ISODate, n: number, day: number): ISODate => {
  const { y, m } = parseISO(date);
  const idx = y * 12 + (m - 1) + n;
  const yy = Math.floor(idx / 12);
  const mm = (idx % 12) + 1;
  return toISO(yy, mm, Math.min(day, daysInMonth(yy, mm)));
};

/**
 * Un achat payé en plusieurs fois : `count` échéances égales, dont `paidCount` déjà payées, la prochaine le
 * `nextDate`, puis une par mois. Chaque échéance pèse sur son propre cycle ; rien ne pèse d'un coup.
 */
export function addInstallmentPlan(s: EngineState, input: { id: string; label: string; total: number; count: number; paidCount: number; nextDate: ISODate; accountId: string | null; provider?: string }): EngineState {
  const left = Math.max(0, input.count - input.paidCount);
  const day = parseISO(input.nextDate).d;
  const plan: InstallmentPlan = { id: input.id, label: input.label, total: input.total, count: input.count, provider: input.provider ?? '', purchaseTransactionId: null };
  const commitment: Commitment = {
    id: `inst:${input.id}`,
    kind: 'INSTALLMENT',
    label: input.label,
    amount: Math.round(input.total / input.count),
    tolerance: 0.05,
    rhythm: 'MONTHLY',
    anchorDay: day,
    anchorDate: null,
    accountId: input.accountId,
    counterAccountId: null,
    categoryId: null,
    startDate: input.nextDate,
    endDate: left > 0 ? addMonths(input.nextDate, left - 1, day) : addDays(input.nextDate, -1),
    remainingOccurrences: null,
    installmentPlanId: input.id,
    direct: false,
    paused: false,
    reserveInCash: null,
    provisionMonthly: false,
  };
  return { ...s, installmentPlans: upsert(s.installmentPlans, plan), commitments: upsert(s.commitments, commitment) };
}

export const removeInstallmentPlan = (s: EngineState, id: string): EngineState => ({
  ...removeCommitment(s, `inst:${id}`),
  installmentPlans: s.installmentPlans.filter((p) => p.id !== id),
  provisions: s.provisions.map((p) => (p.installmentPlanId === id ? { ...p, installmentPlanId: null } : p)),
});

// ---------------------------------------------------------------- le passage du temps

/** Nombre de cycles d'ici une échéance, celui en cours compris. */
function cyclesUntil(start: ISODate, due: ISODate, payday: number): number {
  let n = 1;
  let c = cycleFor(start, payday);
  while (c.end < due && n < 240) {
    c = cycleFor(addDays(c.end, 1), payday);
    n++;
  }
  return n;
}

/**
 * Clôture d'un cycle : son résultat est figé, et ses reports calculés.
 * - excédent : `ROLLOVER` le reporte ; `RESET` et `AUTO_SAVE` le remettent à zéro et le proposent à l'épargne ;
 * - dépassement : `DEDUCT_NEXT` le déduit du cycle suivant ; `FORGIVE` l'oublie.
 * Chaque enveloppe plafonnée suit sa propre politique ; le pot du quotidien suit celle des réglages.
 */
export function closeCycle(db: Db, end: ISODate, now: number): ClosedCycle {
  const e = compute(db, end);
  const carry = (result: number, endPolicy: Envelope['endPolicy'], overspend: Envelope['overspendPolicy']) => (result >= 0 ? (endPolicy === 'ROLLOVER' ? result : 0) : overspend === 'DEDUCT_NEXT' ? result : 0);
  const saved = (result: number, endPolicy: Envelope['endPolicy']) => (result > 0 && endPolicy !== 'ROLLOVER' ? result : 0);
  const capped = e.envelopes.filter((x) => x.budget !== null && !x.envelope.isDefault);
  const envelopes = capped.map((x) => ({ id: x.envelope.id, name: x.envelope.name, budget: x.budget!, spent: x.spent, result: x.budget! - x.spent }));
  const carryEnvelopes: Record<string, number> = {};
  let toSave = saved(e.resteEnveloppe, db.settings.endPolicy);
  for (const x of capped) {
    const result = x.budget! - x.spent;
    const c = carry(result, x.envelope.endPolicy, x.envelope.overspendPolicy);
    if (c !== 0) carryEnvelopes[x.envelope.id] = c;
    // L'excédent d'une enveloppe hors quotidien est de l'argent mis à part et non dépensé : épargnable aussi.
    if (!x.envelope.inDailyBudget) toSave += saved(result, x.envelope.endPolicy);
  }
  return { start: e.cycle.start, end: e.cycle.end, closedAt: now, rav: e.rav, spent: e.spent, result: e.resteEnveloppe, envelopes, carryOut: { global: carry(e.resteEnveloppe, db.settings.endPolicy, db.settings.overspendPolicy), envelopes: carryEnvelopes }, toSave };
}

/**
 * Ce que le moteur fait tout seul quand le temps passe, à chaque ouverture :
 * 1. clore les cycles terminés depuis la dernière fois, l'un après l'autre, et poser leurs reports ;
 * 2. cotiser aux provisions mensuelles pour le cycle en cours (une fois par cycle), créer leur poche au besoin ;
 * 3. vider la poche d'une charge provisionnée une fois celle-ci payée.
 */
export function roll(s: EngineState, base: Db, today: ISODate, now: number = Date.now()): EngineState {
  let state = s;
  const cycle = currentCycle(applyState(base, state), today);

  // 1. clôtures
  if (state.lastCycleStart === null) state = { ...state, lastCycleStart: cycle.start };
  let guard = 0;
  while (state.lastCycleStart !== null && state.lastCycleStart < cycle.start && guard++ < 36) {
    const db = applyState(base, state);
    const closing = currentCycle(db, state.lastCycleStart);
    if (closing.end >= cycle.start) break;
    const closed = closeCycle(db, closing.end, now);
    state = { ...state, carryIn: closed.carryOut, closedCycles: [closed, ...state.closedCycles].slice(0, 36), lastCycleStart: addDays(closing.end, 1) };
  }
  if (state.lastCycleStart !== cycle.start) state = { ...state, lastCycleStart: cycle.start };

  // 2 et 3. provisions mensuelles
  const db = applyState(base, state);
  const occurrences = buildOccurrences(db, cycle);
  let provisions = state.provisions;
  for (const c of state.commitments) {
    const id = `auto:${c.id}`;
    const existing = provisions.find((p) => p.id === id);
    if (!isProvisioned(c) || c.paused) {
      // Provision arrêtée : la poche redevient une poche ordinaire, que l'utilisateur libère s'il veut.
      if (existing?.auto) provisions = provisions.map((p) => (p.id === id ? { ...p, auto: false } : p));
      continue;
    }
    const account = c.accountId ?? base.accounts.find((a) => a.includeInDailyCash && !a.archivedAt)?.id;
    if (!account) continue;
    let p: Provision = existing ?? { id, accountId: account, label: c.label, amount: 0, commitmentId: c.id, installmentPlanId: null, goalId: null, status: 'ACTIVE', auto: true, contributions: {}, consumedFor: null };
    p = { ...p, auto: true, status: 'ACTIVE', commitmentId: c.id, contributions: p.contributions ?? {} };
    const paid = occurrences.find((o) => o.commitment.id === c.id && o.status === 'PAID');
    if (paid && p.consumedFor !== paid.id) p = { ...p, amount: 0, consumedFor: paid.id };
    const due = paid ? null : nextDue(c, cycle.start);
    if (due && p.contributions![cycle.start] === undefined) {
      const k = cyclesUntil(cycle.start, due, db.settings.payday);
      const q = Math.max(0, Math.ceil((c.amount - p.amount) / k));
      p = { ...p, amount: p.amount + q, contributions: { ...p.contributions, [cycle.start]: q } };
    }
    provisions = upsert(provisions, p);
  }
  return provisions === state.provisions ? state : { ...state, provisions };
}
