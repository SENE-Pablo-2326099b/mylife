import { describe, expect, it } from 'vitest';
import { migrate } from '../app/src/modules/finances/core/migrate';
import { compute, envelopeOf, netWorth, weight } from '../app/src/modules/finances/engine/engine';
import { fromV3 } from '../app/src/modules/finances/engine/fromV3';
import { checkIntegrity } from '../app/src/modules/finances/engine/integrity';
import { buildOccurrences, currentCycle, dueDates } from '../app/src/modules/finances/engine/occurrences';
import { DEFAULT_SETTINGS, EMPTY_DB, roleDefaults, type Account, type Allocation, type Commitment, type Db, type Envelope, type Flow, type Role, type Transaction } from '../app/src/modules/finances/engine/schema';

/** Le moteur financier de MyFinances V5 (étape M1) : scénario de référence, cas limites, invariants. */

const account = (id: string, role: Role, balance: number | null, over: Partial<Account> = {}): Account => ({ id, name: id, provider: '', role, ...roleDefaults(role), currency: 'EUR', ownershipRatio: 1, alertThreshold: null, deferredDebit: null, source: 'bank', balance, balanceAt: null, archivedAt: null, ...over });
const commitment = (id: string, kind: Commitment['kind'], label: string, amount: number, anchorDay: number | null, over: Partial<Commitment> = {}): Commitment => ({ id, kind, label, amount, tolerance: 0.2, rhythm: 'MONTHLY', anchorDay, anchorDate: null, accountId: null, counterAccountId: null, categoryId: null, startDate: null, endDate: null, remainingOccurrences: null, installmentPlanId: null, direct: false, paused: false, ...over });
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
    // À payer : le forfait (20 €) + l'échéance du 4x (161 €) − la part déjà en poche (161 €).
    expect(e.covered).toBe(16100);
    expect(e.toPay).toBe(2000);
    expect(e.cashLibre).toBe(51100 - 16100 - 2000);
    // Sans la poche : rien de verrouillé, l'échéance entière reste à payer. Même cash libre, au centime.
    expect(compute({ ...db, provisions: [] }, TODAY).cashLibre).toBe(e.cashLibre);
    // Une poche libre du même montant, elle, s'ajoute à l'échéance : 161 € de moins.
    const free = { ...db, provisions: [{ ...db.provisions[0]!, installmentPlanId: null }] };
    expect(compute(free, TODAY).cashLibre).toBe(e.cashLibre - 16100);
  });

  it('disponible = le plus petit du budget et de la trésorerie ; budget du jour gelé à minuit', () => {
    // À minuit : budget 71 900 − 30 000 = 41 900 ; trésorerie 33 000 + 1 200 dépensés depuis = 34 200.
    expect(e.limitedBy).toBe('cash');
    expect(e.disponible).toBe(34200);
    expect(e.marge).toBe(34200 - 41900);
    expect(e.budgetJour).toBe(Math.round(34200 / 11));
    expect(e.resteAujourdhui).toBe(e.budgetJour - 1200);
    expect(e.demain).toBe(Math.round((34200 - 1200) / 10));
    expect(e.deficit).toBe(0);
  });

  it('mode cash : la trésorerie seule ; avec plus de trésorerie que de budget, le budget tient et la marge se montre', () => {
    expect(compute({ ...db, settings: { ...db.settings, mode: 'CASH' } }, TODAY).disponible).toBe(34200);
    const rich = { ...db, accounts: db.accounts.map((a) => (a.id === 'carte' ? { ...a, balance: 90000 } : a)) };
    const r = compute(rich, TODAY);
    expect([r.limitedBy, r.disponible, r.marge]).toEqual(['budget', 41900, 34200 + 75000 - 41900]);
    expect(compute({ ...rich, settings: { ...rich.settings, mode: 'CASH' } }, TODAY).disponible).toBe(34200 + 75000);
  });

  it('patrimoine net : les comptes, moins ce qu’il reste à payer du 4x', () => {
    expect(netWorth(db)).toEqual({ assets: 251100, debts: 0, receivables: 0, installments: 32200, net: 218900 });
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
    expect(smoothed.budgetJour).toBe(Math.round((34200 - 5000) / 11));
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
    expect(base.cashLibre).toBe(33000 - 10000);
    // 40 € dépensés dans l'enveloppe : il y reste 60 €, et le quotidien n'a pas bougé.
    op(db, 's1', 'carte', '2026-11-05', -4000, 'BOUTIQUE', 'EXPENSE', { categoryId: 'shopping' });
    const some = compute(db, TODAY);
    expect([some.spent, some.offDaily]).toEqual([base.spent, 6000]);
    // 200 € : dépassée de 100 €. Le reste est borné à 0 : le dépassement ne crée pas de cash libre.
    op(db, 's2', 'carte', '2026-11-06', -16000, 'BOUTIQUE', 'EXPENSE', { categoryId: 'shopping' });
    const over = compute(db, TODAY);
    expect(over.offDaily).toBe(0);
    expect(over.envelopes.find((x) => x.envelope.id === 'env:shopping')).toMatchObject({ spent: 20000, remaining: 0 });
    expect(over.cashLibre).toBe(33000);
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
    commitments: [commitment('inc', 'INCOME', 'Salaire', 150000 + Math.floor(r() * 100000), 26), commitment('ch', 'CHARGE', 'Loyer', 30000 + Math.floor(r() * 40000), 2), commitment('sv', 'SAVING', 'Livret', Math.floor(r() * 30000), 28)],
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
    expect([e.cash, e.cashLibre]).toEqual([120000, 120000]);
    expect(e.limitedBy).toBe('budget');
  });
});
