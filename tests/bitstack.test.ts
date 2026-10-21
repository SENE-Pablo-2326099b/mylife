import { describe, expect, it, vi } from 'vitest';
import type { Holding, InvestmentOp } from '../src/db/types';
import { handleBridge } from '../server/bridge';
import { bankBuys, priceLookup } from '../src/domain/bankBuys';
import { position } from '../src/domain/wealth';
import { runDuePlans, syncBankBuys } from '../src/domain/wealthDb';
import { freshDb, tx } from './helpers';

// Bitcoin chez Bitstack : prix en centimes par BTC.
const BTC: Holding = { id: 'btc', portfolioId: 'p', name: 'Bitcoin', assetClass: 'crypto', symbol: 'bitcoin', quoteSource: 'coingecko', isin: null, price: 7_000_000, priceAt: 0, order: 0, createdAt: 0 };
let n = 0;
const op = (o: Partial<InvestmentOp> & Pick<InvestmentOp, 'type' | 'amount'>): InvestmentOp => ({ id: `o${n++}`, holdingId: 'btc', date: '2026-10-01', quantity: 0, planId: null, estimated: false, note: '', createdAt: n, ...o });

describe('recalage sur l’app du courtier (prix d’achat moyen)', () => {
  it('quantité et prix moyen deviennent ceux de l’app ; la plus-value se cale dessus', () => {
    const ops = [
      op({ type: 'buy', quantity: 0.001, amount: 6000, date: '2026-09-01', estimated: true }),
      op({ type: 'buy', quantity: 0.001, amount: 6000, date: '2026-09-08', estimated: true }),
      // Bitstack affiche : 0,00195 BTC, prix d'achat moyen 61 538,46 € → 120 € investis (frais inclus).
      op({ type: 'adjust', quantity: 0.00195, amount: Math.round(0.00195 * 6_153_846), date: '2026-10-01' }),
    ];
    const p = position(BTC, ops);
    expect(p.quantity).toBe(0.00195);
    expect(p.invested).toBe(12000);
    expect(p.averageCost).toBe(Math.round(12000 / 0.00195));
    expect(p.value).toBe(Math.round(0.00195 * 7_000_000));
    expect(p.gain).toBe(13650 - 12000);
    expect(p.estimated).toBe(false);
  });

  it('les achats suivants s’ajoutent et font évoluer le prix moyen ; un recalage du même jour les inclut', () => {
    const base = op({ type: 'adjust', quantity: 0.002, amount: 12000, date: '2026-10-01' });
    const after = op({ type: 'buy', quantity: 0.0001, amount: 700, date: '2026-10-08' });
    const sameDay = op({ type: 'buy', quantity: 0.5, amount: 999999, date: '2026-10-01', createdAt: 9e12 });
    const p = position(BTC, [after, sameDay, base]);
    expect(p.quantity).toBeCloseTo(0.0021, 10);
    expect(p.invested).toBe(12700);
  });
});

