import { describe, expect, it } from 'vitest';
import { bankLabel, mapEbAccount, mapEbTransaction, pickBalance, prettifyLabel } from '../src/sync/ebMapping';
import type { EbBalance, EbSession, EbTransactionsPage } from '../src/sync/ebTypes';
import { sample } from './helpers';

const bnp = sample<EbTransactionsPage>('bnp-transactions.json');
const rev = sample<EbTransactionsPage>('revolut-transactions.json');

describe('mapEbTransaction', () => {
  it('salaire BNP : crédit, montant en centimes, contrepartie', () => {
    const t = mapEbTransaction(bnp.transactions[0])!;
    expect(t).toMatchObject({ amount: 153700, date: '2026-09-26', counterparty: 'CEA CADARACHE', pending: false, externalId: 'BNP-20260926-0001', balanceAfter: 170231 });
    expect(t.rawText).toContain('SALAIRE');
  });

  it('débit : signe négatif via credit_debit_indicator', () => {
    const t = mapEbTransaction(bnp.transactions[1])!;
    expect(t.amount).toBe(-45000);
    expect(t.date).toBe('2026-09-27'); // date de transaction prioritaire sur la date de comptabilisation
    expect(t.bookingDate).toBe('2026-09-28');
  });

  it('montant déjà signé sans indicateur', () => {
    expect(mapEbTransaction(bnp.transactions[6])!.amount).toBe(-820);
  });

  it('IBAN de contrepartie normalisé', () => {
    expect(mapEbTransaction(bnp.transactions[2])!.counterpartyIban).toBe('FR7628233000011234567890123');
  });

  it('libellé carte BNP nettoyé', () => {
    const t = mapEbTransaction(bnp.transactions[5])!;
    expect(t.label).toMatch(/^FREE MOBILE/);
    expect(t.label).not.toMatch(/4974|FACTURE CARTE/);
  });

  it('Revolut : en attente = PDNG, annulée ignorée', () => {
    const mapped = rev.transactions.map(mapEbTransaction);
    expect(mapped.filter((t) => t?.pending)).toHaveLength(2);
    expect(mapped[8]).toBeNull(); // CNCL
    expect(mapped[1]).toMatchObject({ label: 'Deliveroo', amount: -2340, mcc: '5812' });
  });

  it('ignore les opérations sans date ou sans montant', () => {
    expect(mapEbTransaction({ transaction_amount: { currency: 'EUR', amount: '1.00' } })).toBeNull();
  });
});

describe('prettifyLabel', () => {
  it.each([
    ['FACTURE CARTE DU 141026 INTERMARCHE AIX CARTE 4974XXXXXXXX1234', 'INTERMARCHE AIX'],
    ['PRLV SEPA CROUS AIX MARSEILLE', 'CROUS AIX MARSEILLE'],
    ['CB DELIVEROO 12/10', 'DELIVEROO'],
    ['Deliveroo', 'Deliveroo'],
  ])('%s', (raw, expected) => {
    expect(prettifyLabel(raw)).toBe(expected);
  });
});

describe('comptes et soldes', () => {
  it('compte identifié par identification_hash (stable entre deux connexions)', () => {
    const s = sample<EbSession>('session-bnp.json');
    const a = mapEbAccount(s.accounts[0], s.aspsp.name, s.session_id);
    expect(a).toMatchObject({ id: 'eb:BNPHASH-WwpbCiJhY2NvdW50IiwKImFjY291bnRfaWQi', bank: 'BNP', iban: 'FR7630004000031234567890143', remoteUid: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d' });
    expect(a.name).toBe('Compte de chèques');
    const r = sample<EbSession>('session-revolut.json');
    expect(mapEbAccount(r.accounts[0], r.aspsp.name, r.session_id).name).toBe('Personal');
  });

  it('solde disponible préféré au solde comptable', () => {
    const b = sample<{ balances: EbBalance[] }>('balances.json');
    expect(pickBalance(b.balances)?.amount).toBe(79715);
    expect(pickBalance([])).toBeNull();
  });

  it('bankLabel', () => {
    expect(bankLabel('BNP Paribas')).toBe('BNP');
    expect(bankLabel('Revolut')).toBe('Revolut');
    expect(bankLabel('Boursorama')).toBe('BoursoBank');
    expect(bankLabel('Banque Exemple SA')).toBe('Banque Exemple');
  });
});
