import type { BudgetLine, Category, Settings, Transaction } from '../db/types';
import { addDays, cycleFor, cycleLength, diffDays, type Cycle, type ISODate } from '../lib/dates';
import { normalizeText } from '../lib/text';
import { CAT, plannedSavings, totalFixed } from './defaults';
import { sameFlow, significantWords, skippedAmounts, type RecurringSkips } from './recurringList';

/**
 * Moteur du budget : transactions + réglages + date du jour → état du budget.
 * Fonctions pures (aucune base, aucune interface), montants en centimes entiers, dates calendaires
 * « AAAA-MM-JJ » sans heure ni fuseau.
 *
 * Choix retenus quand la spécification laisse une marge (notés ici une fois pour toutes) :
 * - Paie en avance : une paie arrivée jusqu'à EARLY_PAY_DAYS jours avant le jour de paie ouvre le
 *   cycle ce jour-là. Une paie en retard ne repousse pas le cycle (le budget du jour ne doit pas
 *   s'arrêter faute de virement) : le jour de paie configuré reste la limite.
 * - La « paie » est la plus grosse ligne de revenu versée sur le compte ; une opération de revenu
 *   s'y rattache si son montant est à ±INCOME_TOLERANCE près.
 * - Les revenus du cycle sont ceux des réglages (montants prévus, stables). Une opération de revenu
 *   qui ne correspond à aucune ligne est « exceptionnelle » : neutre tant qu'elle n'est pas affectée.
 *   Sans aucune ligne de revenu configurée, les revenus réellement reçus dans le cycle servent de base.
 * - Remboursement rattaché à une dépense : il réduit cette dépense, à la date de la dépense.
 * - Premier cycle partiel (aucune opération connue avant `dataStart`) : l'enveloppe est réduite au
 *   prorata des jours couverts, sinon les jours sans données feraient croire à des économies.
 * - Enveloppe dépassée : budget du jour = 0 (jamais négatif), avec le déficit ; le maximum à dépenser
 *   par jour sans aggraver le déficit est donc 0 €. Le déficit n'est pas reporté sur le cycle suivant.
 * - Plafond réel : si le solde des comptes courants est connu, le reste disponible ne dépasse jamais
 *   ce solde moins les charges fixes pas encore débitées et l'épargne pas encore versée (ce qui est
 *   « réellement libre »). Sans solde connu, seule l'enveloppe compte.
 * - Projection : rythme = dépenses variables des jours écoulés (hors aujourd'hui, journée en cours)
 *   ÷ jours écoulés.
 *
 * Un seul modèle d'argent (refonte de MyFinances, étape 2) : tous les écrans lisent ce module.
 * - Épargne du cycle (`cycleSavings`) : prévue = réglages (montant fixe, ou plans et objectifs) ; versée = opérations
 *   classées « Épargne & investissement » du cycle. L'enveloppe retire le plus grand des deux : on ne dépense pas
 *   l'argent prévu pour l'épargne, et ce qui a été versé en plus est bien sorti. « C'est tout pour ce cycle »
 *   (`savingsClosed`) : seul le versé compte, rien n'est plus réservé (un achat occasionnel sauté ce mois).
 * - Charges fixes des réglages pas encore débitées : toujours réservées sur l'argent réel, même sans jour de
 *   prélèvement (« d'ici la paie »), sauf si la prévision les compte déjà.
 * - Enveloppe dépassée mais argent réellement libre : l'enveloppe reste le repère (budget du jour à 0 €), mais ce
 *   n'est pas un déficit (`overrun.covered`) : état « presque », jamais rouge.
 * - Argent déjà sur les comptes au début du cycle (`cash.atStart`) : il explique un argent libre plus haut que l'enveloppe.
 */

export type CatMap = Map<string, Category>;
export type ExceptionalAllocation = 'envelope' | 'savings';
export type Allocations = Readonly<Record<string, ExceptionalAllocation>>;

export const EARLY_PAY_DAYS = 7;
export const INCOME_TOLERANCE = 0.25;
/** Une charge fixe est « débitée » par une opération à ±20 % de son montant (ou dont le libellé la cite). */
export const CHARGE_TOLERANCE = 0.2;

export type BudgetStatus = 'good' | 'warn' | 'bad';

