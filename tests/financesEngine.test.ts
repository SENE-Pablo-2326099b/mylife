import { describe, expect, it } from 'vitest';
import { migrate } from '../app/src/modules/finances/core/migrate';
import { automate, classify, detectRecurring, pairTransfers, ruleMatches, toClassify } from '../app/src/modules/finances/engine/automation';
import { compute, debitDate, envelopeOf, netWorth, weight } from '../app/src/modules/finances/engine/engine';
import { byCategory, cashflow, forecast, lastCycles, pace, project, projectAccounts, settledIn, simulate, spendByDay, topMerchants } from '../app/src/modules/finances/engine/views';
import { fromV3 } from '../app/src/modules/finances/engine/fromV3';
import { checkIntegrity } from '../app/src/modules/finances/engine/integrity';
import { buildOccurrences, currentCycle, dueDates } from '../app/src/modules/finances/engine/occurrences';
import { addManual, removeManual, setSplit, acceptSuggestion, addAccount, archiveCategory, categoryUse, mergeCategories, removeCategory, patchSettings, removeTag, saveCategory, saveTag, addInstallmentPlan, addReceivable, applyState, classifyAllocation, classifyMerchant, closeCycle, ignoreSuggestion, initState, patchAccount, patchAllocation, removeInstallmentPlan, roll, saveCommitment, saveEnvelope, saveRule, settleReceivable, writeOffReceivable, type EngineState } from '../app/src/modules/finances/engine/state';
import { DEFAULT_SETTINGS, EMPTY_DB, roleDefaults, type Account, type Allocation, type Commitment, type Db, type Envelope, type Flow, type Role, type Rule, type Transaction } from '../app/src/modules/finances/engine/schema';

/** Le moteur financier de MyFinances V5 (étape M1) : scénario de référence, cas limites, invariants. */

const account = (id: string, role: Role, balance: number | null, over: Partial<Account> = {}): Account => ({ id, name: id, provider: '', role, ...roleDefaults(role), currency: 'EUR', ownershipRatio: 1, alertThreshold: null, deferredDebit: null, source: 'bank', balance, balanceAt: null, archivedAt: null, ...over });
const commitment = (id: string, kind: Commitment['kind'], label: string, amount: number, anchorDay: number | null, over: Partial<Commitment> = {}): Commitment => ({ id, kind, label, amount, tolerance: 0.2, rhythm: 'MONTHLY', anchorDay, anchorDate: null, accountId: null, counterAccountId: null, categoryId: null, startDate: null, endDate: null, remainingOccurrences: null, installmentPlanId: null, direct: false, paused: false, reserveInCash: null, provisionMonthly: false, ...over });
const envelope = (id: string, over: Partial<Envelope> = {}): Envelope => ({ id, name: id, cap: null, inDailyBudget: true, endPolicy: 'RESET', overspendPolicy: 'DEDUCT_NEXT', isDefault: false, order: 0, categoryIds: [], ...over });
const category = (id: string, parentId: string | null = null) => ({ id, parentId, scope: 'EXPENSE' as const, name: id, color: '#fff', order: 0, archivedAt: null, mergedIntoId: null });

/** Une transaction et sa ligne unique. */
function op(db: Db, id: string, accountId: string, date: string, amount: number, label: string, flow: Flow | null, over: Partial<Allocation> = {}): void {
  const t: Transaction = { id, accountId, date, valueDate: null, amount, rawLabel: label, pending: false, source: 'bank', merchantId: null, createdAt: 0 };
  db.transactions.push(t);
  db.allocations.push({ id: `${id}#0`, transactionId: id, amount, flow, categoryId: null, tagIds: [], origin: 'import', note: '', ...over });
}
const blank = (over: Partial<Db> = {}): Db => ({ ...structuredClone(EMPTY_DB), ...over });

/**
 * Le scénario de référence (montants fictifs). Deux comptes du quotidien : « paie » reçoit le salaire, paie les
 * charges et garde la réserve d'un paiement en 4 fois ; « carte » sert aux dépenses, alimenté par virements internes.
 * Cycle du 26 octobre au 25 novembre ; on est le 15 novembre (11 jours restants).
 */
function reference(): Db {
  const db = blank({
    accounts: [account('paie', 'CHECKING', 36100), account('carte', 'CHECKING', 15000), account('livret', 'SAVINGS', 200000)],
    commitments: [
      commitment('salaire', 'INCOME', 'Salaire', 140000, 26, { accountId: 'paie' }),
      commitment('loyer', 'CHARGE', 'Loyer', 40000, 28, { accountId: 'paie' }),
      commitment('tel', 'CHARGE', 'Forfait mobile', 2000, 20, { accountId: 'paie' }),
      commitment('alma', 'INSTALLMENT', 'Échéance 4x', 16100, 20, { accountId: 'paie', installmentPlanId: 'plan', remainingOccurrences: 2 }),
      commitment('epargne', 'SAVING', 'Livret', 10000, 27, { counterAccountId: 'livret' }),
    ],
    installmentPlans: [{ id: 'plan', label: 'Achat en 4 fois', total: 64400, count: 4, provider: '', purchaseTransactionId: null }],
    // La poche : les 161 € gardés sur le compte « paie » pour la prochaine échéance du 4x. Liée au plan.
    provisions: [{ id: 'poche', accountId: 'paie', label: 'Prochaine échéance 4x', amount: 16100, commitmentId: null, installmentPlanId: 'plan', goalId: null, status: 'ACTIVE' }],
    settings: { ...DEFAULT_SETTINGS, payday: 26, openingCommitmentId: 'salaire' },
  });
  op(db, 'paie1', 'paie', '2026-10-26', 140000, 'VIR EMPLOYEUR', 'INCOME');
  op(db, 'loyer1', 'paie', '2026-10-28', -40000, 'PRLV LOYER AGENCE', 'EXPENSE');
  op(db, 'ep1', 'paie', '2026-10-27', -10000, 'VIR LIVRET', 'SAVING', { linkedTransactionId: 'ep2' });
  op(db, 'ep2', 'livret', '2026-10-27', 10000, 'VIR RECU', 'TRANSFER', { linkedTransactionId: 'ep1' });
  op(db, 'v1', 'paie', '2026-10-27', -50000, 'VIR VERS CARTE', 'TRANSFER', { linkedTransactionId: 'v2' });
  op(db, 'v2', 'carte', '2026-10-27', 50000, 'VIR RECU', 'TRANSFER', { linkedTransactionId: 'v1' });
  op(db, 'd1', 'carte', '2026-11-03', -18000, 'SUPERMARCHE', 'EXPENSE');
  op(db, 'd2', 'carte', '2026-11-10', -12000, 'RESTAURANT', 'EXPENSE');
  op(db, 'd3', 'carte', '2026-11-15', -1200, 'BOULANGERIE', 'EXPENSE');
  return db;
}
const TODAY = '2026-11-15';

describe('moteur : scénario de référence', () => {
  const db = reference();
  const e = compute(db, TODAY);

  it('le schéma est intègre', () => {
    expect(checkIntegrity(db)).toEqual({ errors: [], warnings: [] });
  });

  it('cycle d’une paie à la suivante ; échéances rapprochées de leurs opérations', () => {
    expect(e.cycle).toEqual({ start: '2026-10-26', end: '2026-11-25' });
    expect(e.daysLeft).toBe(11);
    expect(e.occurrences.map((o) => [o.commitment.id, o.dueDate, o.status, o.transactionId])).toEqual([
      ['salaire', '2026-10-26', 'PAID', 'paie1'],
      ['epargne', '2026-10-27', 'PAID', 'ep1'],
      ['loyer', '2026-10-28', 'PAID', 'loyer1'],
      ['alma', '2026-11-20', 'DUE', null],
      ['tel', '2026-11-20', 'DUE', null],
    ]);
  });

  it('budget théorique : RAV = revenus − charges − épargne ; l’échéance du 4x pèse sur son cycle', () => {
    expect([e.revenus, e.charges, e.epargne, e.report]).toEqual([140000, 40000 + 2000 + 16100, 10000, 0]);
    expect(e.rav).toBe(71900);
    expect(e.pot).toBe(71900);
    // Le loyer règle une échéance : il ne pèse pas une seconde fois. Les virements internes pèsent 0.
    expect(e.spent).toBe(18000 + 12000 + 1200);
    expect(e.resteEnveloppe).toBe(71900 - 31200);
  });

  it('trésorerie : la poche de 161 € liée au 4x n’est déduite qu’une seule fois', () => {
    expect(e.cash).toBe(36100 + 15000);
    expect(e.locked).toBe(16100);
    // À payer : l'échéance du 4x (161 €) − la part déjà en poche (161 €). Le forfait (20 €), prélèvement récurrent,
    // n'est pas réservé : il ne touchera la trésorerie qu'à son débit réel.
    expect(e.covered).toBe(16100);
    expect(e.toPay).toBe(0);
    expect(e.cashLibre).toBe(51100 - 16100);
    // Réservé par choix sur cet engagement : il est alors déduit dès maintenant.
    const reserving = { ...db, commitments: db.commitments.map((c) => (c.id === 'tel' ? { ...c, reserveInCash: true } : c)) };
    expect(compute(reserving, TODAY)).toMatchObject({ toPay: 2000, cashLibre: 51100 - 16100 - 2000 });
    // Et l'inverse : avec « ne rien réserver » pour les paiements fractionnés, seule la poche reste verrouillée.
    const none = { ...db, settings: { ...db.settings, reserveDue: { CHARGE: false, INSTALLMENT: false, SAVING: false } } };
    expect(compute(none, TODAY)).toMatchObject({ toPay: 0, covered: 0, cashLibre: 51100 - 16100 });
    // Sans la poche : rien de verrouillé, l'échéance entière reste à payer. Même cash libre, au centime.
    expect(compute({ ...db, provisions: [] }, TODAY).cashLibre).toBe(e.cashLibre);
    // Une poche libre du même montant, elle, s'ajoute à l'échéance : 161 € de moins.
    const free = { ...db, provisions: [{ ...db.provisions[0]!, installmentPlanId: null }] };
    expect(compute(free, TODAY).cashLibre).toBe(e.cashLibre - 16100);
  });

  it('disponible = le plus petit du budget et de la trésorerie ; budget du jour gelé à minuit', () => {
    // À minuit : budget 71 900 − 30 000 = 41 900 ; trésorerie 35 000 + 1 200 dépensés depuis = 36 200.
    expect(e.limitedBy).toBe('cash');
    expect(e.disponible).toBe(36200);
    expect(e.marge).toBe(36200 - 41900);
    expect(e.budgetJour).toBe(Math.round(36200 / 11));
    expect(e.resteAujourdhui).toBe(e.budgetJour - 1200);
    expect(e.demain).toBe(Math.round((36200 - 1200) / 10));
    expect(e.deficit).toBe(0);
  });

  it('mode cash : la trésorerie seule ; avec plus de trésorerie que de budget, le budget tient et la marge se montre', () => {
    expect(compute({ ...db, settings: { ...db.settings, mode: 'CASH' } }, TODAY).disponible).toBe(36200);
    const rich = { ...db, accounts: db.accounts.map((a) => (a.id === 'carte' ? { ...a, balance: 90000 } : a)) };
    const r = compute(rich, TODAY);
    expect([r.limitedBy, r.disponible, r.marge]).toEqual(['budget', 41900, 36200 + 75000 - 41900]);
    expect(compute({ ...rich, settings: { ...rich.settings, mode: 'CASH' } }, TODAY).disponible).toBe(36200 + 75000);
  });

  it('patrimoine net : les comptes, moins ce qu’il reste à payer du 4x', () => {
    expect(netWorth(db, TODAY)).toEqual({ assets: 251100, debts: 0, receivables: 0, installments: 32200, net: 218900 });
  });
});