describe('achats automatiques depuis les prélèvements Bitstack', () => {
  const linked: Holding = { ...BTC, bankKeyword: 'bitstack', bankLinkFrom: '2026-10-01' };
  const txs = [
    tx({ id: 'w1', date: '2026-10-06', amount: -1000, label: 'PRLV SEPA BITSTACK SAS', rawText: 'PRLV SEPA BITSTACK SAS DCA' }),
    tx({ id: 'w2', date: '2026-10-13', amount: -1000, label: 'BITSTACK' }),
    tx({ id: 'r', date: '2026-10-14', amount: -237, label: 'Bitstack arrondis', pending: true }),
    tx({ id: 'old', date: '2026-09-29', amount: -1000, label: 'BITSTACK' }),
    tx({ id: 'out', date: '2026-10-15', amount: 5000, label: 'VIR BITSTACK' }),
    tx({ id: 'x', date: '2026-10-07', amount: -1500, label: 'CARREFOUR' }),
  ];
  const prices = priceLookup(
    [
      ['2026-10-06', 62500],
      ['2026-10-13', 50000],
    ],
    7_000_000,
  );

  it('un achat par prélèvement, au cours du jour ; un virement reçu = une vente', () => {
    const out = bankBuys(linked, txs, [], prices);
    expect(out.map((o) => [o.bankTxId, o.type, o.date, o.amount, o.quantity])).toEqual([
      ['w1', 'buy', '2026-10-06', 1000, 0.00016],
      ['w2', 'buy', '2026-10-13', 1000, 0.0002],
      ['out', 'sell', '2026-10-15', 5000, 0.001],
    ]);
    expect(out.every((o) => o.estimated && o.id === `bank-${o.bankTxId}`)).toBe(true);
  });

  it('jamais deux fois, rien avant le recalage (jour même compris), rien d’« en attente »', () => {
    const already = bankBuys(linked, txs, [op({ type: 'buy', amount: 1000, bankTxId: 'w1' })], prices);
    expect(already.map((o) => o.bankTxId)).toEqual(['w2', 'out']);
    const recaled = bankBuys(linked, txs, [op({ type: 'adjust', quantity: 0.01, amount: 60000, date: '2026-10-13' })], prices);
    expect(recaled.map((o) => o.bankTxId)).toEqual(['out']);
    expect(bankBuys({ ...BTC, bankKeyword: null }, txs, [], prices)).toEqual([]);
  });

  it('cours d’un jour sans cotation : le dernier connu avant, sinon le cours actuel', () => {
    expect(prices('2026-10-10')).toBe(6_250_000);
    expect(prices('2026-10-01')).toBe(7_000_000);
  });

  it('en base : les achats sont créés une fois, et le plan ne fait pas doublon', async () => {
    const database = await freshDb();
    await database.holdings.put({ ...linked, symbol: null, quoteSource: 'manual' });
    await database.transactions.bulkPut(txs);
    expect(await syncBankBuys(database, '2026-10-20')).toBe(3);
    expect(await syncBankBuys(database, '2026-10-20')).toBe(0);
    const ops = await database.investmentOps.where('holdingId').equals('btc').toArray();
    // Sans relais : quantité au dernier cours connu (70 000 €).
    expect(ops.find((o) => o.bankTxId === 'w1')?.quantity).toBe(0.00014286);
    // Un plan programmé sur une ligne reliée à la banque ne crée rien : la banque fait foi.
    await database.plans.put({ id: 'pl', holdingId: 'btc', amount: 1000, frequency: 'weekly', day: 1, startDate: '2026-10-01', active: true, lastRunDate: null, createdAt: 0 });
    expect(await runDuePlans(database, '2026-10-20')).toBe(0);
  });
});

describe('historique des cours via le relais', () => {
  it('CoinGecko : cours quotidiens en euros, jours bornés', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      return { status: 200, ok: true, text: async () => JSON.stringify({ prices: [[Date.UTC(2026, 9, 6), 62500.5], [Date.UTC(2026, 9, 7), 63000]] }) };
    });
    const out = await handleBridge({ method: 'POST', headers: { 'x-bridge-password': 'pw' }, body: { op: 'priceHistory', source: 'coingecko', symbol: 'bitcoin', days: 9999 } }, { password: 'pw' }, fetchImpl);
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ prices: [['2026-10-06', 62500.5], ['2026-10-07', 63000]] });
    expect(calls[0]).toContain('coins/bitcoin/market_chart?vs_currency=eur&days=400');
  });

  it('refuse un symbole invalide', async () => {
    const out = await handleBridge({ method: 'POST', headers: { 'x-bridge-password': 'pw' }, body: { op: 'priceHistory', source: 'coingecko', symbol: '../evil' } }, { password: 'pw' }, vi.fn());
    expect(out.status).toBe(400);
  });
});
