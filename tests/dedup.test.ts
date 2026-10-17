import { describe, expect, it } from 'vitest';
import { assignIds, mergeTransactions } from '../src/domain/dedup';
import type { Transaction } from '../src/db/types';
import { mapEbTransaction } from '../src/sync/ebMapping';
import type { EbTransactionsPage } from '../src/sync/ebTypes';
import type { IncomingTransaction } from '../src/sync/source';
import { sample } from './helpers';

const load = (name: string) =>
  sample<EbTransactionsPage>(name)
    .transactions.map(mapEbTransaction)
    .filter((t): t is IncomingTransaction => t !== null);

const inc = (p: Partial<IncomingTransaction>): IncomingTransaction => ({
  date: '2026-10-10',
  bookingDate: null,
  amount: -150,
  currency: 'EUR',
  label: 'Café',
  rawText: 'Café',
  counterparty: null,
  counterpartyIban: null,
  pending: false,
  balanceAfter: null,
  externalId: null,
  mcc: null,
  ...p,
});

function apply(existing: Transaction[], r: ReturnType<typeof mergeTransactions>): Transaction[] {
  const del = new Set(r.toDelete);
  const map = new Map(existing.filter((t) => !del.has(t.id)).map((t) => [t.id, t]));
  for (const t of r.toAdd) map.set(t.id, t);
  return [...map.values()];
}

describe('assignIds', () => {
  it('deux opérations identiques le même jour restent distinctes', () => {
    const ids = assignIds('acc', [inc({}), inc({})]).map((x) => x.id);
    expect(new Set(ids).size).toBe(2);
  });
  it('libellé normalisé : casse et accents ignorés', () => {
    const [a] = assignIds('acc', [inc({ label: 'CAFÉ' })]);
    const [b] = assignIds('acc', [inc({ label: 'cafe' })]);
    expect(a.id).toBe(b.id);
  });
  it('la clé dépend du compte, de la date et du montant', () => {
    const base = assignIds('acc', [inc({})])[0].id;
    expect(assignIds('other', [inc({})])[0].id).not.toBe(base);
    expect(assignIds('acc', [inc({ date: '2026-10-11' })])[0].id).not.toBe(base);
    expect(assignIds('acc', [inc({ amount: -151 })])[0].id).not.toBe(base);
  });
});

describe('mergeTransactions', () => {
  it('un téléchargement qui chevauche le précédent ne crée aucun doublon', () => {
    const first = load('bnp-transactions.json');
    const r1 = mergeTransactions('bnp', [], first, 'enablebanking');
    expect(r1.newBooked).toBe(first.length);
    const db1 = apply([], r1);
    const r2 = mergeTransactions('bnp', db1, first, 'enablebanking');
    expect(r2.toAdd).toHaveLength(0);
    expect(r2.duplicates).toBe(first.length);
  });

  it('doublon détecté par la référence bancaire même si le libellé change', () => {
    const r1 = mergeTransactions('acc', [], [inc({ externalId: 'X1', label: 'Machou' })], 'enablebanking');
    const r2 = mergeTransactions('acc', apply([], r1), [inc({ externalId: 'X1', label: 'MACHOU AIX' })], 'enablebanking');
    expect(r2.duplicates).toBe(1);
    expect(r2.toAdd).toHaveLength(0);
  });

  it('Revolut : les opérations en attente sont remplacées quand elles passent', () => {
    const r1 = mergeTransactions('rev', [], load('revolut-transactions.json'), 'enablebanking');
    let state = apply([], r1);
    expect(state.filter((t) => t.pending)).toHaveLength(2);

    // L'utilisateur corrige à la main l'opération O'Tacos en attente.
    state = state.map((t) => (t.label === "O'Tacos" ? { ...t, categoryId: 'sorties', categorySource: 'manual' as const, note: 'avec Lancelot' } : t));

    const r2 = mergeTransactions('rev', state, load('revolut-transactions-later.json'), 'enablebanking');
    state = apply(state, r2);

    const tacos = state.filter((t) => t.label === "O'Tacos");
    expect(tacos).toHaveLength(1);
    expect(tacos[0].pending).toBe(false);
    expect(tacos[0]).toMatchObject({ categoryId: 'sorties', categorySource: 'manual', note: 'avec Lancelot' });
    expect(r2.settled).toBe(1);

    // L'achat Amazon en attente a disparu (annulé côté banque) : il est retiré.
    expect(state.some((t) => t.label === 'Amazon')).toBe(false);
    // Nouvelle opération en attente.
    expect(state.filter((t) => t.pending).map((t) => t.label)).toEqual(['Machou']);
    // Le top up déjà connu n'est pas dupliqué.
    expect(state.filter((t) => t.amount === 15000)).toHaveLength(1);
  });

  it('une opération en attente inchangée n’est pas comptée comme nouvelle', () => {
    const p = inc({ pending: true });
    const r1 = mergeTransactions('acc', [], [p], 'enablebanking');
    const r2 = mergeTransactions('acc', apply([], r1), [p], 'enablebanking');
    expect(r2.newPending).toBe(0);
    expect(apply(apply([], r1), r2)).toHaveLength(1);
  });

  it('ne touche pas aux opérations des autres comptes', () => {
    const r1 = mergeTransactions('a', [], [inc({ pending: true })], 'enablebanking');
    const r2 = mergeTransactions('b', apply([], r1), [], 'enablebanking');
    expect(r2.toDelete).toHaveLength(0);
  });
});