export interface BudgetInput {
  txs: readonly Transaction[];
  cats: CatMap;
  settings: Settings;
  today: ISODate;
  /** Affectation des revenus exceptionnels (id d'opération → choix). */
  allocations?: Allocations;
  /** Date de la plus ancienne opération connue (premier cycle partiel). */
  dataStart?: ISODate | null;
  /** Solde actuel des comptes courants, pour « réellement libre ». */
  balance?: number | null;
  /**
   * Sorties d'argent déjà engagées d'ici la fin du cycle (après aujourd'hui) : prélèvements récurrents
   * détectés dans l'historique, charges des réglages non détectées, investissements programmés.
   * Fournies : elles remplacent l'estimation à partir des seules lignes de charges des réglages.
   */
  upcoming?: readonly UpcomingOutflow[] | null;
  /** Cycles (date de début) déclarés complets pour l'épargne : « c'est tout pour ce cycle ». */
  savingsClosed?: SavingsClosed;
  /** Comptes du quotidien (ceux du solde) : pour retrouver l'argent qu'ils contenaient au début du cycle. */
  cashAccounts?: ReadonlySet<string> | null;
  /** Récurrents sautés, par cycle (« sauter ce mois ») : ni dans l'enveloppe, ni réservés. */
  recurringSkips?: RecurringSkips;
}

export type SavingsClosed = Readonly<Record<string, true>>;

export interface CycleSavings {
  /** Prévu pour un cycle : montant fixe des réglages, ou plans et objectifs. */
  planned: number;
  /** Déjà versé ce cycle (opérations classées Épargne & investissement). */
  done: number;
  /** « C'est tout pour ce cycle » : seul le versé compte. */
  closed: boolean;
  /** Ce que l'enveloppe retire. */
  counted: number;
  /** Encore à verser d'ici la paie. */
  left: number;
  /** L'épargne prévue a été versée. */
  kept: boolean;
}

export interface UpcomingOutflow {
  date: ISODate;
  label: string;
  /** Centimes positifs. */
  amount: number;
  /** Investissement / épargne (plan programmé, versement récurrent vers l'épargne). */
  savings?: boolean;
  /** Charge des réglages sans jour (ou pas encore vue) : réservée « d'ici la paie ». */
  undated?: boolean;
}

export interface ResolvedCycle extends Cycle {
  /** Cycle ouvert par une paie arrivée avant le jour prévu (nombre de jours d'avance). */
  earlyBy: number;
  /** Date de la paie qui a ouvert le cycle, si elle est connue. */
  payDate: ISODate | null;
}

export interface ExceptionalIncome {
  tx: Transaction;
  allocation: ExceptionalAllocation | null;
}

export interface ChargeStatus {
  line: BudgetLine;
  /** Opération qui l'a débitée dans ce cycle, ou null : encore réservée. */
  paidBy: Transaction | null;
}

export interface BudgetState {
  today: ISODate;
  cycle: ResolvedCycle;
  length: number;
  envelope: {
    /** Revenus prévus (réglages), y compris ceux versés directement à un tiers. */
    income: number;
    /** Base utilisée : réglages, ou revenus reçus si aucune ligne n'est configurée. */
    incomeSource: 'settings' | 'received' | 'override';
    fixed: number;
    /** Épargne retirée de l'enveloppe (`savingsDetail.counted`). */
    savings: number;
    savingsDetail: CycleSavings;
    /** Revenus exceptionnels affectés au budget de ce cycle. */
    exceptional: number;
    /** Part du cycle couverte par les données (1 = complet). */
    coverage: number;
    total: number;
  };
  exceptional: ExceptionalIncome[];
  /** Montant des revenus exceptionnels pas encore affectés. */
  unallocated: number;
  spentBefore: number;
  spentToday: number;
  daysLeft: number;
  daysElapsed: number;
  /** Reste avant aujourd'hui, peut être négatif : le plus petit de l'enveloppe et de l'argent réellement libre. */
  available: number;
  /** Enveloppe − dépenses variables jusqu'à hier. */
  fromEnvelope: number;
  /** Ce qui limite le budget : l'enveloppe, ou le solde réel des comptes (plus bas). */
  limitedBy: 'envelope' | 'cash';
  /** Budget du jour, fixe toute la journée ; jamais négatif. */
  dailyBudget: number;
  remainingToday: number;
  remainingCycle: number;
  /** Budget par jour des jours suivants si on ne dépense plus rien aujourd'hui (≥ 0). */
  nextDailyBudget: number;
  /**
   * Enveloppe dépassée. `covered` : l'argent réellement libre couvre le dépassement (ce qu'il en reste) ; ce n'est
   * alors pas un déficit, juste l'enveloppe du cycle dépassée.
   */
  overrun: { deficit: number; maxPerDay: number; covered: number | null } | null;
  usedPercent: number;
  status: BudgetStatus;
  projection: {
    /** Dépense variable moyenne par jour écoulé. */
    pace: number;
    projectedSpend: number;
    /** Position de fin de cycle à ce rythme (négatif = dépassement). */
    projectedEnd: number;
    /** Dépense idéale jusqu'à aujourd'hui inclus (enveloppe répartie uniformément). */
    ideal: number;
    /** Idéal − dépensé : positif = en avance sur la trajectoire. */
    gap: number;
  };
  charges: ChargeStatus[];
  /** Sorties à venir prises en compte dans « réellement libre » (détectées), si connues. */
  upcoming: UpcomingOutflow[];
  reservedCharges: number;
  reservedSavings: number;
  /** Solde − charges et épargne encore à venir, si le solde est connu. */
  realFree: number | null;
  /** Comptes du quotidien : solde actuel, et ce qu'ils contenaient au début du cycle (si on peut le retrouver). */
  cash: { balance: number; atStart: number | null } | null;
}