describe('moteur : cas limites', () => {
  it('une dépense ordinaire d’aujourd’hui ne change pas le budget du jour ; une dépense lissée le réduit de montant ÷ jours', () => {
    const db = reference();
    const before = compute(db, TODAY);
    op(db, 'd4', 'carte', TODAY, -5000, 'LIBRAIRIE', 'EXPENSE');
    db.accounts.find((a) => a.id === 'carte')!.balance! -= 5000;
    const after = compute(db, TODAY);
    expect(after.budgetJour).toBe(before.budgetJour);
    expect(after.resteAujourdhui).toBe(before.resteAujourdhui - 5000);
    db.allocations.find((a) => a.id === 'd4#0')!.smoothed = true;
    const smoothed = compute(db, TODAY);
    expect(smoothed.budgetJour).toBe(Math.round((36200 - 5000) / 11));
    expect(smoothed.resteAujourdhui).toBe(smoothed.budgetJour - 1200);
  });

  it('financé par l’épargne, achat d’un 4x, part avancée, créance soldée : aucun ne pèse à tort', () => {
    const settled = new Set<string>();
    const line = (amount: number, flow: Flow | null, over: Partial<Allocation> = {}): Allocation => ({ id: 'x', transactionId: 't', amount, flow, categoryId: null, tagIds: [], origin: 'manual', note: '', ...over });
    expect(weight(line(-8000, 'EXPENSE'), settled)).toBe(8000);
    expect(weight(line(-8000, null), settled)).toBe(8000);
    expect(weight(line(4000, null), settled)).toBe(0);
    expect(weight(line(-60000, 'EXPENSE', { fundedBySavings: true }), settled)).toBe(0);
    expect(weight(line(-60000, 'EXPENSE', { installmentPurchaseOf: 'plan' }), settled)).toBe(0);
    expect(weight(line(-8000, 'EXPENSE', { receivableAmount: 6000 }), settled)).toBe(2000);
    expect(weight(line(6000, 'REFUND', { settlesReceivableId: 'r' }), settled)).toBe(0);
    expect(weight(line(1500, 'REFUND', { linkedTransactionId: 'd' }), settled)).toBe(-1500);
    expect(weight(line(1500, 'REFUND'), settled)).toBe(0);
    expect(weight(line(-8000, 'EXPENSE'), new Set(['t']))).toBe(0);
    for (const flow of ['INCOME', 'TRANSFER', 'SAVING'] as const) expect(weight(line(-8000, flow), settled)).toBe(0);
  });

  it('enveloppe hors quotidien : retirée du pot et du cash libre ; un dépassement n’ajoute jamais d’argent', () => {
    const db = reference();
    db.categories = [category('shopping')];
    db.envelopes.push(envelope('env:shopping', { cap: 10000, inDailyBudget: false, order: 1, categoryIds: ['shopping'] }));
    const base = compute(db, TODAY);
    expect([base.reserve, base.pot, base.offDaily]).toEqual([10000, 61900, 10000]);
    expect(base.cashLibre).toBe(35000 - 10000);
    // 40 € dépensés dans l'enveloppe : il y reste 60 €, et le quotidien n'a pas bougé.
    op(db, 's1', 'carte', '2026-11-05', -4000, 'BOUTIQUE', 'EXPENSE', { categoryId: 'shopping' });
    const some = compute(db, TODAY);
    expect([some.spent, some.offDaily]).toEqual([base.spent, 6000]);
    // 200 € : dépassée de 100 €. Le reste est borné à 0 : le dépassement ne crée pas de cash libre.
    op(db, 's2', 'carte', '2026-11-06', -16000, 'BOUTIQUE', 'EXPENSE', { categoryId: 'shopping' });
    const over = compute(db, TODAY);
    expect(over.offDaily).toBe(0);
    expect(over.envelopes.find((x) => x.envelope.id === 'env:shopping')).toMatchObject({ spent: 20000, remaining: 0 });
    expect(over.cashLibre).toBe(35000);
  });

  it('paie en avance : elle ouvre le cycle ; en retard : le jour de paie reste la limite', () => {
    const db = reference();
    op(db, 'paie2', 'paie', '2026-11-23', 140000, 'VIR EMPLOYEUR', 'INCOME');
    expect(currentCycle(db, '2026-11-22')).toEqual({ start: '2026-10-26', end: '2026-11-25' });
    expect(currentCycle(db, '2026-11-23')).toEqual({ start: '2026-11-23', end: '2026-12-25' });
    expect(compute(db, '2026-11-24').revenus).toBe(140000);
    expect(currentCycle(reference(), '2026-11-27')).toEqual({ start: '2026-11-26', end: '2026-12-25' });
  });

  it('revenu non prévu : hors budget tant qu’il n’est pas fléché, et signalé', () => {
    const db = reference();
    op(db, 'prime', 'paie', '2026-11-12', 30000, 'VIR VENTE OBJET', 'INCOME');
    const waiting = compute(db, TODAY);
    expect(waiting.revenus).toBe(140000);
    expect(waiting.pendingIncomes).toEqual([{ transactionId: 'prime', amount: 30000 }]);
    db.allocations.find((a) => a.id === 'prime#0')!.incomeUse = 'BUDGET';
    expect(compute(db, TODAY)).toMatchObject({ revenus: 170000, pendingIncomes: [] });
    db.allocations.find((a) => a.id === 'prime#0')!.incomeUse = 'SAVINGS';
    expect(compute(db, TODAY)).toMatchObject({ revenus: 140000, pendingIncomes: [] });
  });

  it('échéances : dates par rythme, fin d’un paiement fractionné, engagement en pause, échéance sautée', () => {
    const cycle = { start: '2026-10-26', end: '2026-11-25' };
    expect(dueDates(commitment('c', 'CHARGE', 'x', 100, null), cycle)).toEqual(['2026-11-25']);
    expect(dueDates(commitment('c', 'CHARGE', 'x', 100, 31), cycle)).toEqual(['2026-10-31']);
    expect(dueDates(commitment('c', 'SAVING', 'x', 100, 1, { rhythm: 'WEEKLY' }), cycle)).toEqual(['2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23']);
    expect(dueDates(commitment('c', 'CHARGE', 'x', 100, null, { rhythm: 'YEARLY', anchorDate: '2024-11-10' }), cycle)).toEqual(['2026-11-10']);
    expect(dueDates(commitment('c', 'INSTALLMENT', 'x', 100, 20, { remainingOccurrences: 0 }), cycle)).toEqual([]);
    expect(dueDates(commitment('c', 'CHARGE', 'x', 100, 5, { paused: true }), cycle)).toEqual([]);
    const db = reference();
    db.commitments.find((c) => c.id === 'tel')!.reserveInCash = true;
    expect(compute(db, TODAY).toPay).toBe(2000);
    db.occurrenceOverrides = [{ id: 'tel@2026-11-20', status: 'SKIPPED', transactionId: null }];
    const e = compute(db, TODAY);
    expect(e.charges).toBe(40000 + 16100);
    expect(e.toPay).toBe(0);
    expect(buildOccurrences(db, e.cycle).find((o) => o.id === 'tel@2026-11-20')?.status).toBe('SKIPPED');
  });

  it('compte partagé et devise : ta part, convertie ; solde inconnu signalé ; compte neuf à zéro', () => {
    const db = blank({ accounts: [account('joint', 'CHECKING', 100000, { ownershipRatio: 0.5 }), account('usd', 'CHECKING', 10000, { currency: 'USD' }), account('nouveau', 'CHECKING', null)], fx: { USD: 0.9 } });
    const e = compute(db, TODAY);
    expect(e.cash).toBe(50000 + 9000);
    expect(e.unknownBalances).toEqual(['nouveau']);
    expect(compute(blank(), TODAY)).toMatchObject({ rav: 0, cashLibre: 0, budgetJour: 0, resteAujourdhui: 0, deficit: 0 });
  });

  it('intégrité : chaque faute est nommée', () => {
    const db = reference();
    db.allocations.find((a) => a.id === 'd1#0')!.amount = -17000;
    expect(checkIntegrity(db).errors).toEqual(['transaction d1 : ses lignes font -17000, pas -18000']);
    const two = reference();
    two.categories = [category('a'), category('b', 'a'), category('c', 'b')];
    two.envelopes.push(envelope('e1', { categoryIds: ['a'] }), envelope('e2', { categoryIds: ['a'], isDefault: true }));
    expect(checkIntegrity(two).errors).toEqual(['catégorie c : plus de deux niveaux', 'catégorie a : dans deux enveloppes (e1 et e2)', '2 enveloppe(s) par défaut : il en faut exactement une']);
    const big = reference();
    big.provisions[0]!.amount = 99900;
    expect(checkIntegrity(big).warnings).toEqual(['paie : 99900 en poches pour 36100 de solde (provision non couverte)']);
  });
});

/**
 * Le cas relevé le 15/11 sur des données réelles (montants repris tels quels, libellés fictifs) : un solde de 367,81 €,
 * une échéance de 461 € au 25 novembre dont 300 € sont déjà versés, et 347,49 € de charges fixes payées sans être au
 * plan. Avant correction : −93,19 € de cash libre (les 300 € comptés deux fois) et 554,35 € de budget. Attendu :
 * 206,81 € de cash libre et 206,86 € de budget, les deux côtés se rejoignant.
 */
function partialCase(label: string): Db {
  const db = blank({
    accounts: [account('k', 'CHECKING', 36781)],
    categories: [category('fixes')],
    commitments: [commitment('salaire', 'INCOME', 'Salaire', 140000, 26), commitment('mens', 'CHARGE', 'Mensualité crédit', 46100, null, { reserveInCash: true })],
    settings: { ...DEFAULT_SETTINGS, payday: 26, openingCommitmentId: 'salaire' },
  });
  db.envelopes.push(envelope('env:fixed', { inDailyBudget: false, order: 1, categoryIds: ['fixes'] }));
  op(db, 'paie', 'k', '2026-10-26', 140000, 'VIR EMPLOYEUR', 'INCOME');
  op(db, 'f1', 'k', '2026-10-28', -30000, 'PRLV ASSURANCE', 'EXPENSE', { categoryId: 'fixes' });
  op(db, 'f2', 'k', '2026-11-02', -4749, 'PRLV ABONNEMENTS', 'EXPENSE', { categoryId: 'fixes' });
  op(db, 'v1', 'k', '2026-11-04', -30000, 'SUPERMARCHE', 'EXPENSE');
  op(db, 'v2', 'k', '2026-11-09', -8465, 'RESTAURANT', 'EXPENSE');
  op(db, 'acompte', 'k', '2026-11-12', -30000, label, 'EXPENSE');
  return db;
}

