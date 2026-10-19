import { describe, expect, it } from 'vitest';
import type { Account, Goal, Holding, InvestmentOp, InvestmentPlan, Portfolio } from '../src/db/types';
import { dueOperations, monthlyEquivalent, nextOccurrence, occurrences, plannedMonthlySavings } from '../src/domain/plans';
import { cashHistory, goalProgress, netWorth, position, summarizePortfolio, wealthHistory } from '../src/domain/wealth';
import { runDuePlans, refreshPlannedSavings } from '../src/domain/wealthDb';
import { getSettings } from '../src/db/seed';
import { freshDb, tx } from './helpers';

const H: Holding = { id: 'h', portfolioId: 'p', name: 'ETF', assetClass: 'etf', symbol: 'CW8.PA', quoteSource: 'yahoo', isin: null, price: 50000, priceAt: 0, order: 0, createdAt: 0 };
const P: Portfolio = { id: 'p', name: 'PEA', provider: 'Trade Republic', kind: 'broker', wrapper: 'PEA', order: 0, createdAt: 0 };
let n = 0;
const op = (o: Partial<InvestmentOp> & Pick<InvestmentOp, 'type' | 'amount'>): InvestmentOp => ({ id: `o${n++}`, holdingId: 'h', date: '2026-01-01', quantity: 0, planId: null, estimated: false, note: '', createdAt: n, ...o });

describe('positions (prix de revient moyen pondéré)', () => {
  it('achats, vente au PRU, dividendes et frais', () => {
    const ops = [
      op({ type: 'buy', quantity: 2, amount: 80000, date: '2026-01-01' }),
      op({ type: 'buy', quantity: 2, amount: 120000, date: '2026-02-01' }),
      op({ type: 'sell', quantity: 1, amount: 55000, date: '2026-03-01' }),
      op({ type: 'dividend', amount: 1200 }),
      op({ type: 'fee', amount: 200 }),
    ];
    const p = position(H, ops);
    expect(p.quantity).toBe(3);
    expect(p.invested).toBe(150000); // 200 000 − ¼ au PRU de 500 €
    expect(p.averageCost).toBe(50000);
    expect(p.value).toBe(150000);
    expect(p.gain).toBe(0);
    expect(p.income).toBe(1000);
  });

  it('pas de poussière flottante sur les quantités (crypto)', () => {
    const ops = [op({ type: 'buy', quantity: 0.1, amount: 100 }), op({ type: 'buy', quantity: 0.2, amount: 100 })];
    expect(position({ ...H, price: null }, ops).quantity).toBe(0.3);
  });

  it('sans cours : valeur inconnue, comptée au coût de revient dans le portefeuille', () => {
    const s = summarizePortfolio(P, [{ ...H, price: null }], [op({ type: 'buy', quantity: 1, amount: 70000 })]);
    expect(s.positions[0]?.value).toBeNull();
    expect(s.value).toBe(70000);
    expect(s.missingPrices).toBe(1);
  });

  it('patrimoine net = comptes + placements + biens − dettes (comptes masqués exclus)', () => {
    const acc = (id: string, balance: number, hidden = false) => ({ id, balance, hidden }) as Account;
    const s = summarizePortfolio(P, [H], [op({ type: 'buy', quantity: 2, amount: 90000 })]);
    const w = netWorth([acc('a', 120000), acc('b', 5000), acc('c', 99999, true)], [s], [
      { id: 'car', name: 'Voiture', kind: 'asset', emoji: '', value: 500000, updatedAt: 0 },
      { id: 'loan', name: 'Prêt', kind: 'debt', emoji: '', value: 200000, updatedAt: 0 },
    ]);
    expect(w).toEqual({ cash: 125000, investments: 100000, invested: 90000, other: 500000, debts: 200000, total: 525000 });
  });
});

describe('historique', () => {
  it('solde bancaire reconstitué à rebours', () => {
    const accounts = [{ id: 'a', balance: 10000, hidden: false } as Account];
    const txs = [tx({ id: '1', accountId: 'a', date: '2026-10-02', amount: -3000 }), tx({ id: '2', accountId: 'a', date: '2026-10-04', amount: 5000 }), tx({ id: '3', accountId: 'a', date: '2026-10-06', amount: -1000 })];
    const h = cashHistory(accounts, txs, '2026-10-01', '2026-10-05');
    expect(h.map((x) => x.cash)).toEqual([9000, 6000, 6000, 11000, 11000]);
  });

  it('photos quotidiennes quand elles existent, estimation avant', () => {
    const worth = { cash: 1000, investments: 0, invested: 0, other: 0, debts: 0, total: 1000 };
    const h = wealthHistory({
      from: '2026-10-01',
      to: '2026-10-03',
      snapshots: [{ date: '2026-10-03', cash: 1000, investments: 5000, invested: 4000, other: 0, debts: 0 }],
      cash: [{ date: '2026-10-01', cash: 800 }, { date: '2026-10-02', cash: 900 }, { date: '2026-10-03', cash: 1000 }],
      ops: [op({ type: 'buy', amount: 4000, date: '2026-10-02' })],
      worth,
    });
    expect(h).toEqual([
      { date: '2026-10-01', total: 800, estimated: true },
      { date: '2026-10-02', total: 4900, estimated: true },
      { date: '2026-10-03', total: 6000, estimated: false },
    ]);
  });
});