// ---------------------------------------------------------------- ce qui compte

/** Une opération consomme-t-elle l'enveloppe ? (non classée = oui si c'est un débit) */
export function isVariable(tx: Pick<Transaction, 'categoryId' | 'amount'>, cats: CatMap): boolean {
  if (tx.categoryId === null) return tx.amount < 0;
  return cats.get(tx.categoryId)?.kind === 'variable';
}

const isIncomeTx = (t: Transaction, cats: CatMap) => t.amount > 0 && t.categoryId !== null && cats.get(t.categoryId)?.kind === 'income' && !t.refundOf;

/** Remboursements rattachés : id de la dépense → total remboursé (centimes positifs). */
export function refundMap(txs: readonly Transaction[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of txs) if (t.refundOf && t.amount > 0) m.set(t.refundOf, (m.get(t.refundOf) ?? 0) + t.amount);
  return m;
}

/**
 * Dépense variable d'une opération (positive), remboursements rattachés déduits.
 * Un remboursement rattaché ne compte pas lui-même (il est déduit de sa dépense).
 */
export function variableSpend(t: Transaction, cats: CatMap, refunds: ReadonlyMap<string, number>): number {
  if (t.refundOf) return 0;
  if (!isVariable(t, cats)) return 0;
  return -t.amount - (refunds.get(t.id) ?? 0);
}

// ---------------------------------------------------------------- cycle

const regularLines = (s: Pick<Settings, 'incomes'>) => s.incomes.filter((l) => !l.direct && l.amount > 0);
const near = (amount: number, target: number, tol: number) => Math.abs(amount - target) <= target * tol;

/** Dates des paies reçues (opérations de revenu au montant de la plus grosse ligne de revenu). */
export function payDates(txs: readonly Transaction[], cats: CatMap, settings: Pick<Settings, 'incomes'>): ISODate[] {
  const lines = regularLines(settings);
  if (!lines.length) return [];
  const salary = lines.reduce((a, b) => (b.amount > a.amount ? b : a));
  return [...new Set(txs.filter((t) => isIncomeTx(t, cats) && near(t.amount, salary.amount, INCOME_TOLERANCE)).map((t) => t.date))].sort();
}

/** Début réel d'un cycle prévu le `nominal` : la première paie arrivée dans les jours qui précèdent. */
function actualStart(nominal: ISODate, pays: readonly ISODate[]): ISODate {
  const from = addDays(nominal, -EARLY_PAY_DAYS);
  return pays.find((d) => d >= from && d <= nominal) ?? nominal;
}

/** Cycle (de paie à paie) contenant `date`, ajusté aux paies arrivées en avance. */
export function resolveCycle(date: ISODate, payday: number, pays: readonly ISODate[]): ResolvedCycle {
  const nominal = cycleFor(date, payday);
  const nextNominal = addDays(nominal.end, 1);
  const start = actualStart(nominal.start, pays);
  const nextStart = actualStart(nextNominal, pays);
  if (date >= nextStart) {
    // La paie du cycle suivant est déjà arrivée : il a commencé.
    const after = addDays(cycleFor(nextNominal, payday).end, 1);
    return { start: nextStart, end: addDays(actualStart(after, pays), -1), earlyBy: diffDays(nextStart, nextNominal), payDate: pays.includes(nextStart) ? nextStart : null };
  }
  return { start, end: addDays(nextStart, -1), earlyBy: diffDays(start, nominal.start), payDate: pays.includes(start) ? start : null };
}