describe('moteur : échéance en partie versée, charges fixes payées hors plan', () => {
  it('un versement dont le libellé cite la charge est un acompte : seul le reste est à payer, et il ne pèse pas deux fois', () => {
    const e = compute(partialCase('VIR MENSUALITE ACOMPTE'), TODAY);
    const o = e.occurrences.find((x) => x.commitment.id === 'mens')!;
    expect(o).toMatchObject({ dueDate: '2026-11-25', status: 'PARTIAL', paid: 30000, remaining: 16100, transactionIds: ['acompte'] });
    // Trésorerie : 367,81 − 161 (et non − 461).
    expect([e.cash, e.toPay, e.cashLibre]).toEqual([36781, 16100, 20681]);
    // Budget : l'échéance compte pour son montant prévu, une seule fois ; l'acompte ne s'ajoute pas aux dépenses.
    expect([e.revenus, e.charges, e.rav]).toEqual([140000, 46100, 93900]);
    expect(e.spent).toBe(30000 + 8465);
    // Les 347,49 € de charges fixes payées sont retirés du budget théorique : 554,35 − 347,49.
    expect(e.offPlanPaid).toBe(34749);
    expect(e.resteEnveloppe).toBe(20686);
    // Les deux côtés se rejoignent à cinq centimes près ; le plus petit l'emporte.
    expect([e.limitedBy, e.disponible]).toEqual(['cash', 20681]);
  });

  it('sans mot en commun, l’acompte se déclare à la main ; sans déclaration, l’échéance entière reste due', () => {
    const db = partialCase('VIR DIVERS');
    const raw = compute(db, TODAY);
    expect(raw.occurrences.find((x) => x.commitment.id === 'mens')).toMatchObject({ status: 'DUE', remaining: 46100 });
    expect(raw.cashLibre).toBe(36781 - 46100);
    db.occurrenceOverrides = [{ id: 'mens@2026-11-25', status: 'PARTIAL', transactionId: 'acompte', paid: 30000 }];
    const fixed = compute(db, TODAY);
    expect(fixed.occurrences.find((x) => x.commitment.id === 'mens')).toMatchObject({ status: 'PARTIAL', paid: 30000, remaining: 16100 });
    expect([fixed.toPay, fixed.cashLibre, fixed.spent, fixed.resteEnveloppe]).toEqual([16100, 20681, 38465, 20686]);
  });

  it('un acompte qui atteint le montant (à la tolérance près) règle l’échéance ; déclaré sans opération, il réduit seulement le reste à payer', () => {
    const db = partialCase('VIR MENSUALITE ACOMPTE');
    op(db, 'solde', 'k', '2026-11-14', -16100, 'VIR MENSUALITE SOLDE', 'EXPENSE');
    const paid = compute(db, TODAY);
    expect(paid.occurrences.find((x) => x.commitment.id === 'mens')).toMatchObject({ status: 'PAID', actual: 46100, remaining: 0, transactionIds: ['acompte', 'solde'] });
    expect(paid.toPay).toBe(0);
    const declared = partialCase('VIR DIVERS');
    declared.occurrenceOverrides = [{ id: 'mens@2026-11-25', status: 'PARTIAL', transactionId: null, paid: 30000 }];
    expect(compute(declared, TODAY)).toMatchObject({ toPay: 16100, cashLibre: 20681 });
  });

  it('une poche liée couvre le reste à payer d’une échéance en partie versée, une seule fois', () => {
    const db = partialCase('VIR MENSUALITE ACOMPTE');
    db.provisions = [{ id: 'poche', accountId: 'k', label: 'Reste de la mensualité', amount: 16100, commitmentId: 'mens', installmentPlanId: null, goalId: null, status: 'ACTIVE' }];
    expect(compute(db, TODAY)).toMatchObject({ locked: 16100, covered: 16100, toPay: 0, cashLibre: 20681 });
  });
});

/** Générateur déterministe : mêmes graines, mêmes données. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
function randomDb(seed: number): Db {
  const r = rng(seed);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
  const cats = ['a', 'b', 'c', 'd', 'e', 'f'];
  const db = blank({
    accounts: [account('k1', 'CHECKING', Math.floor(r() * 300000)), account('k2', 'CHECKING', Math.floor(r() * 100000)), account('s', 'SAVINGS', 500000)],
    categories: [...cats.map((c) => category(c)), category('a1', 'a'), category('b1', 'b')],
    commitments: [commitment('inc', 'INCOME', 'Salaire', 150000 + Math.floor(r() * 100000), 26), commitment('ch', 'CHARGE', 'Loyer', 30000 + Math.floor(r() * 40000), 2, { reserveInCash: true }), commitment('sv', 'SAVING', 'Livret', Math.floor(r() * 30000), 28)],
    settings: { ...DEFAULT_SETTINGS, payday: 26, openingCommitmentId: 'inc', mode: r() < 0.5 ? 'PRUDENT' : 'CASH' },
  });
  db.envelopes.push(envelope('e1', { cap: Math.floor(r() * 30000), inDailyBudget: r() < 0.5, order: 1, categoryIds: ['a', 'c'] }), envelope('e2', { cap: r() < 0.5 ? null : Math.floor(r() * 20000), inDailyBudget: r() < 0.5, order: 2, categoryIds: ['b1', 'd'] }));
  if (r() < 0.7) db.provisions.push({ id: 'p', accountId: 'k1', label: 'p', amount: Math.floor(r() * 40000), commitmentId: r() < 0.5 ? 'ch' : null, installmentPlanId: null, goalId: null, status: 'ACTIVE' });
  const n = 20 + Math.floor(r() * 40);
  for (let i = 0; i < n; i++) {
    const day = 26 + Math.floor(r() * 21);
    const date = day <= 31 ? `2026-10-${day}` : `2026-11-${String(day - 31).padStart(2, '0')}`;
    const flow = pick<Flow | null>(['EXPENSE', 'EXPENSE', 'EXPENSE', 'EXPENSE', 'REFUND', 'INCOME', null]);
    const amount = (flow === 'REFUND' || flow === 'INCOME' ? 1 : flow === null && r() < 0.3 ? 1 : -1) * (100 + Math.floor(r() * 9000));
    const categoryId = flow === 'EXPENSE' || flow === 'REFUND' ? pick([...cats, 'a1', 'b1', null]) : null;
    op(db, `t${i}`, pick(['k1', 'k2']), date, amount, `OP ${i}`, flow, { categoryId, smoothed: flow === 'EXPENSE' && r() < 0.1, fundedBySavings: flow === 'EXPENSE' && r() < 0.05, receivableAmount: flow === 'EXPENSE' && r() < 0.1 ? Math.floor(-amount / 2) : undefined });
  }
  return db;
}

describe('moteur : invariants (200 jeux de données tirés au hasard)', () => {
  const seeds = Array.from({ length: 200 }, (_, i) => i + 1);
  const TODAY2 = '2026-11-15';

  it('schéma intègre ; chaque dépense tombe dans exactement une enveloppe', () => {
    for (const seed of seeds) {
      const db = randomDb(seed);
      expect(checkIntegrity(db).errors, `graine ${seed}`).toEqual([]);
      const e = compute(db, TODAY2);
      const total = db.allocations.reduce((s, a) => (db.transactions.find((t) => t.id === a.transactionId)!.date <= TODAY2 ? s + weight(a, new Set(e.occurrences.flatMap((o) => (o.transactionId ? [o.transactionId] : [])))) : s), 0);
      expect(e.envelopes.reduce((s, x) => s + x.spent, 0), `graine ${seed}`).toBe(total);
      expect(e.envelopes.filter((x) => x.envelope.inDailyBudget).reduce((s, x) => s + x.spent, 0), `graine ${seed}`).toBe(e.spent);
    }
  });

  it('budget du jour jamais négatif ; en mode prudent, le disponible ne dépasse jamais la trésorerie ; le reste d’une enveloppe est borné', () => {
    for (const seed of seeds) {
      const e = compute(randomDb(seed), TODAY2);
      expect(e.budgetJour, `graine ${seed}`).toBeGreaterThanOrEqual(0);
      // La trésorerie à minuit = le disponible, plus la marge quand c'est le budget qui limite.
      const cashMinuit = e.limitedBy === 'budget' ? e.disponible + e.marge : e.disponible;
      expect(e.disponible, `graine ${seed}`).toBeLessThanOrEqual(e.mode === 'PRUDENT' ? cashMinuit : e.disponible);
      if (e.mode === 'PRUDENT') expect(e.limitedBy, `graine ${seed}`).toBe(e.marge < 0 ? 'cash' : 'budget');
      else expect(e.limitedBy, `graine ${seed}`).toBe('cash');
      expect(e.budgetJour, `graine ${seed}`).toBe(Math.max(0, Math.round(e.disponible / e.daysLeft)));
      for (const x of e.envelopes) expect(x.remaining, `graine ${seed}`).toBeGreaterThanOrEqual(0);
      expect(e.offDaily, `graine ${seed}`).toBeGreaterThanOrEqual(0);
    }
  });

  it('renommer, déplacer ou fusionner une catégorie ne change aucun total ; changer la composition d’une enveloppe ne change pas la somme', () => {
    for (const seed of seeds) {
      const db = randomDb(seed);
      const e = compute(db, TODAY2);
      const renamed = { ...db, categories: db.categories.map((c) => ({ ...c, name: `${c.name} bis`, order: 9 - c.order })) };
      expect(compute(renamed, TODAY2), `graine ${seed}`).toMatchObject({ spent: e.spent, rav: e.rav, cashLibre: e.cashLibre, budgetJour: e.budgetJour });
      // « f » (sans enveloppe propre) fusionnée dans « e » (sans enveloppe non plus) : tout reste dans la même enveloppe.
      const merged = { ...db, categories: db.categories.map((c) => (c.id === 'f' ? { ...c, mergedIntoId: 'e' } : c)) };
      expect(envelopeOf(merged, 'f').id).toBe(envelopeOf(db, 'e').id);
      expect(compute(merged, TODAY2).spent, `graine ${seed}`).toBe(e.spent);
      // « c » passe de e1 à e2 : la répartition change, pas la somme.
      const moved = { ...db, envelopes: db.envelopes.map((x) => (x.id === 'e1' ? { ...x, categoryIds: ['a'] } : x.id === 'e2' ? { ...x, categoryIds: [...x.categoryIds, 'c'] } : x)) };
      const sum = (x: ReturnType<typeof compute>) => x.envelopes.reduce((s, y) => s + y.spent, 0);
      expect(sum(compute(moved, TODAY2)), `graine ${seed}`).toBe(sum(e));
    }
  });

  it('un virement interne apparié ne change ni le budget ni la trésorerie totale', () => {
    for (const seed of seeds) {
      const db = randomDb(seed);
      const e = compute(db, TODAY2);
      op(db, 'va', 'k1', '2026-11-10', -7000, 'VIR', 'TRANSFER', { linkedTransactionId: 'vb' });
      op(db, 'vb', 'k2', '2026-11-11', 7000, 'VIR', 'TRANSFER', { linkedTransactionId: 'va' });
      db.accounts[0]!.balance! -= 7000;
      db.accounts[1]!.balance! += 7000;
      expect(checkIntegrity(db).errors).toEqual([]);
      expect(compute(db, TODAY2), `graine ${seed}`).toMatchObject({ spent: e.spent, rav: e.rav, cash: e.cash, cashLibre: e.cashLibre, budgetJour: e.budgetJour });
    }
  });

  it('une dépense ordinaire d’aujourd’hui ne change pas le budget du jour', () => {
    for (const seed of seeds) {
      const db = randomDb(seed);
      const before = compute(db, TODAY2);
      op(db, 'now', 'k1', TODAY2, -2345, 'ACHAT', 'EXPENSE');
      db.accounts[0]!.balance! -= 2345;
      const after = compute(db, TODAY2);
      // Sauf si l'achat tombe dans une enveloppe hors quotidien (pas le cas ici : sans catégorie, enveloppe par défaut).
      if (envelopeOf(db, null).inDailyBudget) expect(after.budgetJour, `graine ${seed}`).toBe(before.budgetJour);
    }
  });

  it('une poche liée à une échéance n’est jamais déduite deux fois ; une poche libre réduit le cash libre de son montant', () => {
    for (const seed of seeds) {
      const db = randomDb(seed);
      const none = compute({ ...db, provisions: [] }, TODAY2);
      const charge = none.occurrences.find((o) => o.commitment.id === 'ch')!;
      const pocket = { id: 'q', accountId: 'k1', label: 'q', amount: 12345, commitmentId: 'ch', installmentPlanId: null, goalId: null, status: 'ACTIVE' as const };
      const linked = compute({ ...db, provisions: [pocket] }, TODAY2);
      // Liée : seule la part qui dépasse l'échéance encore due réduit le cash libre.
      const usable = charge.status === 'DUE' ? Math.min(12345, charge.expected) : 0;
      expect(linked.cashLibre, `graine ${seed}`).toBe(none.cashLibre - (12345 - usable));
      expect(compute({ ...db, provisions: [{ ...pocket, commitmentId: null }] }, TODAY2).cashLibre, `graine ${seed}`).toBe(none.cashLibre - 12345);
      // Une poche ne touche jamais le budget théorique.
      expect(linked.rav, `graine ${seed}`).toBe(none.rav);
    }
  });
});

describe('moteur : reprise depuis l’étape 3.3', () => {
  it('comptes à rôles, une ligne par part, enveloppes de départ, engagements ; le résultat est intègre', () => {
    const data = migrate({
      accounts: [{ id: 'acc', name: 'Compte', balance: 120000, kind: 'current' }, { id: 'liv', name: 'Livret', balance: 300000, kind: 'savings' }],
      categories: [
        { id: 'courses', name: 'Courses', kind: 'variable', target: 30000, order: 0 },
        { id: 'logement', name: 'Logement', kind: 'fixed', order: 1 },
        { id: 'revenus', name: 'Revenus', kind: 'income', order: 2 },
        { id: 'transferts', name: 'Transferts', kind: 'excluded', order: 3 },
      ],
      transactions: [
        { id: 't1', accountId: 'acc', date: '2026-11-10', amount: -1250, label: 'EPICERIE', categoryId: 'courses' },
        { id: 't2', accountId: 'acc', date: '2026-11-02', amount: -70000, label: 'PRLV LOYER', categoryId: 'logement' },
        { id: 't3', accountId: 'acc', date: '2026-11-01', amount: 200000, label: 'VIR EMPLOYEUR', categoryId: 'revenus' },
        { id: 't4', accountId: 'acc', date: '2026-11-03', amount: -10000, label: 'VIR LIVRET', categoryId: 'transferts', transferPairId: 'p' },
        { id: 't5', accountId: 'liv', date: '2026-11-03', amount: 10000, label: 'VIR RECU', categoryId: 'transferts', transferPairId: 'p' },
        { id: 't6', accountId: 'acc', date: '2026-11-11', amount: -2500, label: 'ABONNEMENT SALLE', categoryId: 'logement' },
      ],
      settings: { payday: 1, incomes: [{ id: 'i', label: 'Salaire', amount: 200000, day: 1 }], fixedCharges: [{ id: 'c', label: 'Loyer', amount: 70000, day: 2 }] },
    });
    const db = fromV3(data);
    expect(checkIntegrity(db)).toEqual({ errors: [], warnings: [] });
    expect(db.accounts.map((a) => [a.id, a.role, a.includeInDailyCash])).toEqual([['acc', 'CHECKING', true], ['liv', 'SAVINGS', false]]);
    expect(db.envelopes.map((e) => [e.id, e.inDailyBudget, e.cap])).toEqual([['env:default', true, null], ['env:fixed', false, null], ['env:courses', true, 30000]]);
    expect(db.allocations.find((a) => a.id === 't4#0')).toMatchObject({ flow: 'SAVING', linkedTransactionId: 't5' });
    expect(db.settings).toMatchObject({ payday: 1, openingCommitmentId: 'inc:i' });
    const e = compute(db, '2026-11-12');
    // Salaire et loyer rapprochés ; l'abonnement (catégorie fixe, pas au plan) est hors du budget quotidien.
    expect(e.occurrences.map((o) => [o.commitment.id, o.status])).toEqual([['inc:i', 'PAID'], ['chg:c', 'PAID']]);
    expect([e.revenus, e.charges, e.epargne, e.rav]).toEqual([200000, 70000, 10000, 120000]);
    expect(e.spent).toBe(1250);
    expect(e.envelopes.find((x) => x.envelope.id === 'env:fixed')?.spent).toBe(2500);
    expect([e.offPlanPaid, e.pot]).toEqual([2500, 117500]);
    expect([e.cash, e.cashLibre]).toEqual([120000, 120000]);
    expect(e.limitedBy).toBe('budget');
  });
});

/** Le scénario de référence sans son 4x ni sa poche, pour poser les leviers de M2 un par un. */
function plain(): Db {
  const db = reference();
  db.commitments = db.commitments.filter((c) => c.id !== 'alma');
  db.provisions = [];
  db.installmentPlans = [];
  return db;
}
const withState = (base: Db, change: (s: EngineState) => EngineState = (s) => s) => change(initState(base));

