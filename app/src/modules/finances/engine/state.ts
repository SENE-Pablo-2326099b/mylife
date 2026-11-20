import { addDays, cycleFor, daysInMonth, diffDays, parseISO, toISO, type ISODate } from '../core/dates';
import { automate, type RecurringSuggestion } from './automation';
import { compute } from './engine';
import { buildOccurrences, currentCycle, isProvisioned, nextDue } from './occurrences';
import type { Simulation } from './views';
import type { Account, Allocation, Category, Commitment, Db, EngineSettings, Envelope, Flow, InstallmentPlan, OccurrenceOverride, Provision, Receivable, Rule, Tag, Transaction } from './schema';

/**
 * Ce que l'utilisateur règle et ce que le moteur retient d'un cycle à l'autre (étape M2). Les faits (comptes,
 * opérations) viennent de la reprise ; tout le reste vit ici : engagements, enveloppes, poches, paiements
 * fractionnés, décisions sur les échéances et sur les lignes, réglages, reports et cycles clos.
 * Fonctions pures : un état en entrée, un nouvel état en sortie.
 */

/** Les leviers posés sur une ligne. */
export type AllocationPatch = Partial<Pick<Allocation, 'smoothed' | 'fundedBySavings' | 'incomeUse' | 'flow' | 'categoryId' | 'tagIds' | 'linkedTransactionId' | 'settlesReceivableId'>>;
/** Ce que l'utilisateur change à un compte : son rôle et ses drapeaux. */
export type AccountPatch = Partial<Pick<Account, 'name' | 'role' | 'includeInDailyCash' | 'includeInNetWorth' | 'deferredDebit' | 'ownershipRatio' | 'alertThreshold' | 'balance' | 'archivedAt'>>;

export interface ManualEntry {
  transaction: Transaction;
  flow: Flow;
  categoryId: string | null;
}
export interface SplitPart {
  categoryId: string | null;
  /** Signé, comme la transaction. */
  amount: number;
}
/** Une saisie à la main et l'opération bancaire qui la confirme : même compte, même montant, à quelques jours près. */
export const MANUAL_MATCH_DAYS = 4;

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
  /** Les catégories créées ou modifiées par l'utilisateur (elles l'emportent sur celles de la reprise). */
  categories?: Category[];
  tags?: Tag[];
  /** Les comptes créés à la main (espèces, bien, dette, compte de provision…). */
  accounts?: Account[];
  /** Les opérations saisies à la main (espèces, ou avant que la banque les envoie). */
  manual?: ManualEntry[];
  /** Les opérations ventilées : par transaction, ses parts (leur somme égale son montant). */
  splits?: Record<string, SplitPart[]>;
  /** Hypothèse de rendement annuel de la projection du patrimoine, en points de base (500 = 5 %). */
  projectionRateBp?: number;
  /** Par compte : les réglages de sa simulation (versement, rendement, horizon, frais). Absent : les valeurs par défaut. */
  simulations?: Record<string, Partial<Simulation>>;
  /** Ce que l'utilisateur compte placer chaque mois, pour la projection (centimes). Absent : ce que prévoit le plan. */
  projectionMonthly?: number | null;
  /** La durée de la projection, en années (5 à 40). Absent : 10 ans. */
  projectionYears?: number;
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
  const mine = new Map((s.categories ?? []).map((c) => [c.id, c]));
  const categories = [...base.categories.map((c) => mine.get(c.id) ?? c), ...(s.categories ?? []).filter((c) => !base.categories.some((b) => b.id === c.id))].filter((c) => !c.deletedAt).sort((a, b) => a.order - b.order);
  const cats = new Set(categories.map((c) => c.id));
  const envelopes = s.envelopes.map((e) => ({ ...e, categoryIds: e.categoryIds.filter((id) => cats.has(id)) }));
  if (!envelopes.some((e) => e.isDefault)) envelopes.unshift(...base.envelopes.filter((e) => e.isDefault));
  const known = new Set(base.accounts.map((a) => a.id));
  const accounts = [...base.accounts, ...(s.accounts ?? []).filter((a) => !known.has(a.id))].map((a) => (s.accountPatches?.[a.id] ? { ...a, ...s.accountPatches[a.id] } : a));
  const accountIds = new Set(accounts.map((a) => a.id));
  // Saisies à la main. Sur un compte suivi par la banque, la saisie attend l'opération réelle : quand elle arrive
  // (même compte, même montant, à quelques jours près), la saisie s'efface devant elle et lui laisse son classement.
  // Jamais comptée deux fois.
  const bank = new Set(accounts.filter((a) => a.source === 'bank').map((a) => a.id));
  const taken = new Set<string>();
  const alias = new Map<string, string>();
  const inherited = new Map<string, { flow: Flow; categoryId: string | null }>();
  const kept: ManualEntry[] = [];
  for (const m of s.manual ?? []) {
    const t = m.transaction;
    const twin = bank.has(t.accountId) ? base.transactions.filter((b) => b.accountId === t.accountId && b.amount === t.amount && !taken.has(b.id) && Math.abs(diffDays(b.date, t.date)) <= MANUAL_MATCH_DAYS).sort((a, b) => Math.abs(diffDays(a.date, t.date)) - Math.abs(diffDays(b.date, t.date)))[0] : undefined;
    if (!twin) {
      if (accounts.some((a) => a.id === t.accountId)) kept.push(m);
      continue;
    }
    taken.add(twin.id);
    alias.set(`${t.id}#0`, `${twin.id}#0`);
    inherited.set(`${twin.id}#0`, { flow: m.flow, categoryId: m.categoryId });
  }
  // Ce qui a été décidé sur la saisie (levier, avance) suit l'opération bancaire.
  const patches: Record<string, AllocationPatch> = { ...s.allocationPatches };
  for (const [from, to] of alias) if (patches[from]) patches[to] = { ...patches[from], ...patches[to] };
  const defaults = s.merchantDefaults ?? {};
  const merchants = base.merchants.map((m) => (defaults[m.id] ? { ...m, ...defaults[m.id] } : m));
  // Ce qui est décidé à la main (nature, catégorie, lien) est marqué avant tout : les automatismes n'y touchent pas.
  const decided = (p: AllocationPatch | undefined) => !!p && ('flow' in p || 'categoryId' in p || 'linkedTransactionId' in p || 'settlesReceivableId' in p);
  const withManual = [
    ...base.allocations.map((a) => (inherited.has(a.id) ? { ...a, ...inherited.get(a.id), origin: 'manual' as const } : a)),
    ...kept.map((m): Allocation => ({ id: `${m.transaction.id}#0`, transactionId: m.transaction.id, amount: m.transaction.amount, flow: m.flow, categoryId: m.flow === 'EXPENSE' || m.flow === 'REFUND' ? m.categoryId : null, tagIds: [], origin: 'manual', note: '' })),
  ];
  // Ventilation : la ligne unique d'une opération est remplacée par ses parts, si leur somme tombe juste.
  const txAmount = new Map([...base.transactions, ...kept.map((m) => m.transaction)].map((t) => [t.id, t.amount]));
  const split = withManual.flatMap((a) => {
    const parts = s.splits?.[a.transactionId];
    if (!parts?.length || parts.reduce((n, p) => n + p.amount, 0) !== txAmount.get(a.transactionId) || a.id !== `${a.transactionId}#0`) return [a];
    return parts.map((p, i): Allocation => ({ ...a, id: `${a.transactionId}#${i}`, amount: p.amount, flow: 'EXPENSE', categoryId: p.categoryId, origin: 'manual' }));
  });
  const patched = split.map((a) => (decided(patches[a.id]) ? { ...a, origin: 'manual' as const } : a));
  const automated = automate({ ...base, transactions: [...base.transactions, ...kept.map((m) => m.transaction)], accounts, categories, tags: s.tags ?? [], merchants, rules: s.rules ?? [], allocations: patched, settings: { ...base.settings, ...s.settings } }, new Set(Object.keys(defaults)));
  const ids = new Set(automated.allocations.map((a) => a.id));
  const receivables = (s.receivables ?? []).map((r) => ({ ...r, allocationId: alias.get(r.allocationId) ?? r.allocationId })).filter((r) => ids.has(r.allocationId));
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
      const p = patches[a.id];
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