// ---------------------------------------------------------------- revenus, charges

/** Revenus du cycle : les rattachés aux lignes prévues, et les exceptionnels (le reste). */
export function splitIncomes(txs: readonly Transaction[], cats: CatMap, settings: Pick<Settings, 'incomes'>): { regular: Transaction[]; exceptional: Transaction[] } {
  const incomes = txs.filter((t) => isIncomeTx(t, cats)).sort((a, b) => (a.date < b.date ? -1 : 1));
  const lines = regularLines(settings);
  if (!lines.length) return { regular: incomes, exceptional: [] };
  const regular = new Set<Transaction>();
  // Chaque ligne prend au plus une opération : la plus proche de son montant.
  for (const line of [...lines].sort((a, b) => b.amount - a.amount)) {
    const candidates = incomes.filter((t) => !regular.has(t) && near(t.amount, line.amount, INCOME_TOLERANCE));
    const best = candidates.sort((a, b) => Math.abs(a.amount - line.amount) - Math.abs(b.amount - line.amount))[0];
    if (best) regular.add(best);
  }
  return { regular: incomes.filter((t) => regular.has(t)), exceptional: incomes.filter((t) => !regular.has(t)) };
}

/** Charges fixes : débitées dans le cycle, ou encore réservées. */
export function chargeStatuses(lines: readonly BudgetLine[], cycleTxs: readonly Transaction[], cats: CatMap): ChargeStatus[] {
  const used = new Set<string>();
  const debits = cycleTxs.filter((t) => t.amount < 0 && (t.categoryId === null || cats.get(t.categoryId)?.kind === 'fixed'));
  return lines.map((line) => {
    const words = significantWords(line.label);
    const text = (t: Transaction) => normalizeText(`${t.label} ${t.rawText}`);
    const paidBy =
      debits.find((t) => !used.has(t.id) && words.some((w) => text(t).includes(w))) ?? debits.find((t) => !used.has(t.id) && t.categoryId !== null && near(-t.amount, line.amount, CHARGE_TOLERANCE)) ?? null;
    if (paidBy) used.add(paidBy.id);
    return { line, paidBy };
  });
}

// ---------------------------------------------------------------- état du budget

export function statusFor(spentToday: number, dailyBudget: number): BudgetStatus {
  if (dailyBudget <= 0) return spentToday > 0 ? 'bad' : 'warn';
  if (spentToday * 100 <= dailyBudget * 75) return 'good';
  if (spentToday <= dailyBudget) return 'warn';
  return 'bad';
}

/** Cycle courant (paies en avance comprises) pour une liste d'opérations. */
export function currentCycle(input: Pick<BudgetInput, 'txs' | 'cats' | 'settings' | 'today'>): ResolvedCycle {
  return resolveCycle(input.today, input.settings.payday, payDates(input.txs, input.cats, input.settings));
}

/** Épargne d'un cycle : prévue, versée, ce que l'enveloppe en retire et ce qui reste à verser. */
export function cycleSavings(input: Pick<BudgetInput, 'txs' | 'settings' | 'savingsClosed' | 'recurringSkips'>, cycle: Cycle): CycleSavings {
  // Un investissement sauté ce mois (« sauter ce mois ») n'est pas attendu ce cycle.
  const planned = Math.max(0, plannedSavings(input.settings) - skippedAmounts(input.recurringSkips, cycle.start).savings);
  const done = input.txs.filter((t) => t.date >= cycle.start && t.date <= cycle.end && t.amount < 0 && t.categoryId === CAT.epargne).reduce((s, t) => s - t.amount, 0);
  const closed = input.savingsClosed?.[cycle.start] === true;
  const counted = closed ? done : Math.max(planned, done);
  return { planned, done, closed, counted, left: Math.max(0, counted - done), kept: planned > 0 && done >= planned };
}