describe('moteur M2 : provision mensuelle d’une charge annuelle', () => {
  const base = plain();
  const assurance = commitment('assurance', 'CHARGE', 'Assurance habitation', 12000, null, { rhythm: 'YEARLY', anchorDate: '2027-03-10', provisionMonthly: true });
  let s = withState(base, (x) => saveCommitment(x, assurance));

  it('chaque cycle cotise ce qu’il faut pour être prêt le jour J ; la poche est verrouillée ; l’échéance ne pèse pas une seconde fois', () => {
    // Échéance le 10 mars : cinq cycles d'ici là (celui-ci compris), 120 € ÷ 5 = 24 € par cycle.
    s = roll(s, base, TODAY, 1);
    const pocket = s.provisions.find((p) => p.id === 'auto:assurance')!;
    expect(pocket).toMatchObject({ amount: 2400, auto: true, accountId: 'paie', commitmentId: 'assurance', contributions: { '2026-10-26': 2400 } });
    const e = compute(applyState(base, s), TODAY);
    expect([e.provisioning, e.charges, e.locked]).toEqual([2400, 40000 + 2000 + 2400, 2400]);
    // Rejouer dans le même cycle ne cotise pas deux fois.
    expect(roll(s, base, '2026-11-20', 2).provisions).toEqual(s.provisions);
    for (const day of ['2026-12-01', '2027-01-02', '2027-02-03', '2027-03-01']) s = roll(s, base, day, 3);
    expect(s.provisions.find((p) => p.id === 'auto:assurance')).toMatchObject({ amount: 12000, contributions: { '2026-10-26': 2400, '2026-11-26': 2400, '2026-12-26': 2400, '2027-01-26': 2400, '2027-02-26': 2400 } });
    // Le cycle de l'échéance : elle est là, due, mais seule sa cotisation pèse.
    const dueCycle = compute(applyState(base, s), '2027-03-01');
    expect(dueCycle.occurrences.find((o) => o.commitment.id === 'assurance')).toMatchObject({ dueDate: '2027-03-10', status: 'DUE' });
    expect(dueCycle.provisioning).toBe(2400);
    expect(dueCycle.charges).toBe(40000 + 2000 + 2400);
  });

  it('le jour J : l’opération règle l’échéance, la poche est vidée, et le cycle suivant recommence pour l’année d’après', () => {
    const paid = structuredClone(base);
    op(paid, 'ass', 'paie', '2027-03-10', -12000, 'PRLV ASSURANCE HABITATION', 'EXPENSE');
    s = roll(s, paid, '2027-03-12', 4);
    expect(s.provisions.find((p) => p.id === 'auto:assurance')).toMatchObject({ amount: 0, consumedFor: 'assurance@2027-03-10' });
    const e = compute(applyState(paid, s), '2027-03-12');
    // Payée par la poche : elle ne pèse ni dans les dépenses, ni une seconde fois dans les charges.
    expect([e.provisioning, e.spent, e.locked]).toEqual([2400, 0, 0]);
    s = roll(s, paid, '2027-03-27', 5);
    expect(s.provisions.find((p) => p.id === 'auto:assurance')).toMatchObject({ amount: 1000 });
    expect(s.provisions.find((p) => p.id === 'auto:assurance')!.contributions!['2027-03-26']).toBe(1000);
  });

  it('provision arrêtée : la poche reste, comme une poche ordinaire, et plus rien n’est cotisé', () => {
    const stopped = roll(saveCommitment(s, { ...assurance, provisionMonthly: false }), base, '2027-04-27', 6);
    const pocket = stopped.provisions.find((p) => p.id === 'auto:assurance')!;
    expect(pocket.auto).toBe(false);
    expect(pocket.contributions!['2027-04-26']).toBeUndefined();
  });
});

describe('moteur M2 : paiement en plusieurs fois', () => {
  const base = plain();
  const s = withState(base, (x) => addInstallmentPlan(x, { id: 'velo', label: 'Vélo en 4 fois', total: 60000, count: 4, paidCount: 1, nextDate: '2026-11-20', accountId: 'paie' }));
  const db = applyState(base, s);

  it('chaque échéance pèse sur son propre cycle, et seulement lui ; après la dernière, plus rien', () => {
    expect(s.commitments.find((c) => c.id === 'inst:velo')).toMatchObject({ kind: 'INSTALLMENT', amount: 15000, anchorDay: 20, startDate: '2026-11-20', endDate: '2027-01-20', installmentPlanId: 'velo' });
    const charges = (day: string) => compute(db, day).occurrences.filter((o) => o.commitment.id === 'inst:velo').map((o) => o.dueDate);
    expect(charges('2026-11-15')).toEqual(['2026-11-20']);
    expect(charges('2026-12-01')).toEqual(['2026-12-20']);
    expect(charges('2027-01-10')).toEqual(['2027-01-20']);
    expect(charges('2027-02-10')).toEqual([]);
    expect(compute(db, TODAY).charges).toBe(40000 + 2000 + 15000);
  });

  it('l’échéance du cycle est réservée dans la trésorerie ; la dette restante est déduite du patrimoine', () => {
    expect(compute(db, TODAY)).toMatchObject({ toPay: 15000, cashLibre: 51100 - 15000 });
    expect(netWorth(db, TODAY).installments).toBe(45000);
    expect(netWorth(db, '2026-12-21').installments).toBe(15000);
    expect(netWorth(db, '2027-01-21').installments).toBe(0);
  });

  it('l’achat lui-même ne pèse pas dans le budget ; supprimer le plan retire son engagement', () => {
    const bought = structuredClone(base);
    op(bought, 'achat', 'carte', '2026-11-14', -15000, 'MAGASIN DE VELOS', 'EXPENSE', { installmentPurchaseOf: 'velo' });
    expect(compute(applyState(bought, s), TODAY).spent).toBe(compute(db, TODAY).spent);
    const removed = removeInstallmentPlan(s, 'velo');
    expect([removed.installmentPlans.length, removed.commitments.some((c) => c.id === 'inst:velo')]).toEqual([0, false]);
  });
});

