import { describe, expect, it } from 'vitest';
import { classifyTransactions } from '../src/domain/classifyDb';
import { CAT } from '../src/domain/defaults';
import { learnFromCorrection } from '../src/domain/learn';
import { personBalances } from '../src/domain/people';
import { freshDb, tx } from './helpers';

describe('correction manuelle → règle', () => {
  it('crée une règle et classe les opérations similaires', async () => {
    const database = await freshDb();
    await database.transactions.bulkPut([
      tx({ id: '1', amount: -350, date: '2026-10-01', label: 'BOULANGERIE DU COURS' }),
      tx({ id: '2', amount: -420, date: '2026-10-03', label: 'Boulangerie du Cours' }),
      tx({ id: '3', amount: -999, date: '2026-10-03', label: 'Autre chose' }),
    ]);
    await classifyTransactions(database);
    const changed = await learnFromCorrection({ txId: '1', categoryId: CAT.courses, mode: 'create', keyword: 'boulangerie cours' }, database);
    expect(changed).toBe(1);
    expect((await database.transactions.get('1'))?.categorySource).toBe('manual');
    expect(await database.transactions.get('2')).toMatchObject({ categoryId: CAT.courses, categorySource: 'rule' });
    expect((await database.transactions.get('3'))?.categoryId).toBeNull();
  });

  it('met à jour la règle existante', async () => {
    const database = await freshDb();
    await database.transactions.bulkPut([
      tx({ id: '1', amount: -1349, date: '2026-10-01', label: 'NETFLIX.COM' }),
      tx({ id: '2', amount: -1349, date: '2026-11-01', label: 'NETFLIX.COM' }),
    ]);
    await classifyTransactions(database);
    const before = await database.transactions.get('1');
    expect(before?.categoryId).toBe(CAT.abonnements);
    await learnFromCorrection({ txId: '1', categoryId: CAT.sorties, mode: 'update' }, database);
    expect((await database.rules.get(before!.ruleId!))?.categoryId).toBe(CAT.sorties);
    expect((await database.transactions.get('2'))?.categoryId).toBe(CAT.sorties);
  });

  it('« seulement cette opération » ne crée aucune règle', async () => {
    const database = await freshDb();
    const n = await database.rules.count();
    await database.transactions.put(tx({ id: '1', amount: -900, date: '2026-10-01', label: 'X' }));
    await learnFromCorrection({ txId: '1', categoryId: CAT.autres, mode: 'only' }, database);
    expect(await database.rules.count()).toBe(n);
  });
});

describe('soldes entre amis', () => {
  it('solde net cumulé par personne', () => {
    const balances = personBalances([
      tx({ id: '1', amount: -3000, date: '2026-09-01', categoryId: CAT.remboursements, person: 'Lancelot Simon' }),
      tx({ id: '2', amount: 2000, date: '2026-10-12', categoryId: CAT.remboursements, person: 'Lancelot Simon' }),
      tx({ id: '3', amount: 1500, date: '2026-10-02', categoryId: CAT.remboursements, counterparty: 'Marie' }),
      tx({ id: '4', amount: -500, date: '2026-10-02', categoryId: CAT.restos }),
    ]);
    expect(balances).toEqual([
      { person: 'Marie', net: 1500, received: 1500, sent: 0, count: 1, lastDate: '2026-10-02' },
      { person: 'Lancelot Simon', net: -1000, received: 2000, sent: 3000, count: 2, lastDate: '2026-10-12' },
    ]);
  });
});
