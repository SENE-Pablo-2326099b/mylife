import { daysRemaining, inRange, type Cycle, type ISODate } from '../core/dates';
import { buildOccurrences, currentCycle, type Occurrence } from './occurrences';
import type { Account, Allocation, Db, Envelope, Transaction } from './schema';

/**
 * Le moteur : de l'état (`Db`) et du jour au budget, terme par terme. Fonctions pures.
 *
 *   RAV            = Revenus − Charges − Épargne + Report
 *   Pot            = RAV − budgets des enveloppes hors quotidien
 *   Reste_enveloppe = Pot − Dépensé
 *   Cash_libre     = soldes du quotidien − poches − échéances à payer (hors part en poche) − différé − reste hors quotidien
 *   Disponible     = min(Reste_enveloppe, Cash_libre)   (mode prudent ; la trésorerie seule en mode cash)
 *   Budget_jour    = max(0, Disponible à minuit ÷ jours restants), gelé pour la journée
 *
 * Tout est rendu dans une `Explanation` : l'écran « pourquoi ce chiffre » n'a rien à recalculer.
 */

const rate = (db: Db, a: Account) => (a.currency === db.settings.referenceCurrency ? 1 : (db.fx[a.currency] ?? 1));
/** Un montant du compte, ramené à ta part et à la devise de référence. */
const own = (db: Db, a: Account, amount: number) => Math.round(amount * a.ownershipRatio * rate(db, a));

/** Suit les fusions : l'historique d'une catégorie fusionnée se lit comme celui de sa cible. */
export function resolveCategory(db: Db, id: string | null): string | null {
  const c = id ? db.categories.find((x) => x.id === id) : undefined;
  return c?.mergedIntoId ?? id;
}

/** L'enveloppe d'une catégorie : la sienne, sinon celle de sa parente, sinon l'enveloppe par défaut. */
export function envelopeOf(db: Db, categoryId: string | null): Envelope {
  const fallback = db.envelopes.find((e) => e.isDefault) ?? db.envelopes[0]!;
  const id = resolveCategory(db, categoryId);
  if (!id) return fallback;
  const parent = db.categories.find((c) => c.id === id)?.parentId ?? null;
  return db.envelopes.find((e) => e.categoryIds.includes(id)) ?? (parent ? db.envelopes.find((e) => e.categoryIds.includes(parent)) : undefined) ?? fallback;
}

/**
 * Ce qu'une ligne pèse dans le budget (positif : elle le consomme ; négatif : elle le rend).
 * `settled` : les opérations qui règlent une échéance prévue (elles sont déjà dans les charges).
 */
export function weight(a: Allocation, settled: ReadonlySet<string>): number {
  const expense = a.flow === 'EXPENSE' || (a.flow === null && a.amount < 0);
  if (expense) {
    if (a.fundedBySavings || a.installmentPurchaseOf || settled.has(a.transactionId)) return 0;
    return -a.amount - (a.receivableAmount ?? 0);
  }
  if (a.flow === 'REFUND') {
    if (a.settlesReceivableId) return 0;
    // Sans dépense ni catégorie rattachée (quelqu'un qui rend de l'argent hors créance suivie) : neutre.
    return a.linkedTransactionId || a.categoryId ? -a.amount : 0;
  }
  return 0;
}

export interface EnvelopeState {
  envelope: Envelope;
  /** Plafond + report ; null : pas de plafond. */
  budget: number | null;
  spent: number;
  /** max(0, budget − dépensé) ; 0 sans plafond. Un dépassement n'ajoute jamais d'argent ailleurs. */
  remaining: number;
}

export interface Explanation {
  today: ISODate;
  cycle: Cycle;
  daysLeft: number;
  occurrences: Occurrence[];
  // ---- budget théorique
  revenus: number;
  charges: number;
  epargne: number;
  report: number;
  rav: number;
  /** Budgets des enveloppes hors quotidien plafonnées, retirés du pot. */
  reserve: number;
  /** Payé dans les enveloppes hors quotidien sans plafond (charges réglées sans être au plan), retiré du pot. */
  offPlanPaid: number;
  pot: number;
  /** Dépensé dans les enveloppes du quotidien, aujourd'hui compris. */
  spent: number;
  spentToday: number;
  /** Dépenses d'aujourd'hui lissées sur le reste du cycle. */
  smoothedToday: number;
  resteEnveloppe: number;
  envelopes: EnvelopeState[];
  // ---- trésorerie réelle
  cash: number;
  locked: number;
  /** Échéances encore à payer d'ici la fin du cycle, hors part déjà en poche. */
  toPay: number;
  /** La part des échéances couverte par une poche liée (déduite une seule fois, dans `locked`). */
  covered: number;
  deferred: number;
  /** Reste des enveloppes hors quotidien : leur argent n'est pas pour le quotidien. */
  offDaily: number;
  cashLibre: number;
  // ---- résultat
  mode: 'PRUDENT' | 'CASH';
  /** Disponible à minuit (les dépenses ordinaires du jour non comptées). */
  disponible: number;
  limitedBy: 'budget' | 'cash';
  /** Trésorerie libre au-delà du budget (positif), à minuit. */
  marge: number;
  budgetJour: number;
  resteAujourdhui: number;
  demain: number;
  deficit: number;
  // ---- à regarder
  /** Revenus non prévus qui attendent une décision (budget ou épargne). */
  pendingIncomes: { transactionId: string; amount: number }[];
  /** Comptes du quotidien sans solde connu : la trésorerie est sous-estimée. */
  unknownBalances: string[];
  /** Aucun revenu prévu : les revenus reçus dans le cycle servent de base. */
  incomeFallback: boolean;
}