describe('moteur M2 : clôture et reports', () => {
  const END = '2026-11-25';
  it('excédent : remis à zéro et proposé à l’épargne, ou reporté ; dépassement : déduit du cycle suivant, ou oublié', () => {
    const db = plain();
    // Reste à vivre 140 000 − 42 000 − 10 000 = 88 000 ; dépensé 31 200 ; excédent 56 800.
    expect(closeCycle(db, END, 1)).toMatchObject({ start: '2026-10-26', end: END, rav: 88000, spent: 31200, result: 56800, carryOut: { global: 0, envelopes: {} }, toSave: 56800 });
    expect(closeCycle({ ...db, settings: { ...db.settings, endPolicy: 'ROLLOVER' } }, END, 1)).toMatchObject({ carryOut: { global: 56800 }, toSave: 0 });
    expect(closeCycle({ ...db, settings: { ...db.settings, endPolicy: 'AUTO_SAVE' } }, END, 1)).toMatchObject({ carryOut: { global: 0 }, toSave: 56800 });
    const over = plain();
    op(over, 'gros', 'carte', '2026-11-18', -70000, 'GROS ACHAT', 'EXPENSE');
    expect(closeCycle(over, END, 1)).toMatchObject({ result: -13200, carryOut: { global: -13200 }, toSave: 0 });
    expect(closeCycle({ ...over, settings: { ...over.settings, overspendPolicy: 'FORGIVE' } }, END, 1).carryOut.global).toBe(0);
  });

  it('chaque enveloppe plafonnée suit sa propre politique', () => {
    const db = plain();
    db.categories = [category('shopping'), category('sorties')];
    db.envelopes.push(envelope('env:shopping', { cap: 10000, inDailyBudget: false, endPolicy: 'ROLLOVER', order: 1, categoryIds: ['shopping'] }), envelope('env:sorties', { cap: 5000, inDailyBudget: false, endPolicy: 'RESET', order: 2, categoryIds: ['sorties'] }));
    op(db, 's1', 'carte', '2026-11-05', -4000, 'BOUTIQUE', 'EXPENSE', { categoryId: 'shopping' });
    op(db, 's2', 'carte', '2026-11-06', -7000, 'CONCERT', 'EXPENSE', { categoryId: 'sorties' });
    const closed = closeCycle(db, END, 1);
    expect(closed.envelopes).toEqual([
      { id: 'env:shopping', name: 'env:shopping', budget: 10000, spent: 4000, result: 6000 },
      { id: 'env:sorties', name: 'env:sorties', budget: 5000, spent: 7000, result: -2000 },
    ]);
    // Shopping reporte ses 60 € ; Sorties, dépassée de 20 €, les perd sur son prochain budget.
    expect(closed.carryOut.envelopes).toEqual({ 'env:shopping': 6000, 'env:sorties': -2000 });
    const next = compute({ ...db, carryIn: closed.carryOut }, '2026-11-27');
    expect(next.envelopes.filter((x) => x.budget !== null).map((x) => x.budget)).toEqual([16000, 3000]);
  });

  it('le temps passe : le cycle terminé est clos une seule fois, son report s’applique, et « remettre à zéro » l’efface', () => {
    const base = plain();
    let s = withState(base, (x) => ({ ...x, settings: { ...x.settings, endPolicy: 'ROLLOVER' } }));
    s = roll(s, base, TODAY, 1);
    expect([s.lastCycleStart, s.closedCycles.length]).toEqual(['2026-10-26', 0]);
    s = roll(s, base, '2026-11-27', 2);
    expect(s.lastCycleStart).toBe('2026-11-26');
    expect(s.closedCycles.map((c) => [c.start, c.result])).toEqual([['2026-10-26', 56800]]);
    expect(s.carryIn.global).toBe(56800);
    expect(compute(applyState(base, s), '2026-11-27')).toMatchObject({ report: 56800, rav: 88000 + 56800 });
    expect(roll(s, base, '2026-11-30', 3)).toEqual(s);
    // Deux cycles d'absence : les deux sont clos, dans l'ordre.
    const late = roll(withState(base), base, TODAY, 1);
    expect(roll(late, base, '2027-01-05', 2).closedCycles.map((c) => c.start)).toEqual(['2026-11-26', '2026-10-26']);
  });
});

describe('moteur M2 : les réglages de l’utilisateur tiennent quand les données sont relues', () => {
  it('engagements, enveloppes et leviers posés sur une ligne survivent à une nouvelle reprise', () => {
    const base = plain();
    let s = withState(base);
    s = saveCommitment(s, commitment('salle', 'CHARGE', 'Salle de sport', 2990, 5));
    s = patchAllocation(s, 'd2#0', { smoothed: true });
    s = patchAllocation(s, 'd1#0', { fundedBySavings: true });
    // La reprise ramène une opération de plus, et un solde à jour.
    const fresh = structuredClone(base);
    op(fresh, 'd9', 'carte', '2026-11-14', -900, 'KIOSQUE', 'EXPENSE');
    const db = applyState(fresh, s);
    expect(db.commitments.map((c) => c.id)).toContain('salle');
    expect(db.transactions.some((t) => t.id === 'd9')).toBe(true);
    expect(db.allocations.find((a) => a.id === 'd2#0')?.smoothed).toBe(true);
    expect(compute(db, TODAY).spent).toBe(12000 + 1200 + 900);
    expect(checkIntegrity(db).errors).toEqual([]);
  });

  it('une catégorie rangée dans une enveloppe quitte l’autre ; l’enveloppe par défaut ne disparaît jamais', () => {
    const base = plain();
    base.categories = [category('a'), category('b')];
    let s = withState(base);
    s = saveEnvelope(s, envelope('e1', { categoryIds: ['a', 'b'] }));
    s = saveEnvelope(s, envelope('e2', { categoryIds: ['b'] }));
    expect(s.envelopes.map((e) => [e.id, e.categoryIds])).toEqual([['env:default', []], ['e1', ['a']], ['e2', ['b']]]);
    expect(checkIntegrity(applyState(base, s)).errors).toEqual([]);
    expect(applyState(base, { ...s, envelopes: s.envelopes.filter((e) => !e.isDefault) }).envelopes.filter((e) => e.isDefault)).toHaveLength(1);
  });
});

const rule = (id: string, over: Partial<Rule>): Rule => ({ id, name: id, priority: 0, enabled: true, merchantId: null, keywords: [], accountIds: [], amountMin: null, amountMax: null, direction: 'any', flow: 'EXPENSE', categoryId: null, tagIds: [], ...over });
const lineOf = (db: Db, tx: string) => db.allocations.find((a) => a.transactionId === tx)!;

describe('moteur M3 : appariement automatique des virements internes', () => {
  /** Deux comptes du quotidien et un livret ; rien n'est encore classé. */
  function raw(): Db {
    const db = blank({ accounts: [account('paie', 'CHECKING', 100000), account('carte', 'CHECKING', 20000), account('livret', 'SAVINGS', 300000)] });
    op(db, 'a1', 'paie', '2026-11-03', -30000, 'VIR SEPA VERS COMPTE CARTE', null);
    op(db, 'a2', 'carte', '2026-11-04', 30000, 'TOP UP', null);
    op(db, 'b1', 'paie', '2026-11-05', -15000, 'VIREMENT LIVRET', null);
    op(db, 'b2', 'livret', '2026-11-08', 15000, 'VERSEMENT', null);
    op(db, 'c1', 'paie', '2026-11-06', -4000, 'SUPERMARCHE', 'EXPENSE');
    return db;
  }

  it('deux opérations opposées sur deux comptes, à trois jours près, deviennent un virement ; vers l’épargne, une mise de côté', () => {
    const db = pairTransfers(raw());
    expect(lineOf(db, 'a1')).toMatchObject({ flow: 'TRANSFER', linkedTransactionId: 'a2' });
    expect(lineOf(db, 'a2')).toMatchObject({ flow: 'TRANSFER', linkedTransactionId: 'a1' });
    expect(lineOf(db, 'b1')).toMatchObject({ flow: 'SAVING', linkedTransactionId: 'b2' });
    expect(lineOf(db, 'b2')).toMatchObject({ flow: 'TRANSFER', linkedTransactionId: 'b1' });
    expect(lineOf(db, 'c1').flow).toBe('EXPENSE');
    expect(checkIntegrity(db).errors).toEqual([]);
    // Le virement pèse zéro ; la mise de côté compte dans l'épargne, pas dans les dépenses.
    const e = compute(db, '2026-11-15');
    expect([e.spent, e.epargne]).toEqual([4000, 15000]);
  });

  it('pas d’appariement au-delà de la tolérance, sur un même compte, à montants différents, ou contre une décision prise à la main', () => {
    const far = raw();
    far.transactions.find((t) => t.id === 'b2')!.date = '2026-11-09';
    expect(lineOf(pairTransfers(far), 'b1').linkedTransactionId).toBeUndefined();
    expect(lineOf(pairTransfers({ ...far, settings: { ...far.settings, transferToleranceDays: 4 } }), 'b1').linkedTransactionId).toBe('b2');
    const same = raw();
    same.transactions.find((t) => t.id === 'a2')!.accountId = 'paie';
    expect(lineOf(pairTransfers(same), 'a1').flow).toBeNull();
    const diff = raw();
    diff.transactions.find((t) => t.id === 'a2')!.amount = 29900;
    lineOf(diff, 'a2').amount = 29900;
    expect(lineOf(pairTransfers(diff), 'a1').flow).toBeNull();
    const manual = raw();
    Object.assign(lineOf(manual, 'a1'), { flow: 'EXPENSE', origin: 'manual' });
    const paired = pairTransfers(manual);
    expect([lineOf(paired, 'a1').flow, lineOf(paired, 'a2').flow]).toEqual(['EXPENSE', null]);
  });

  it('chaque opération ne sert qu’une fois : deux virements identiques le même jour s’apparient deux à deux', () => {
    const db = raw();
    op(db, 'a3', 'paie', '2026-11-03', -30000, 'VIR SEPA VERS COMPTE CARTE', null);
    op(db, 'a4', 'carte', '2026-11-03', 30000, 'TOP UP', null);
    const paired = pairTransfers(db);
    const links = ['a1', 'a3'].map((id) => lineOf(paired, id).linkedTransactionId).sort();
    expect(links).toEqual(['a2', 'a4']);
    expect(checkIntegrity(paired).errors).toEqual([]);
  });
});

