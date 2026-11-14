import { describe, expect, it } from 'vitest';
import { dayBudget, netWorth, perCycle, planTotals, position } from '../app/src/modules/finances/core/budget';
import { classifyMerchant, merchantKey, toClassify } from '../app/src/modules/finances/core/merchants';
import { mergeImport, migrate, type OldDump } from '../app/src/modules/finances/core/migrate';
import { EMPTY, type FinanceData, type Movement } from '../app/src/modules/finances/core/model';

/** MyFinances V5 : le nouveau modèle (compte, mouvement, marchand, prévu), ses calculs et la reprise de l'ancien. */

const tx = (id: string, amount: number, label: string, categoryId: string | null, extra: Record<string, unknown> = {}) => ({ id, accountId: 'acc', date: '2026-11-10', amount, label, categoryId, ...extra });

const OLD: OldDump = {
  accounts: [
    { id: 'acc', name: 'Compte courant', bank: 'Banque', balance: 150000, kind: 'current' },
    { id: 'liv', name: 'Livret', bank: 'Banque', balance: 500000, kind: 'savings', nickname: 'Mon livret' },
  ],
  categories: [
    { id: 'courses', name: 'Courses', kind: 'variable', target: 30000, order: 0 },
    { id: 'restos', name: 'Restos', kind: 'variable', order: 1 },
    { id: 'logement', name: 'Logement', kind: 'fixed', order: 2 },
    { id: 'revenus', name: 'Revenus', kind: 'income', order: 3 },
    { id: 'transferts', name: 'Transferts internes', kind: 'excluded', order: 4 },
    { id: 'epargne', name: 'Épargne', kind: 'excluded', order: 5 },
    { id: 'remboursements', name: 'Entre amis', kind: 'excluded', order: 6 },
  ],
  transactions: [
    tx('t1', -1890, 'CB CARREFOUR CITY 4821', 'courses'),
    tx('t2', -2500, 'CARREFOUR CITY', 'courses'),
    tx('t3', -900, 'Carrefour City', 'restos', { categorySource: 'manual' }),
    tx('t4', -72000, 'PRLV SEPA BAILLEUR', 'logement'),
    tx('t5', 210000, 'VIR EMPLOYEUR', 'revenus'),
    tx('t6', -15000, 'VIR VERS LIVRET', 'transferts', { transferPairId: 'p1' }),
    { ...tx('t7', 15000, 'VIR DEPUIS COMPTE', 'transferts', { transferPairId: 'p1' }), accountId: 'liv' },
    tx('t8', -20000, 'PRLV COURTIER PEA', 'epargne'),
    tx('t9', 2200, 'VIR AMI', 'remboursements', { person: 'Ami' }),
    tx('t10', -3160, 'SUMUP *LE COMPTOIR', null),
    tx('t11', 500, 'CARREFOUR CITY', 'courses'),
    tx('t12', 4000, 'VIR INCONNU', null),
  ],
  settings: { payday: 28, incomes: [{ id: 'i1', label: 'Salaire', amount: 210000, day: 28 }], fixedCharges: [{ id: 'c1', label: 'Loyer', amount: 72000, day: 2 }], savings: { mode: 'auto', manual: 0 } },
  portfolios: [{ id: 'pea', name: 'PEA', provider: 'Courtier', kind: 'broker', wrapper: 'PEA' }],
  holdings: [{ id: 'h1', portfolioId: 'pea', name: 'ETF Monde', assetClass: 'etf', symbol: null, quoteSource: 'manual', isin: null, price: 50000, priceAt: 1, order: 0, createdAt: 0 }],
  investmentOps: [
    { id: 'o1', holdingId: 'h1', date: '2026-01-05', type: 'buy', quantity: 10, amount: 400000, estimated: false, note: '', createdAt: 0, planId: 'pl1' },
    { id: 'o2', holdingId: 'h1', date: '2026-06-05', type: 'sell', quantity: 5, amount: 250000, estimated: false, note: '', createdAt: 1 },
  ],
  plans: [{ id: 'pl1', holdingId: 'h1', amount: 5000, frequency: 'weekly', day: 1, active: true }],
  goals: [{ id: 'g1', name: 'Voyage', target: 200000, monthly: 15000, includeInBudget: true, linkKind: 'account', linkId: 'liv' }],
  manualAssets: [
    { id: 'car', name: 'Voiture', kind: 'asset', value: 600000 },
    { id: 'loan', name: 'Prêt', kind: 'debt', value: 399000 },
  ],
};