/** Enveloppe d'un cycle (revenus − charges − épargne + exceptionnels affectés, au prorata si partiel). */
export function cycleEnvelope(input: Pick<BudgetInput, 'txs' | 'cats' | 'settings' | 'allocations' | 'dataStart' | 'savingsClosed' | 'recurringSkips'>, cycle: Cycle): BudgetState['envelope'] & { exceptionalList: ExceptionalIncome[] } {
  const { settings, cats } = input;
  const inCycle = input.txs.filter((t) => t.date >= cycle.start && t.date <= cycle.end);
  const { regular, exceptional } = splitIncomes(inCycle, cats, settings);
  const allocations = input.allocations ?? {};
  const fixed = Math.max(0, totalFixed(settings) - skippedAmounts(input.recurringSkips, cycle.start).lineCharges);
  const savingsDetail = cycleSavings(input, cycle);
  const savings = savingsDetail.counted;
  const configured = settings.incomes.reduce((s, l) => s + l.amount, 0);
  const hasLines = regularLines(settings).length > 0 || settings.incomes.some((l) => l.direct && l.amount > 0);
  const incomeSource: BudgetState['envelope']['incomeSource'] = settings.envelopeOverride !== null ? 'override' : hasLines ? 'settings' : 'received';
  const income = incomeSource === 'received' ? regular.reduce((s, t) => s + t.amount, 0) : configured;
  const base = incomeSource === 'override' ? settings.envelopeOverride! : income - fixed - savings;

  const length = cycleLength(cycle);
  const covered = input.dataStart && input.dataStart > cycle.start ? Math.max(0, diffDays(input.dataStart, cycle.end) + 1) : length;
  const coverage = Math.min(1, covered / length);
  const exceptionalList = exceptional.map((tx) => ({ tx, allocation: allocations[tx.id] ?? null }));
  const toEnvelope = exceptionalList.filter((e) => e.allocation === 'envelope').reduce((s, e) => s + e.tx.amount, 0);
  const total = Math.round(base * coverage) + toEnvelope;
  return { income, incomeSource, fixed, savings, savingsDetail, exceptional: toEnvelope, coverage, total, exceptionalList };
}