describe('moteur M3 : marchands et règles de tri', () => {
  function shop(): Db {
    const db = blank({ accounts: [account('k', 'CHECKING', 100000)], categories: [category('courses'), category('restos'), category('pro')] });
    db.merchants = [
      { id: 'm:epicerie', name: 'Épicerie', flow: 'EXPENSE', categoryId: 'courses', tagIds: [] },
      { id: 'm:bistrot', name: 'Bistrot', flow: null, categoryId: null, tagIds: [] },
    ];
    op(db, 'e1', 'k', '2026-11-02', -2000, 'CB EPICERIE', null);
    op(db, 'e2', 'k', '2026-11-05', 500, 'AVOIR EPICERIE', null);
    op(db, 'r1', 'k', '2026-11-06', -4500, 'CB BISTROT DU PORT', null);
    op(db, 'r2', 'k', '2026-11-09', -15000, 'CB BISTROT DU PORT', null);
    op(db, 'x1', 'k', '2026-11-10', -900, 'KIOSQUE', null);
    for (const [tx, m] of [['e1', 'm:epicerie'], ['e2', 'm:epicerie'], ['r1', 'm:bistrot'], ['r2', 'm:bistrot']] as const) db.transactions.find((t) => t.id === tx)!.merchantId = m;
    return db;
  }

  it('le marchand classe ses opérations ; une rentrée chez un marchand de dépense est un remboursement', () => {
    const db = classify(shop());
    expect(lineOf(db, 'e1')).toMatchObject({ flow: 'EXPENSE', categoryId: 'courses', origin: 'merchant' });
    expect(lineOf(db, 'e2')).toMatchObject({ flow: 'REFUND', categoryId: 'courses' });
    expect(lineOf(db, 'r1').flow).toBeNull();
    expect(toClassify(db).map((g) => [g.name, g.count, g.total])).toEqual([['Bistrot', 2, -19500], ['KIOSQUE', 1, -900]]);
  });

  it('une règle l’emporte sur le marchand, la plus prioritaire d’abord ; toutes ses conditions doivent être vraies', () => {
    const db = shop();
    db.rules = [
      rule('gros', { priority: 2, keywords: ['bistrot'], amountMin: 10000, categoryId: 'pro', tagIds: ['#pro'] }),
      rule('resto', { priority: 1, keywords: ['Bistrôt'], categoryId: 'restos' }),
      rule('vide', { priority: 9, categoryId: 'pro' }),
    ];
    const out = classify(db);
    expect(lineOf(out, 'r1')).toMatchObject({ flow: 'EXPENSE', categoryId: 'restos', origin: 'rule' });
    expect(lineOf(out, 'r2')).toMatchObject({ categoryId: 'pro', tagIds: ['#pro'] });
    // Une règle sans condition ne classe rien.
    expect(lineOf(out, 'x1').flow).toBeNull();
    const t = db.transactions.find((x) => x.id === 'r1')!;
    expect(ruleMatches(rule('a', { keywords: ['port'], direction: 'credit' }), t)).toBe(false);
    expect(ruleMatches(rule('a', { keywords: ['por'] }), t)).toBe(false);
    expect(ruleMatches(rule('a', { accountIds: ['autre'] }), t)).toBe(false);
    expect(ruleMatches(rule('a', { merchantId: 'm:bistrot', enabled: false }), t)).toBe(false);
  });

  it('classer un marchand, une ligne, écrire une règle : tout tient, et la décision à la main a le dernier mot', () => {
    const base = shop();
    let s = initState(base);
    s = classifyMerchant(s, 'm:bistrot', 'EXPENSE', 'restos');
    let db = applyState(base, s);
    expect([lineOf(db, 'r1').categoryId, lineOf(db, 'r2').categoryId]).toEqual(['restos', 'restos']);
    s = classifyAllocation(s, 'r2#0', 'EXPENSE', 'pro');
    s = saveRule(s, rule('kiosque', { keywords: ['kiosque'], categoryId: 'courses' }));
    // Un marchand reclassé s'impose aussi à ses opérations déjà classées par la reprise.
    s = classifyMerchant(s, 'm:epicerie', 'EXPENSE', 'restos');
    db = applyState(base, s);
    expect(lineOf(db, 'r1')).toMatchObject({ categoryId: 'restos', origin: 'merchant' });
    expect(lineOf(db, 'r2')).toMatchObject({ categoryId: 'pro', origin: 'manual' });
    expect(lineOf(db, 'x1')).toMatchObject({ categoryId: 'courses', origin: 'rule' });
    expect(lineOf(db, 'e1').categoryId).toBe('restos');
    expect(toClassify(db)).toEqual([]);
    expect(checkIntegrity(db).errors).toEqual([]);
  });
});

describe('moteur M3 : détection des récurrents', () => {
  function history(): Db {
    const db = blank({ accounts: [account('k', 'CHECKING', 100000)] });
    for (const [i, date] of ['2026-07-05', '2026-08-05', '2026-09-06', '2026-10-05', '2026-11-05'].entries()) op(db, `s${i}`, 'k', date, -1099, 'PRLV MUSIQUE EN LIGNE 4412', 'EXPENSE');
    for (const [i, date] of ['2026-08-26', '2026-09-25', '2026-10-26'].entries()) op(db, `p${i}`, 'k', date, 140000 + i * 300, 'VIR EMPLOYEUR SA', 'INCOME');
    for (const [i, date] of ['2026-09-01', '2026-09-20', '2026-11-11'].entries()) op(db, `c${i}`, 'k', date, -2000 - i * 4000, 'SUPERMARCHE', 'EXPENSE');
    for (const [i, date] of ['2026-03-01', '2026-04-01', '2026-05-01'].entries()) op(db, `o${i}`, 'k', date, -3000, 'ANCIEN ABONNEMENT', 'EXPENSE');
    return db;
  }
  const NOW = '2026-11-15';

  it('ce qui revient à rythme et montant réguliers est proposé ; l’irrégulier et l’arrêté ne le sont pas', () => {
    const found = detectRecurring(history(), NOW);
    expect(found.map((x) => [x.kind, x.label, x.amount, x.rhythm, x.anchorDay, x.count])).toEqual([
      ['INCOME', 'Vir Employeur Sa', 140300, 'MONTHLY', 26, 3],
      ['CHARGE', 'Prlv Musique En Ligne', 1099, 'MONTHLY', 5, 5],
    ]);
  });

  it('accepté, il entre au plan et n’est plus proposé ; ignoré, il ne revient pas', () => {
    const base = history();
    let s = initState(base);
    const [salary, music] = detectRecurring(base, NOW);
    s = acceptSuggestion(s, music!);
    expect(s.commitments[0]).toMatchObject({ kind: 'CHARGE', amount: 1099, rhythm: 'MONTHLY', anchorDay: 5, accountId: 'k', reserveInCash: null });
    s = ignoreSuggestion(s, salary!.key);
    expect(detectRecurring(applyState(base, s), NOW, s.ignoredSuggestions)).toEqual([]);
    // L'engagement accepté se rapproche de l'opération du cycle : il ne pèse pas deux fois.
    const e = compute(applyState(base, s), NOW);
    expect(e.occurrences.map((o) => [o.commitment.label, o.status])).toEqual([['Prlv Musique En Ligne', 'PAID']]);
  });
});

describe('moteur M3 : carte à débit différé', () => {
  const card = { closingDay: 25, debitDay: 5 };
  it('un achat est prélevé au premier jour de prélèvement qui suit son arrêté', () => {
    expect(debitDate('2026-11-10', card)).toBe('2026-12-05');
    expect(debitDate('2026-11-25', card)).toBe('2026-12-05');
    expect(debitDate('2026-11-26', card)).toBe('2027-01-05');
    expect(debitDate('2026-11-10', { closingDay: 31, debitDay: 31 })).toBe('2026-11-30');
  });

  it('l’encours pas encore prélevé est retiré du cash libre, s’il est prélevé avant la fin du cycle ; l’achat pèse dans le budget à sa date', () => {
    // Cycle du 26 octobre au 25 novembre ; carte arrêtée le 28, prélevée le 5.
    const db = reference();
    db.accounts.push(account('differe', 'CHECKING', 0, { includeInDailyCash: false, deferredDebit: { closingDay: 28, debitDay: 5 } }));
    const before = compute(db, TODAY);
    // Acheté le 27 octobre : arrêté le 28 octobre, prélevé le 5 novembre. Déjà sorti du solde.
    op(db, 'd0', 'differe', '2026-10-27', -5000, 'ACHAT A', 'EXPENSE');
    // Acheté le 30 octobre : arrêté le 28 novembre, prélevé le 5 décembre, après la fin du cycle.
    op(db, 'd5', 'differe', '2026-10-30', -7000, 'ACHAT B', 'EXPENSE');
    const e = compute(db, TODAY);
    expect(e.spent).toBe(before.spent + 12000);
    expect([e.deferred, e.cashLibre]).toEqual([0, before.cashLibre]);
    // Avec un prélèvement le 20 : l'achat du 27 octobre (arrêté le 28) est prélevé le 20 novembre, dans le cycle.
    db.accounts.find((a) => a.id === 'differe')!.deferredDebit = { closingDay: 28, debitDay: 20 };
    const soon = compute(db, TODAY);
    expect([soon.deferred, soon.cashLibre]).toEqual([5000, before.cashLibre - 5000]);
    // Une fois le prélèvement passé, l'encours ne compte plus : le solde du compte débité le porte.
    expect(compute(db, '2026-11-21').deferred).toBe(0);
  });

  it('un achat différé d’aujourd’hui ne change pas le budget du jour ; régler un compte en différé tient dans les réglages', () => {
    const base = reference();
    base.accounts.push(account('differe', 'CHECKING', 0, { includeInDailyCash: false }));
    const s = patchAccount(initState(base), 'differe', { deferredDebit: { closingDay: 16, debitDay: 20 } });
    const before = compute(applyState(base, s), TODAY);
    op(base, 'now', 'differe', TODAY, -3000, 'ACHAT DU JOUR', 'EXPENSE');
    const after = compute(applyState(base, s), TODAY);
    expect(after.deferred).toBe(3000);
    expect(after.budgetJour).toBe(before.budgetJour);
    expect(after.resteAujourdhui).toBe(before.resteAujourdhui - 3000);
  });
});

describe('moteur M3 : avance entre amis', () => {
  const base = plain();
  // Le restaurant du 10 novembre : 120 € payés, dont 90 € avancés pour trois amis.
  let s = addReceivable(initState(base), { id: 'r1', person: 'Camille', amount: 6000, allocationId: 'd2#0' }, 1);
  s = addReceivable(s, { id: 'r2', person: 'Sacha', amount: 3000, allocationId: 'd2#0' }, 2);

  it('la part avancée sort du budget et devient une créance, comptée dans le patrimoine', () => {
    const db = applyState(base, s);
    expect(lineOf(db, 'd2').receivableAmount).toBe(9000);
    expect(compute(db, TODAY).spent).toBe(18000 + 3000 + 1200);
    expect(netWorth(db, TODAY)).toMatchObject({ receivables: 9000 });
    expect(checkIntegrity(db).errors).toEqual([]);
  });

  it('le virement de retour solde la créance et ne pèse rien ; il n’attend plus de décision', () => {
    const paid = structuredClone(base);
    op(paid, 'retour', 'carte', '2026-11-13', 6000, 'VIR INST CAMILLE', 'INCOME');
    expect(compute(applyState(paid, s), TODAY).pendingIncomes).toEqual([{ transactionId: 'retour', amount: 6000 }]);
    const settled = settleReceivable(s, 'r1', 'retour#0');
    const db = applyState(paid, settled);
    expect(lineOf(db, 'retour')).toMatchObject({ flow: 'REFUND', settlesReceivableId: 'r1', origin: 'manual' });
    const e = compute(db, TODAY);
    expect([e.spent, e.pendingIncomes, e.revenus]).toEqual([18000 + 3000 + 1200, [], 140000]);
    expect(netWorth(db, TODAY).receivables).toBe(3000);
  });

  it('abandonnée : la part redevient une dépense, le jour de l’abandon, pas à la date du restaurant', () => {
    const off = writeOffReceivable(s, 'r2', TODAY);
    const e = compute(applyState(base, off), TODAY);
    expect(e.spent).toBe(18000 + 3000 + 1200 + 3000);
    expect(e.spentToday).toBe(1200 + 3000);
    expect(netWorth(applyState(base, off), TODAY).receivables).toBe(6000);
  });
});