describe('MyFinances V5 : marchands', () => {
  it('du libellé bancaire au marchand', () => {
    expect(merchantKey('CB CARREFOUR CITY 4821 PARIS 11')).toBe('carrefour city paris');
    expect(merchantKey('Carrefour City')).toBe('carrefour city');
    expect(merchantKey('SUMUP *LE COMPTOIR')).toBe('le comptoir');
    expect(merchantKey('PRLV SEPA 123456')).toBeNull();
  });
});

describe('MyFinances V5 : reprise de l’ancienne app', () => {
  const data = migrate(OLD);
  const mv = (id: string) => data.movements.find((m) => m.id === id)!;

  it('comptes : banque, placements, biens et dettes dans un seul concept', () => {
    expect(data.accounts.map((a) => [a.id, a.family, a.name])).toEqual([
      ['acc', 'quotidien', 'Compte courant'],
      ['liv', 'epargne', 'Mon livret'],
      ['pf:pea', 'placements', 'PEA'],
      ['as:car', 'biens', 'Voiture'],
      ['as:loan', 'dettes', 'Prêt'],
    ]);
  });

  it('la nature se déduit de l’ancienne catégorie ; seules les dépenses gardent une catégorie', () => {
    expect([mv('t1').nature, mv('t1').categoryId]).toEqual(['depense', 'courses']);
    expect([mv('t4').nature, mv('t4').categoryId]).toEqual(['depense', 'logement']);
    expect([mv('t5').nature, mv('t5').categoryId]).toEqual(['revenu', null]);
    expect(mv('t6')).toMatchObject({ nature: 'virement', otherAccountId: 'liv', saving: true, pairId: 'p1', categoryId: null });
    expect(mv('t7')).toMatchObject({ nature: 'virement', otherAccountId: 'acc', saving: false });
    expect(mv('t8')).toMatchObject({ nature: 'virement', saving: true, otherAccountId: 'pf:pea' });
    expect(mv('t9')).toMatchObject({ nature: 'remboursement', person: 'Ami', categoryId: null });
    expect([mv('t10').nature, mv('t10').categoryId]).toEqual(['depense', null]);
    expect([mv('t11').nature, mv('t11').categoryId]).toEqual(['remboursement', 'courses']);
    expect(mv('t12').nature).toBeNull();
  });

  it('catégories : seulement celles de dépense, avec leur budget', () => {
    expect(data.categories.map((c) => [c.id, c.fixed, c.budget])).toEqual([
      ['courses', false, 30000],
      ['restos', false, null],
      ['logement', true, null],
    ]);
  });

  it('marchands : la majorité décide ; une exception corrigée à la main reste une exception', () => {
    const m = data.merchants.find((x) => x.id === 'm:carrefour city')!;
    expect(m).toMatchObject({ name: 'Carrefour City', nature: 'depense', categoryId: 'courses' });
    expect(mv('t3')).toMatchObject({ categoryId: 'restos', edited: true });
    expect(mv('t2').edited).toBe(false);
  });

  it('prévu : revenus, charges, investissements programmés et objectifs dans une seule liste', () => {
    expect(data.planned.map((p) => [p.id, p.kind, p.amount, p.rhythm])).toEqual([
      ['inc:i1', 'revenu', 210000, 'monthly'],
      ['chg:c1', 'charge', 72000, 'monthly'],
      ['plan:pl1', 'epargne', 5000, 'weekly'],
      ['goal:g1', 'epargne', 15000, 'monthly'],
    ]);
    expect(data.planned.find((p) => p.id === 'plan:pl1')).toMatchObject({ accountId: 'pf:pea', holdingId: 'h1' });
    expect(data.settings.payday).toBe(28);
  });

  it('rejouable : mêmes entrées, mêmes sorties', () => {
    expect(migrate(OLD)).toEqual(data);
  });

  it('à classer : groupé par marchand, le plus gros d’abord', () => {
    expect(toClassify(data).map((g) => [g.name, g.movements.length, g.total])).toEqual([
      ['Inconnu', 1, 4000],
      ['Le Comptoir', 1, 3160],
    ]);
  });

  it('classer un marchand classe ses mouvements, sauf ceux corrigés un par un', () => {
    const next = classifyMerchant(data, 'm:carrefour city', { nature: 'depense', categoryId: 'restos' });
    const of = (id: string) => next.movements.find((m) => m.id === id)!;
    expect(of('t1').categoryId).toBe('restos');
    expect(of('t11')).toMatchObject({ nature: 'remboursement', categoryId: 'restos' });
    expect(next.merchants.find((m) => m.id === 'm:carrefour city')).toMatchObject({ categoryId: 'restos', edited: true });
    const done = classifyMerchant(next, 'm:le comptoir', { nature: 'depense', categoryId: 'restos' });
    expect(toClassify(done).map((g) => g.name)).toEqual(['Inconnu']);
  });

  it('rejouer la reprise garde ce qui a été fait dans le nouveau module', () => {
    const worked = classifyMerchant(data, 'm:le comptoir', { nature: 'depense', categoryId: 'restos' });
    const manual: Movement = { id: 'n:1', accountId: 'acc', date: '2026-11-12', amount: -450, label: 'Café', merchantId: null, nature: 'depense', categoryId: 'restos', note: '', pending: false, source: 'manual', edited: true, createdAt: 1 };
    const again = mergeImport({ ...worked, movements: [...worked.movements, manual] }, migrate({ ...OLD, transactions: [...OLD.transactions!, tx('t13', -1200, 'SUMUP *LE COMPTOIR', null)] }));
    const of = (id: string) => again.movements.find((m) => m.id === id);
    expect(of('t10')?.categoryId).toBe('restos');
    expect(of('t13')?.categoryId).toBe('restos');
    expect(of('n:1')).toEqual(manual);
    expect(of('t3')).toMatchObject({ categoryId: 'restos', edited: true });
  });
});