// ---------------------------------------------------------------- comptes, catégories, tags (M4)

/** Un compte créé à la main : espèces, bien, dette, compte de provision… Son solde se saisit. */
export const addAccount = (s: EngineState, a: Account): EngineState => ({ ...s, accounts: upsert(s.accounts ?? [], a) });
export const patchSettings = (s: EngineState, patch: Partial<EngineSettings>): EngineState => ({ ...s, settings: { ...s.settings, ...patch } });

export const saveTag = (s: EngineState, t: Tag): EngineState => ({ ...s, tags: upsert(s.tags ?? [], t) });
export const removeTag = (s: EngineState, id: string): EngineState => ({
  ...s,
  tags: (s.tags ?? []).filter((t) => t.id !== id),
  rules: (s.rules ?? []).map((r) => ({ ...r, tagIds: r.tagIds.filter((x) => x !== id) })),
  allocationPatches: Object.fromEntries(Object.entries(s.allocationPatches).map(([k, p]) => [k, p.tagIds ? { ...p, tagIds: p.tagIds.filter((x) => x !== id) } : p])),
});

/**
 * Enregistre une catégorie. Deux niveaux au plus : une sous-catégorie a une parente de premier niveau, du même
 * type ; une catégorie qui a des sous-catégories ne peut pas en devenir une. Sinon elle reste au premier niveau.
 * `all` : toutes les catégories telles qu'elles sont aujourd'hui.
 */
export function saveCategory(s: EngineState, c: Category, all: readonly Category[]): EngineState {
  const parent = c.parentId ? all.find((x) => x.id === c.parentId) : undefined;
  const hasChildren = all.some((x) => x.parentId === c.id && !x.mergedIntoId);
  const valid = parent && !parent.parentId && parent.id !== c.id && parent.scope === c.scope && !parent.mergedIntoId && !hasChildren;
  return { ...s, categories: upsert(s.categories ?? [], { ...c, name: c.name.trim(), parentId: valid ? parent.id : null }) };
}