export function computeBudget(input: BudgetInput): BudgetState {
  const { txs, cats, settings, today } = input;
  const cycle = currentCycle(input);
  const length = cycleLength(cycle);
  const inCycle = txs.filter((t) => t.date >= cycle.start && t.date <= cycle.end);
  const env = cycleEnvelope(input, cycle);
  const { exceptionalList, ...envelope } = env;
  const refunds = refundMap(txs);

  let spentBefore = 0;
  let spentToday = 0;
  for (const t of inCycle) {
    const v = variableSpend(t, cats, refunds);
    if (t.date < today) spentBefore += v;
    else if (t.date === today) spentToday += v;
  }

  const charges = chargeStatuses(settings.fixedCharges, inCycle, cats);
  const sv = envelope.savingsDetail;
  // Cycle déclaré complet pour l'épargne : plus aucun versement n'est attendu d'ici la paie.
  const upcoming = (input.upcoming ?? []).filter((u) => u.date > today && u.date <= cycle.end && u.amount > 0 && !(sv.closed && u.savings));
  // Une charge des réglages pas encore débitée est réservée, même sans jour de prélèvement, sauf si la
  // prévision la compte déjà (même montant à 20 % près, ou libellé qui la cite).
  const skippedLines = skippedAmounts(input.recurringSkips, cycle.start).lineIds;
  for (const c of charges) {
    if (c.paidBy || skippedLines.has(c.line.id)) continue;
    const seen = upcoming.some((u) => !u.savings && sameFlow({ amount: c.line.amount, label: c.line.label }, { amount: u.amount, label: u.label }));
    if (!seen) upcoming.push({ date: cycle.end, label: c.line.label, amount: c.line.amount, undated: true });
  }
  const reservedCharges = upcoming.filter((u) => !u.savings).reduce((s, u) => s + u.amount, 0);
  // Épargne : les versements prévus d'ici la paie, ou au moins ce qui reste à verser pour tenir le prévu.
  const plannedAhead = upcoming.filter((u) => u.savings).reduce((s, u) => s + u.amount, 0);
  const reservedSavings = sv.closed ? 0 : Math.max(plannedAhead, sv.left);
  const realFree = input.balance == null ? null : input.balance - reservedCharges - reservedSavings;
  const cashMoved = input.cashAccounts ? inCycle.filter((t) => t.date <= today && input.cashAccounts!.has(t.accountId)).reduce((s, t) => s + t.amount, 0) : null;
  const cash = input.balance == null ? null : { balance: input.balance, atStart: cashMoved === null ? null : input.balance - cashMoved };

  const daysLeft = Math.max(1, diffDays(today, cycle.end) + 1);
  const daysElapsed = Math.max(0, diffDays(cycle.start, today));
  // Le budget ne promet jamais plus que l'argent réellement libre : le solde (qui inclut déjà les
  // dépenses du jour, d'où leur réintégration) moins les charges et l'épargne encore à venir.
  const fromEnvelope = envelope.total - spentBefore;
  const fromCash = realFree === null ? null : realFree + spentToday;
  const limitedBy: 'envelope' | 'cash' = fromCash !== null && fromCash < fromEnvelope ? 'cash' : 'envelope';
  const available = limitedBy === 'cash' ? fromCash! : fromEnvelope;
  const dailyBudget = available > 0 ? Math.floor(available / daysLeft) : 0;
  const remainingCycle = available - spentToday;
  const nextDailyBudget = daysLeft > 1 ? Math.max(0, Math.floor(remainingCycle / (daysLeft - 1))) : 0;
  const deficit = Math.max(0, -remainingCycle);
  // L'enveloppe est dépassée mais l'argent réellement libre (après les dépenses du jour) reste positif.
  const covered = deficit > 0 && limitedBy === 'envelope' && realFree !== null && realFree > 0 ? realFree : null;

  const pace = daysElapsed > 0 ? Math.round(spentBefore / daysElapsed) : 0;
  const projectedSpend = spentBefore + Math.max(spentToday, pace) + pace * (daysLeft - 1);
  const ideal = Math.round((envelope.total * (daysElapsed + 1)) / length);

  return {
    today,
    cycle,
    length,
    envelope,
    exceptional: exceptionalList,
    unallocated: exceptionalList.filter((e) => e.allocation === null).reduce((s, e) => s + e.tx.amount, 0),
    spentBefore,
    spentToday,
    daysLeft,
    daysElapsed,
    available,
    fromEnvelope,
    limitedBy,
    dailyBudget,
    remainingToday: dailyBudget - spentToday,
    remainingCycle,
    nextDailyBudget,
    overrun: deficit > 0 ? { deficit, maxPerDay: 0, covered } : null,
    usedPercent: dailyBudget > 0 ? Math.round((spentToday * 100) / dailyBudget) : spentToday > 0 || available <= 0 ? 100 : 0,
    status: covered !== null ? 'warn' : deficit > 0 || (available <= 0 && spentToday > 0) ? 'bad' : statusFor(spentToday, dailyBudget),
    projection: { pace, projectedSpend, projectedEnd: available + spentBefore - projectedSpend, ideal, gap: ideal - (spentBefore + spentToday) },
    charges,
    upcoming,
    reservedCharges,
    reservedSavings,
    realFree,
    cash,
  };
}

export interface DayPoint {
  date: ISODate;
  spent: number;
  cumulative: number;
  ideal: number;
  /** Budget du jour tel qu'il était calculé ce jour-là (≥ 0). */
  budget: number;
}

/** Série jour par jour d'un cycle (jusqu'à `until` inclus), même règle que le budget du jour. */
export function daySeries(txs: readonly Transaction[], cats: CatMap, cycle: Cycle, envelope: number, until: ISODate = cycle.end): DayPoint[] {
  const refunds = refundMap(txs);
  const byDay = new Map<string, number>();
  for (const t of txs) {
    if (t.date < cycle.start || t.date > cycle.end) continue;
    const v = variableSpend(t, cats, refunds);
    if (v) byDay.set(t.date, (byDay.get(t.date) ?? 0) + v);
  }
  const length = cycleLength(cycle);
  const last = until < cycle.end ? until : cycle.end;
  const points: DayPoint[] = [];
  let cumulative = 0;
  for (let date = cycle.start, index = 0; date <= last; date = addDays(date, 1), index++) {
    const left = length - index;
    const budget = Math.max(0, Math.floor((envelope - cumulative) / left));
    const day = byDay.get(date) ?? 0;
    cumulative += day;
    points.push({ date, spent: day, cumulative, ideal: Math.round((envelope * (index + 1)) / length), budget });
  }
  return points;
}