describe('moteur M3 : invariants des automatismes (200 jeux de données)', () => {
  it('l’appariement automatique ne change jamais la trésorerie ni le reste à vivre, et laisse le schéma intègre', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const db = randomDb(seed);
      op(db, 'ta', 'k1', '2026-11-08', -6100, 'VIR INTERNE', null);
      op(db, 'tb', 'k2', '2026-11-10', 6100, 'VIR RECU', null);
      const out = automate(db);
      expect(checkIntegrity(out).errors, `graine ${seed}`).toEqual([]);
      expect(lineOf(out, 'ta'), `graine ${seed}`).toMatchObject({ flow: 'TRANSFER', linkedTransactionId: 'tb' });
      const [a, b] = [compute(db, '2026-11-15'), compute(out, '2026-11-15')];
      expect([b.cash, b.rav], `graine ${seed}`).toEqual([a.cash, a.rav]);
      // Non appariée, la sortie non classée pesait comme une dépense : appariée, elle ne pèse plus (d'autres
      // opérations du jeu, de même montant sur deux comptes, peuvent s'apparier aussi : jamais l'inverse).
      expect(b.envelopes.reduce((x, y) => x + y.spent, 0), `graine ${seed}`).toBeLessThanOrEqual(a.envelopes.reduce((x, y) => x + y.spent, 0) - 6100);
    }
  });
});

describe('moteur M4 : catégories sur deux niveaux, fusion, tags, comptes, cycle', () => {
  function shop(): Db {
    const db = blank({ accounts: [account('k', 'CHECKING', 100000)], categories: [category('alim'), category('courses', 'alim'), category('restos'), category('bar'), category('revenu')] });
    db.categories.find((c) => c.id === 'revenu')!.scope = 'INCOME';
    db.envelopes.push(envelope('env:sorties', { cap: 10000, order: 1, categoryIds: ['restos'] }), envelope('env:bar', { cap: 3000, order: 2, categoryIds: ['bar'] }));
    op(db, 'a', 'k', '2026-11-03', -4000, 'SUPERMARCHE', 'EXPENSE', { categoryId: 'courses' });
    op(db, 'b', 'k', '2026-11-05', -2500, 'BISTROT', 'EXPENSE', { categoryId: 'restos' });
    op(db, 'c', 'k', '2026-11-07', -1500, 'COMPTOIR', 'EXPENSE', { categoryId: 'bar' });
    return db;
  }
  const spentIn = (db: Db, id: string) => compute(db, '2026-11-15').envelopes.find((x) => x.envelope.id === id)!.spent;

  it('deux niveaux au plus : une sous-catégorie a une parente de premier niveau, du même type', () => {
    const base = shop();
    let s = initState(base);
    const all = () => applyState(base, s).categories;
    s = saveCategory(s, { ...category('bio', 'courses'), name: '  Bio ' }, all());
    expect(all().find((c) => c.id === 'bio')).toMatchObject({ name: 'Bio', parentId: null });
    s = saveCategory(s, category('bio', 'alim'), all());
    expect(all().find((c) => c.id === 'bio')?.parentId).toBe('alim');
    // « alim » a des sous-catégories : elle ne peut pas en devenir une. Un revenu ne va pas sous une dépense.
    s = saveCategory(s, { ...all().find((c) => c.id === 'alim')!, parentId: 'restos' }, all());
    expect(all().find((c) => c.id === 'alim')?.parentId).toBeNull();
    s = saveCategory(s, { ...all().find((c) => c.id === 'revenu')!, parentId: 'alim' }, all());
    expect(all().find((c) => c.id === 'revenu')?.parentId).toBeNull();
    expect(checkIntegrity(applyState(base, s)).errors).toEqual([]);
  });

  it('une sous-catégorie suit l’enveloppe de sa parente ; la renommer ou la déplacer ne change aucun total', () => {
    const base = shop();
    let s = saveEnvelope(initState(base), envelope('env:alim', { cap: 20000, order: 3, categoryIds: ['alim'] }));
    expect(spentIn(applyState(base, s), 'env:alim')).toBe(4000);
    const total = compute(applyState(base, s), '2026-11-15').spent;
    s = saveCategory(s, { ...category('courses', 'alim'), name: 'Supermarché' }, applyState(base, s).categories);
    expect(compute(applyState(base, s), '2026-11-15').spent).toBe(total);
    // Sortie de sa parente : elle retombe dans l'enveloppe par défaut ; la somme ne bouge pas.
    s = saveCategory(s, category('courses'), applyState(base, s).categories);
    const e = compute(applyState(base, s), '2026-11-15');
    expect([spentIn(applyState(base, s), 'env:alim'), spentIn(applyState(base, s), 'env:default'), e.spent]).toEqual([0, 4000, total]);
  });

  it('fusionner : l’historique se lit comme celui de la cible, sans réécrire une seule opération', () => {
    const base = shop();
    let s = saveRule(initState(base), rule('r', { keywords: ['zinc'], categoryId: 'bar' }));
    s = mergeCategories(s, 'bar', 'restos', applyState(base, s).categories, 5);
    const db = applyState(base, s);
    expect(db.categories.find((c) => c.id === 'bar')).toMatchObject({ mergedIntoId: 'restos', archivedAt: 5 });
    // L'opération garde sa catégorie d'origine ; elle compte maintenant dans l'enveloppe de la cible.
    expect(lineOf(db, 'c').categoryId).toBe('bar');
    expect([spentIn(db, 'env:sorties'), spentIn(db, 'env:bar')]).toEqual([4000, 0]);
    expect(db.envelopes.find((e) => e.id === 'env:bar')?.categoryIds).toEqual([]);
    expect(db.rules[0]?.categoryId).toBe('restos');
    expect(compute(db, '2026-11-15').spent).toBe(compute(base, '2026-11-15').spent);
    expect(checkIntegrity(db).errors).toEqual([]);
    // Fusionner dans une catégorie elle-même fusionnée vise sa cible ; les sous-catégories suivent.
    s = mergeCategories(s, 'alim', 'bar', applyState(base, s).categories, 6);
    const after = applyState(base, s);
    expect(after.categories.find((c) => c.id === 'alim')?.mergedIntoId).toBe('restos');
    expect(after.categories.find((c) => c.id === 'courses')?.parentId).toBe('restos');
    expect(checkIntegrity(after).errors).toEqual([]);
    expect(mergeCategories(s, 'restos', 'revenu', after.categories, 7)).toBe(s);
  });

  it('archiver cache la catégorie et ses sous-catégories sans toucher aux totaux ; restaurer les ramène', () => {
    const base = shop();
    let s = archiveCategory(initState(base), 'alim', base.categories, 9);
    const db = applyState(base, s);
    expect(db.categories.filter((c) => c.archivedAt).map((c) => c.id)).toEqual(['alim', 'courses']);
    expect(compute(db, '2026-11-15').spent).toBe(8000);
    s = archiveCategory(s, 'alim', db.categories, null);
    expect(applyState(base, s).categories.filter((c) => c.archivedAt)).toEqual([]);
  });

  it('supprimer : seulement une catégorie qui ne sert à rien ; elle disparaît partout, même si elle vient de la reprise', () => {
    const base = shop();
    let s = saveCategory(initState(base), { ...category('vide'), name: 'Vide' }, base.categories);
    s = saveEnvelope(s, envelope('env:vide', { categoryIds: ['vide'] }));
    const db = applyState(base, s);
    // « alim » a une sous-catégorie, « restos » des opérations : elles servent. « vide » ne sert à rien.
    expect([categoryUse(db, 'alim') > 0, categoryUse(db, 'restos') > 0, categoryUse(db, 'vide')]).toEqual([true, true, 0]);
    s = removeCategory(s, 'vide', db.categories, 7);
    const after = applyState(base, s);
    expect(after.categories.some((c) => c.id === 'vide')).toBe(false);
    expect(after.envelopes.find((e) => e.id === 'env:vide')?.categoryIds).toEqual([]);
    expect(compute(after, '2026-11-15').spent).toBe(compute(base, '2026-11-15').spent);
    expect(checkIntegrity(after).errors).toEqual([]);
    expect(removeCategory(s, 'inconnue', after.categories, 8)).toBe(s);
  });

  it('les tags n’entrent dans aucun calcul ; supprimer un tag le retire des règles et des lignes', () => {
    const base = shop();
    let s = saveTag(initState(base), { id: 't:pro', name: 'Pro', archivedAt: null });
    s = patchAllocation(s, 'a#0', { tagIds: ['t:pro'] });
    s = saveRule(s, rule('r', { keywords: ['bistrot'], categoryId: 'restos', tagIds: ['t:pro'] }));
    const db = applyState(base, s);
    expect([lineOf(db, 'a').tagIds, lineOf(db, 'b').tagIds]).toEqual([['t:pro'], ['t:pro']]);
    expect(compute(db, '2026-11-15')).toMatchObject({ spent: 8000 });
    s = removeTag(s, 't:pro');
    const gone = applyState(base, s);
    expect([gone.tags, lineOf(gone, 'a').tagIds, gone.rules[0]?.tagIds]).toEqual([[], [], []]);
  });

  it('un compte créé à la main compte selon ses réglages ; le cycle, le mode et les tolérances sont des réglages', () => {
    const base = reference();
    let s = addAccount(initState(base), account('especes', 'CASH', 4000, { source: 'manual' }));
    expect(compute(applyState(base, s), TODAY).cash).toBe(51100 + 4000);
    s = addAccount(s, account('pret', 'LIABILITY', 300000, { source: 'manual' }));
    expect(netWorth(applyState(base, s), TODAY).debts).toBe(300000);
    // Jour de paie au 1er : le cycle change, donc ce qui y tombe aussi.
    s = patchSettings(s, { payday: 1, openingCommitmentId: null });
    expect(compute(applyState(base, s), TODAY).cycle).toEqual({ start: '2026-11-01', end: '2026-11-30' });
    s = patchSettings(s, { payday: 26, mode: 'CASH' });
    const e = compute(applyState(base, s), TODAY);
    expect([e.mode, e.limitedBy]).toEqual(['CASH', 'cash']);
  });
});