export function compute(db: Db, today: ISODate): Explanation {
  const cycle = currentCycle(db, today);
  const occurrences = buildOccurrences(db, cycle);
  const settled = new Set(occurrences.flatMap((o) => o.transactionIds));
  const accounts = new Map(db.accounts.map((a) => [a.id, a]));
  const txById = new Map(db.transactions.map((t) => [t.id, t]));
  const live = (t: Transaction | undefined): t is Transaction => !!t && !accounts.get(t.accountId)?.archivedAt;
  const inCycle = db.allocations.flatMap((a) => {
    const t = txById.get(a.transactionId);
    return live(t) && inRange(t.date, cycle.start, today) ? [{ a, t, account: accounts.get(t.accountId)! }] : [];
  });

  // ---- budget théorique
  // Réglée : le montant réel. Due ou en partie versée : le prévu (ou le versé, s'il le dépasse). Sautée : rien.
  const amountOf = (o: Occurrence) => (o.status === 'SKIPPED' ? 0 : o.status === 'PAID' ? (o.actual ?? o.expected) : Math.max(o.expected, o.paid));
  const sum = (kinds: string[]) => occurrences.filter((o) => kinds.includes(o.commitment.kind)).reduce((s, o) => s + amountOf(o), 0);
  const hasIncomePlan = db.commitments.some((c) => c.kind === 'INCOME' && !c.paused);
  const extraIncomes = inCycle.filter(({ a, t }) => a.flow === 'INCOME' && !settled.has(t.id));
  const pendingIncomes = hasIncomePlan ? extraIncomes.filter(({ a }) => !a.incomeUse).map(({ a, t }) => ({ transactionId: t.id, amount: a.amount })) : [];
  const revenus = sum(['INCOME']) + extraIncomes.filter(({ a }) => (hasIncomePlan ? a.incomeUse === 'BUDGET' : a.incomeUse !== 'SAVINGS')).reduce((s, { a, account }) => s + own(db, account, a.amount), 0);
  const charges = sum(['CHARGE', 'INSTALLMENT']);
  const savedActual = inCycle.filter(({ a }) => a.flow === 'SAVING' && a.amount < 0).reduce((s, { a, account }) => s + own(db, account, -a.amount), 0);
  const epargne = Math.max(sum(['SAVING']), savedActual);
  const report = db.carryIn.global;
  const rav = revenus - charges - epargne + report;

  // ---- enveloppes
  const spentBy = new Map<string, number>();
  let spent = 0;
  let spentToday = 0;
  let smoothedToday = 0;
  let cashOutToday = 0;
  for (const { a, t, account } of inCycle) {
    const w = own(db, account, weight(a, settled));
    if (w === 0) continue;
    const env = envelopeOf(db, a.categoryId);
    spentBy.set(env.id, (spentBy.get(env.id) ?? 0) + w);
    if (!env.inDailyBudget) continue;
    spent += w;
    if (t.date !== today) continue;
    if (a.smoothed) smoothedToday += w;
    else {
      spentToday += w;
      if (account.includeInDailyCash) cashOutToday += w;
    }
  }
  const envelopes: EnvelopeState[] = [...db.envelopes]
    .sort((a, b) => a.order - b.order)
    .map((envelope) => {
      const budget = envelope.cap === null ? null : envelope.cap + (db.carryIn.envelopes[envelope.id] ?? 0);
      const used = spentBy.get(envelope.id) ?? 0;
      return { envelope, budget, spent: used, remaining: budget === null ? 0 : Math.max(0, budget - used) };
    });
  // Hors quotidien : une enveloppe plafonnée met son budget à part ; une enveloppe sans plafond (des charges fixes
  // payées sans être au plan) met à part ce qui y a été payé. Dans les deux cas, cet argent n'est pas pour le quotidien.
  const offDailyEnvelopes = envelopes.filter((e) => !e.envelope.inDailyBudget && e.budget !== null);
  const offPlanPaid = envelopes.filter((e) => !e.envelope.inDailyBudget && e.budget === null).reduce((s, e) => s + Math.max(0, e.spent), 0);
  const reserve = offDailyEnvelopes.reduce((s, e) => s + Math.max(0, e.budget!), 0);
  const pot = rav - reserve - offPlanPaid;
  const resteEnveloppe = pot - spent;

  // ---- trésorerie réelle
  const daily = db.accounts.filter((a) => a.includeInDailyCash && !a.archivedAt);
  const dailyIds = new Set(daily.map((a) => a.id));
  const cash = daily.reduce((s, a) => s + own(db, a, a.balance ?? 0), 0);
  const unknownBalances = daily.filter((a) => a.balance === null).map((a) => a.name);
  // Un compte de provision compté dans le quotidien est verrouillé en entier ; ses poches n'y ajoutent rien.
  const wholeLocked = new Set(daily.filter((a) => a.role === 'PROVISION').map((a) => a.id));
  const pockets = db.provisions.filter((p) => p.status === 'ACTIVE' && dailyIds.has(p.accountId));
  const locked = daily.filter((a) => wholeLocked.has(a.id)).reduce((s, a) => s + own(db, a, a.balance ?? 0), 0) + pockets.filter((p) => !wholeLocked.has(p.accountId)).reduce((s, p) => s + own(db, accounts.get(p.accountId)!, p.amount), 0);
  // Ce qu'il reste à payer depuis le quotidien d'ici la fin du cycle. Une poche liée couvre ses échéances, dans
  // l'ordre des dates : cette part est déjà dans « verrouillé », elle n'est pas retirée une seconde fois.
  const due = occurrences.filter((o) => (o.status === 'DUE' || o.status === 'PARTIAL') && o.commitment.kind !== 'INCOME' && (!o.commitment.accountId || dailyIds.has(o.commitment.accountId)));
  const left = new Map(pockets.map((p) => [p.id, own(db, accounts.get(p.accountId)!, p.amount)]));
  let toPay = 0;
  let covered = 0;
  for (const o of due) {
    // Ce qui est déjà versé est déjà sorti du solde : seul le reste est encore à payer.
    let need = o.remaining;
    for (const p of pockets) {
      const linked = (p.commitmentId && p.commitmentId === o.commitment.id) || (p.installmentPlanId && p.installmentPlanId === o.commitment.installmentPlanId);
      if (!linked || need === 0) continue;
      const take = Math.min(need, left.get(p.id) ?? 0);
      left.set(p.id, (left.get(p.id) ?? 0) - take);
      need -= take;
      covered += take;
    }
    toPay += need;
  }
  const deferred = 0; // Carte à débit différé : étape M3.
  const offDaily = offDailyEnvelopes.reduce((s, e) => s + e.remaining, 0);
  const cashLibre = cash - locked - toPay - deferred - offDaily;

  // ---- disponible et budget du jour (à minuit : les dépenses ordinaires d'aujourd'hui ne sont pas encore comptées)
  const mode = db.settings.mode;
  const budgetMinuit = resteEnveloppe + spentToday;
  const cashMinuit = cashLibre + cashOutToday;
  const limitedBy = mode === 'CASH' || cashMinuit < budgetMinuit ? 'cash' : 'budget';
  const disponible = limitedBy === 'cash' ? cashMinuit : budgetMinuit;
  const daysLeft = Math.max(1, daysRemaining(today, cycle));
  const budgetJour = Math.max(0, Math.round(disponible / daysLeft));

  return {
    today,
    cycle,
    daysLeft,
    occurrences,
    revenus,
    charges,
    epargne,
    report,
    rav,
    reserve,
    offPlanPaid,
    pot,
    spent,
    spentToday,
    smoothedToday,
    resteEnveloppe,
    envelopes,
    cash,
    locked,
    toPay,
    covered,
    deferred,
    offDaily,
    cashLibre,
    mode,
    disponible,
    limitedBy,
    marge: cashMinuit - budgetMinuit,
    budgetJour,
    resteAujourdhui: budgetJour - spentToday,
    demain: daysLeft > 1 ? Math.max(0, Math.round((disponible - spentToday) / (daysLeft - 1))) : 0,
    deficit: Math.max(0, -disponible),
    pendingIncomes,
    unknownBalances,
    incomeFallback: !hasIncomePlan,
  };
}

/** Patrimoine net : les comptes inclus (une dette en moins), plus les créances ouvertes, moins les échéances de paiements fractionnés restantes. */
export function netWorth(db: Db): { assets: number; debts: number; receivables: number; installments: number; net: number } {
  let assets = 0;
  let debts = 0;
  for (const a of db.accounts) {
    if (!a.includeInNetWorth || a.archivedAt) continue;
    const v = own(db, a, a.balance ?? 0);
    if (a.role === 'LIABILITY') debts += v;
    else assets += v;
  }
  const receivables = db.receivables.filter((r) => r.status === 'OPEN').reduce((s, r) => s + r.amount, 0);
  const installments = db.commitments.filter((c) => c.kind === 'INSTALLMENT' && !c.paused).reduce((s, c) => s + c.amount * (c.remainingOccurrences ?? 0), 0);
  return { assets, debts, receivables, installments, net: assets + receivables - debts - installments };
}