/** Archiver : elle ne se propose plus, son historique reste. Ses sous-catégories suivent. Restaurer fait l'inverse. */
export function archiveCategory(s: EngineState, id: string, all: readonly Category[], at: number | null): EngineState {
  let categories = s.categories ?? [];
  for (const c of all) if (c.id === id || c.parentId === id) categories = upsert(categories, { ...c, archivedAt: at });
  return { ...s, categories };
}

/**
 * Ce qui tient encore à une catégorie : opérations, engagements, règles, marchands, sous-catégories, catégories
 * fusionnées en elle. Zéro : elle peut être supprimée sans rien laisser d'orphelin.
 */
export function categoryUse(db: Db, id: string): number {
  return (
    db.allocations.filter((a) => a.categoryId === id).length +
    db.commitments.filter((c) => c.categoryId === id).length +
    db.rules.filter((r) => r.categoryId === id).length +
    db.merchants.filter((m) => m.categoryId === id).length +
    db.categories.filter((c) => c.parentId === id || c.mergedIntoId === id).length
  );
}

/** Supprimer une catégorie qui ne sert à rien (voir `categoryUse`) : elle disparaît, et sort des enveloppes. */
export function removeCategory(s: EngineState, id: string, all: readonly Category[], at: number): EngineState {
  const c = all.find((x) => x.id === id);
  if (!c) return s;
  return { ...s, categories: upsert(s.categories ?? [], { ...c, deletedAt: at }), envelopes: s.envelopes.map((e) => ({ ...e, categoryIds: e.categoryIds.filter((x) => x !== id) })) };
}

/**
 * Fusionner une catégorie dans une autre : tout son historique se lit désormais comme celui de la cible, sans
 * réécrire aucune opération. Ses sous-catégories passent sous la cible (ou sa parente), ses règles et marchands
 * pointent vers la cible, et elle sort des enveloppes.
 */
export function mergeCategories(s: EngineState, fromId: string, intoId: string, all: readonly Category[], at: number): EngineState {
  const from = all.find((c) => c.id === fromId);
  const pointed = all.find((c) => c.id === intoId);
  const into = pointed?.mergedIntoId ? all.find((c) => c.id === pointed.mergedIntoId) : pointed;
  if (!from || !into || from.id === into.id || from.scope !== into.scope || into.parentId === from.id) return s;
  let categories = upsert(s.categories ?? [], { ...from, mergedIntoId: into.id, archivedAt: at, parentId: null });
  const home = into.parentId ?? into.id;
  for (const c of all) {
    if (c.id === from.id) continue;
    // Ce qui avait déjà été fusionné dans elle suit ; ses sous-catégories changent de parente.
    if (c.mergedIntoId === from.id) categories = upsert(categories, { ...c, mergedIntoId: into.id });
    else if (c.parentId === from.id) categories = upsert(categories, { ...c, parentId: c.id === home ? null : home });
  }
  const swap = (id: string | null) => (id === from.id ? into.id : id);
  return {
    ...s,
    categories,
    envelopes: s.envelopes.map((e) => ({ ...e, categoryIds: e.categoryIds.filter((x) => x !== from.id) })),
    rules: (s.rules ?? []).map((r) => ({ ...r, categoryId: swap(r.categoryId) })),
    merchantDefaults: Object.fromEntries(Object.entries(s.merchantDefaults ?? {}).map(([k, v]) => [k, { ...v, categoryId: swap(v.categoryId) }])),
  };
}

// ---------------------------------------------------------------- saisie à la main, ventilation (M5)

/** Le nouveau solde d'un compte tenu à la main après une opération (jamais négatif). Un compte bancaire ne bouge pas : la banque fait foi. */
const afterManual = (s: EngineState, account: Account, delta: number): EngineState => (account.source === 'manual' ? patchAccount(s, account.id, { balance: Math.max(0, (account.balance ?? 0) + delta) }) : s);

/** Saisir une opération à la main. `account` : le compte tel qu'il est aujourd'hui. */
export function addManual(s: EngineState, entry: ManualEntry, account: Account): EngineState {
  return afterManual({ ...s, manual: [...(s.manual ?? []), entry] }, account, entry.transaction.amount);
}

export function removeManual(s: EngineState, id: string, account: Account | undefined): EngineState {
  const entry = (s.manual ?? []).find((m) => m.transaction.id === id);
  if (!entry) return s;
  const next = { ...s, manual: (s.manual ?? []).filter((m) => m.transaction.id !== id) };
  return account ? afterManual(next, account, -entry.transaction.amount) : next;
}

/** Ventiler une opération en plusieurs parts (un ticket, deux catégories). Vide : retirer la ventilation. */
export function setSplit(s: EngineState, transactionId: string, parts: SplitPart[]): EngineState {
  const splits = { ...s.splits };
  if (parts.length >= 2) splits[transactionId] = parts;
  else delete splits[transactionId];
  return { ...s, splits };
}