describe('moteur M5 : saisie à la main, ventilation', () => {
  const manual = (id: string, accountId: string, date: string, amount: number, label: string): Transaction => ({ id, accountId, date, valueDate: null, amount, rawLabel: label, pending: false, source: 'manual', merchantId: null, createdAt: 0 });

  it('en espèces : la dépense pèse dans le budget et sort du portefeuille ; la retirer remet tout en place', () => {
    const base = plain();
    base.categories = [category('restos')];
    let s = addAccount(initState(base), account('especes', 'CASH', 4000, { source: 'manual' }));
    const wallet = () => applyState(base, s).accounts.find((a) => a.id === 'especes')!;
    const before = compute(applyState(base, s), TODAY);
    s = addManual(s, { transaction: manual('m1', 'especes', TODAY, -450, 'Café'), flow: 'EXPENSE', categoryId: 'restos' }, wallet());
    const db = applyState(base, s);
    expect(checkIntegrity(db).errors).toEqual([]);
    expect(lineOf(db, 'm1')).toMatchObject({ flow: 'EXPENSE', categoryId: 'restos', origin: 'manual' });
    expect(wallet().balance).toBe(3550);
    const e = compute(db, TODAY);
    expect([e.spent, e.cash]).toEqual([before.spent + 450, before.cash - 450]);
    s = removeManual(s, 'm1', wallet());
    expect([wallet().balance, compute(applyState(base, s), TODAY).spent]).toEqual([4000, before.spent]);
  });

  it('sur un compte suivi par la banque : la saisie attend l’opération réelle, puis s’efface devant elle sans être comptée deux fois', () => {
    const base = plain();
    base.categories = [category('courses')];
    let s = initState(base);
    const carte = base.accounts.find((a) => a.id === 'carte')!;
    s = addManual(s, { transaction: manual('m2', 'carte', TODAY, -2300, 'Marché'), flow: 'EXPENSE', categoryId: 'courses' }, carte);
    s = patchAllocation(s, 'm2#0', { smoothed: true });
    // La banque n'a pas encore envoyé l'opération : la saisie compte, le solde bancaire ne bouge pas.
    const waiting = compute(applyState(base, s), TODAY);
    expect([waiting.spent, waiting.cash]).toEqual([31200 + 2300, 51100]);
    // Deux jours plus tard, la banque l'envoie (libellé différent, même montant) : une seule opération reste.
    const arrived = structuredClone(base);
    op(arrived, 'b9', 'carte', '2026-11-17', -2300, 'CB MARCHE BIO 1711', null);
    const db = applyState(arrived, s);
    expect(db.transactions.some((t) => t.id === 'm2')).toBe(false);
    expect(lineOf(db, 'b9')).toMatchObject({ flow: 'EXPENSE', categoryId: 'courses', origin: 'manual', smoothed: true });
    expect(compute(db, '2026-11-17').spent).toBe(31200 + 2300);
    expect(checkIntegrity(db).errors).toEqual([]);
    // Un autre montant ou une date trop lointaine : ce n'est pas la même, les deux restent.
    const other = structuredClone(base);
    op(other, 'b8', 'carte', '2026-11-25', -2300, 'CB MARCHE', null);
    expect(applyState(other, s).transactions.filter((t) => t.id === 'm2' || t.id === 'b8')).toHaveLength(2);
  });

  it('ventiler un ticket : ses parts remplacent sa ligne, somme exacte, chacune dans son enveloppe', () => {
    const base = plain();
    base.categories = [category('courses'), category('maison')];
    let s = saveEnvelope(initState(base), envelope('env:maison', { cap: 20000, inDailyBudget: false, order: 1, categoryIds: ['maison'] }));
    s = setSplit(s, 'd1', [{ categoryId: 'courses', amount: -12000 }, { categoryId: 'maison', amount: -6000 }]);
    const db = applyState(base, s);
    expect(db.allocations.filter((a) => a.transactionId === 'd1').map((a) => [a.id, a.amount, a.categoryId])).toEqual([['d1#0', -12000, 'courses'], ['d1#1', -6000, 'maison']]);
    expect(checkIntegrity(db).errors).toEqual([]);
    const e = compute(db, TODAY);
    expect([e.spent, e.envelopes.find((x) => x.envelope.id === 'env:maison')?.spent]).toEqual([31200 - 6000, 6000]);
    // Des parts qui ne font pas le montant sont ignorées ; une seule part retire la ventilation.
    expect(applyState(base, setSplit(s, 'd1', [{ categoryId: 'courses', amount: -1 }, { categoryId: 'maison', amount: -2 }])).allocations.filter((a) => a.transactionId === 'd1')).toHaveLength(1);
    expect(setSplit(s, 'd1', []).splits).toEqual({});
  });
});

describe('moteur M5 : ce que montrent les écrans', () => {
  function shown(): Db {
    const db = plain();
    db.categories = [category('alim'), category('courses', 'alim'), category('restos')];
    db.merchants = [{ id: 'm:super', name: 'Supermarché', flow: 'EXPENSE', categoryId: 'courses', tagIds: [] }];
    lineOf(db, 'd1').categoryId = 'courses';
    db.transactions.find((t) => t.id === 'd1')!.merchantId = 'm:super';
    lineOf(db, 'd2').categoryId = 'restos';
    op(db, 'rb', 'carte', '2026-11-12', 2000, 'AVOIR', 'REFUND', { categoryId: 'restos' });
    op(db, 'old', 'carte', '2026-10-10', -9000, 'SUPERMARCHE', 'EXPENSE', { categoryId: 'courses' });
    return db;
  }

  it('dépenses jour par jour (vue budget) et par catégorie de premier niveau (vue analyse)', () => {
    const db = shown();
    const cycles = lastCycles(db, TODAY, 2);
    expect(cycles).toEqual([{ start: '2026-09-26', end: '2026-10-25' }, { start: '2026-10-26', end: '2026-11-25' }]);
    const days = spendByDay(db, settledIn(db, cycles), '2026-11-01', TODAY);
    expect([...days]).toEqual([['2026-11-03', 18000], ['2026-11-10', 12000], ['2026-11-15', 1200], ['2026-11-12', -2000]]);
    // « Courses » compte pour sa parente ; le remboursement réduit « Restos » ; le loyer payé est une dépense aussi.
    expect(byCategory(db, '2026-10-26', TODAY).map((x) => [x.name, x.amount])).toEqual([['À classer', 41200], ['alim', 18000], ['restos', 10000]]);
    expect(topMerchants(db, '2026-10-26', TODAY, 1)).toMatchObject([{ name: 'PRLV LOYER AGENCE', amount: 40000 }]);
  });

  it('rythme du cycle : cumul jour après jour, écart au rythme idéal, projection, cycle précédent', () => {
    const db = shown();
    const e = compute(db, TODAY);
    const r = pace(db, e, TODAY);
    // Le cumul d'aujourd'hui est ce que le moteur compte comme dépensé ; un remboursement le fait redescendre.
    expect([r.length, r.day, r.spent, r.pot]).toEqual([31, 21, e.spent, e.pot]);
    expect(r.current.slice(8, 10)).toEqual([0, 18000]);
    expect(r.current.slice(16, 19)).toEqual([30000, 30000, 28000]);
    // Rythme idéal au 21e jour sur 31 : 880 € × 21 / 31 ; 292 € dépensés : de l'avance.
    expect([r.ideal, r.gap, r.projected]).toEqual([59613, 30413, 43105]);
    expect([r.previousSameDay, r.previousTotal, r.previous.length]).toEqual([9000, 9000, 31]);
    // Sans cycle précédent connu : pas de courbe de comparaison.
    const alone = pace({ ...db, transactions: db.transactions.filter((t) => t.date >= e.cycle.start) }, e, TODAY);
    expect([alone.previous, alone.previousSameDay]).toEqual([[], null]);
  });

  it('simulateur d’un placement : intérêts composés, nets de frais d’entrée et de gestion', () => {
    const base = { monthly: 10000, rateBp: 500, years: 10, entryFeeBp: 0, annualFeeBp: 0 };
    // Sans rendement ni frais : la valeur est exactement ce qui a été versé.
    const flat = simulate(100000, { ...base, rateBp: 0 });
    expect(flat.map((p) => p.year)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(flat[10]).toEqual({ year: 10, paid: 1300000, value: 1300000, gains: 0, fees: 0 });
    // 1 000 € placés à 5 % par an, composés chaque mois, sans versement : 1 000 × (1 + 0,05/12)^120.
    expect(simulate(100000, { ...base, monthly: 0 })[10]!.value).toBe(Math.round(100000 * (1 + 0.05 / 12) ** 120));
    // Les frais : versé + plus-values + coût des frais = la valeur sans aucun frais.
    const free = simulate(100000, base)[10]!;
    const charged = simulate(100000, { ...base, entryFeeBp: 200, annualFeeBp: 100 })[10]!;
    expect(charged.value).toBeLessThan(free.value);
    expect(charged.paid + charged.gains + charged.fees).toBe(free.value);
    expect(charged.paid).toBe(free.paid);
    // Frais d'entrée seuls, sans rendement : 2 % de chaque versement sont perdus, le capital de départ est intact.
    expect(simulate(100000, { ...base, rateBp: 0, entryFeeBp: 200 })[10]).toMatchObject({ value: 1276000, fees: 24000, gains: -24000 });
    // Le patrimoine : chaque placement suit sa simulation, le reste ne bouge pas.
    expect(projectAccounts(500000, [{ value: 100000, sim: { ...base, rateBp: 0 } }], 10)).toBe(500000 + 1200000);
    expect(projectAccounts(500000, [{ value: 100000, sim: base }], 10, 200)).toBeGreaterThan(projectAccounts(500000, [{ value: 100000, sim: base }], 10));
  });

  it('revenus et dépenses par cycle ; ni l’épargne ni les virements n’y entrent', () => {
    const db = shown();
    expect(cashflow(db, lastCycles(db, TODAY, 2), TODAY).map((x) => [x.income, x.expense])).toEqual([[0, 9000], [140000, 40000 + 18000 + 12000 + 1200 - 2000]]);
  });

  it('prévision : le solde descend aux échéances et au rythme du budget du jour ; le point bas est repéré', () => {
    const db = reference();
    const e = compute(db, TODAY);
    const { points, low } = forecast(db, e);
    expect(points).toHaveLength(11);
    expect(points[0]).toMatchObject({ date: TODAY, balance: 51100 - Math.max(0, e.resteAujourdhui) });
    // Le 20 : le forfait (20 €) et l'échéance du 4x (161 €) sortent, réservés ou non.
    expect(points.find((p) => p.date === '2026-11-20')?.events).toEqual([{ label: 'Échéance 4x', amount: -16100 }, { label: 'Forfait mobile', amount: -2000 }]);
    expect(low.date).toBe('2026-11-25');
    expect(low.balance).toBe(51100 - Math.max(0, e.resteAujourdhui) - 18100 - e.demain * 10);
  });

  it('projection du patrimoine : seule la part placée rapporte ; sans rendement, c’est une simple addition', () => {
    expect(project(1000000, 0, 10000, 0, 1)).toBe(1000000 + 120000);
    expect(project(1000000, 400000, 0, 0, 5)).toBe(1000000);
    const grown = project(1000000, 400000, 10000, 500, 10);
    expect(grown).toBeGreaterThan(1000000 + 1200000);
    expect(project(1000000, 400000, 10000, 500, 10)).toBe(grown);
  });
});