describe('MyFinances V5 : budget et patrimoine', () => {
  const data = migrate(OLD);

  it('une ligne prévue ramenée au cycle', () => {
    expect(perCycle({ amount: 5000, rhythm: 'weekly' })).toBe(21667);
    expect(perCycle({ amount: 5000, rhythm: 'biweekly' })).toBe(10833);
    expect(perCycle({ amount: 5000, rhythm: 'monthly' })).toBe(5000);
  });

  it('reste à vivre = revenus − charges − épargne', () => {
    expect(planTotals(data.planned)).toEqual({ revenus: 210000, charges: 72000, epargne: 36667, resteAVivre: 101333 });
  });

  it('budget du jour : dépenses de vie courante seulement, remboursements déduits', () => {
    const b = dayBudget(data, '2026-11-12');
    expect(b.cycle).toEqual({ start: '2026-10-28', end: '2026-11-27' });
    // Courses 18,90 + 25,00 + 9,00 (restos) + 31,60 (à classer, compté) − 5,00 d'avoir = 79,50 ; loyer, virements et ami : hors budget.
    expect(b.spent).toBe(7950);
    expect(b.spentToday).toBe(0);
    expect(b.daysLeft).toBe(16);
    expect(b.daily).toBe(Math.round((101333 - 7950) / 16));
    expect(b.leftToday).toBe(b.daily);
    expect(b.remaining).toBe(101333 - 7950);
  });

  it('budget du jour : ce qui est dépensé aujourd’hui se retire d’aujourd’hui, pas des autres jours', () => {
    const b = dayBudget(data, '2026-11-10');
    expect(b.spentToday).toBe(7950);
    expect(b.daily).toBe(Math.round(101333 / 18));
    expect(b.leftToday).toBe(b.daily - 7950);
  });

  it('une dépense ventilée ne compte que ses parts de vie courante', () => {
    const split: FinanceData = { ...data, movements: data.movements.map((m) => (m.id === 't1' ? { ...m, split: [{ categoryId: 'courses', amount: -890 }, { categoryId: 'logement', amount: -1000 }] } : m)) };
    expect(dayBudget(split, '2026-11-12').spent).toBe(7950 - 1000);
  });

  it('position d’une ligne : prix de revient moyen, vente au prorata', () => {
    const p = position(data.holdings[0]!, data.investmentOps);
    expect(p).toMatchObject({ quantity: 5, invested: 200000, value: 250000, gain: 50000 });
  });

  it('patrimoine : la somme des comptes, moins les dettes', () => {
    expect(netWorth(data)).toEqual({ byFamily: { quotidien: 150000, epargne: 500000, placements: 250000, biens: 600000, dettes: 399000 }, gross: 1500000, net: 1101000 });
  });

  it('compte neuf : tout à zéro, rien ne plante', () => {
    expect(dayBudget(EMPTY, '2026-11-12')).toMatchObject({ spent: 0, daily: 0, leftToday: 0, used: 0 });
    expect(netWorth(EMPTY).net).toBe(0);
    expect(toClassify(EMPTY)).toEqual([]);
  });
});