describe('investissements programmés', () => {
  const plan: InvestmentPlan = { id: 'pl', holdingId: 'h', amount: 15000, frequency: 'monthly', day: 31, startDate: '2026-01-10', active: true, lastRunDate: null, createdAt: 0 };

  it('mensuel : le 31 tombe le dernier jour des mois courts', () => {
    expect(occurrences(plan, '2026-01-01', '2026-04-30')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });

  it('hebdomadaire et toutes les 2 semaines, jamais avant le début', () => {
    const w = { frequency: 'weekly' as const, day: 1, startDate: '2026-10-07' };
    expect(occurrences(w, '2026-10-01', '2026-10-31')).toEqual(['2026-10-12', '2026-10-19', '2026-10-26']);
    expect(occurrences({ ...w, frequency: 'biweekly' }, '2026-10-01', '2026-10-31')).toEqual(['2026-10-12', '2026-10-26']);
    expect(nextOccurrence(w, '2026-10-13')).toBe('2026-10-19');
  });

  it('équivalent mensuel (52 semaines / 12 mois) et épargne prévue', () => {
    expect(monthlyEquivalent({ amount: 1000, frequency: 'weekly', active: true })).toBe(4333);
    expect(monthlyEquivalent({ amount: 1000, frequency: 'biweekly', active: true })).toBe(2167);
    expect(monthlyEquivalent({ amount: 1000, frequency: 'monthly', active: false })).toBe(0);
    const goal = { includeInBudget: true, achievedAt: null, monthly: 10000 } as Goal;
    expect(plannedMonthlySavings([plan], [goal, { ...goal, includeInBudget: false }, { ...goal, achievedAt: 1 }])).toBe(25000);
  });

  it('échéances passées : achats au dernier cours, quantité marquée estimée, sans doublon', () => {
    const ops = dueOperations({ ...plan, day: 15 }, H, '2026-03-20', () => `x${n++}`);
    expect(ops.map((o) => o.date)).toEqual(['2026-01-15', '2026-02-15', '2026-03-15']);
    expect(ops[0]).toMatchObject({ amount: 15000, quantity: 0.3, estimated: true, planId: 'pl' });
    expect(dueOperations({ ...plan, day: 15, lastRunDate: '2026-03-15' }, H, '2026-03-20', () => 'y')).toHaveLength(0);
  });

  it('en base : exécution idempotente et épargne prévue tenue à jour', async () => {
    const database = await freshDb();
    await database.holdings.put(H);
    await database.plans.put({ ...plan, day: 15, startDate: '2026-09-01' });
    expect(await runDuePlans(database, '2026-10-20')).toBe(2);
    expect(await runDuePlans(database, '2026-10-20')).toBe(0);
    expect(await database.investmentOps.count()).toBe(2);
    await refreshPlannedSavings(database);
    expect((await getSettings(database)).plannedSavingsAuto).toBe(15000);
  });
});

describe('objectifs', () => {
  const goal: Goal = { id: 'g', name: 'Voyage', emoji: '', target: 300000, deadline: '2027-04-20', monthly: 20000, includeInBudget: false, linkKind: 'manual', linkId: null, achievedAt: null, order: 0, createdAt: 0 };

  it('versement nécessaire, date projetée, statut', () => {
    const g = goalProgress(goal, 100000, '2026-10-20');
    expect(g.remaining).toBe(200000);
    expect(g.requiredMonthly).toBe(33334);
    expect(g.status).toBe('behind');
    expect(g.projectedDate).toBe('2027-08-20');
    expect(goalProgress({ ...goal, monthly: 40000 }, 100000, '2026-10-20').status).toBe('on-track');
  });

  it('atteint : or, plus rien à verser', () => {
    const g = goalProgress(goal, 310000, '2026-10-20');
    expect(g).toMatchObject({ achieved: true, ratio: 1, remaining: 0, status: 'achieved', requiredMonthly: 0 });
  });
});
