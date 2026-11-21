import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { buildExport } from '../app/src/modules/finances/data/export';
import { facts } from '../app/src/modules/finances/data/facts';
import { applyImport, ImportError, lastImportUndo, readImport, summarize, undoImport } from '../app/src/modules/finances/data/importBackup';

/** Importer un fichier de données dans MyFinances : ajouter sans doublon, remplacer, annuler. Données fictives. */
const tx = (id: string, amount = -1000) => ({ id, accountId: 'a', date: '2026-11-10', bookingDate: null, amount, currency: 'EUR', label: id, rawText: id, counterparty: null, counterpartyIban: null, pending: false, balanceAfter: null, categoryId: null, categorySource: null, ruleId: null, person: null, transferPairId: null, note: '', source: 'enablebanking', externalId: id, mcc: null, createdAt: 0 });
const file = (transactions: unknown[], extra: Record<string, unknown> = {}) => JSON.stringify({ format: 'myfinances-backup', version: 2, exportedAt: '2026-11-20T10:00:00.000Z', tables: { transactions, accounts: [{ id: 'a', name: 'Compte' }], settings: [{ id: 'main', bridgePassword: '' }] }, ...extra });

describe('importer des données', () => {
  it('refuse ce qui n’est pas un export de MyFinances, ou un fichier abîmé', () => {
    expect(() => readImport('pas du json')).toThrow(ImportError);
    expect(() => readImport(JSON.stringify({ format: 'autre', version: 1, tables: {} }))).toThrow(/pas un export/);
    expect(() => readImport(JSON.stringify({ format: 'myfinances-backup', version: 9, tables: {} }))).toThrow(/plus récente/);
    expect(() => readImport(file([{ id: 'x', date: '2026-11-10', amount: 12.5 }]))).toThrow(/centimes/);
    // L'ancien format de l'app d'avant reste lisible.
    expect(readImport(JSON.stringify({ format: 'budget-dodge-backup', version: 1, tables: { transactions: [] } })).tables.transactions).toEqual([]);
  });

  it('ajouter : ce qui manque arrive, ce qui existe est mis à jour sans doublon, rien ne part ; l’accès bancaire reste', async () => {
    await facts.transactions.bulkPut([tx('t1'), tx('t2')] as never);
    await facts.settings.put({ id: 'main', bridgePassword: 'secret-de-l-appareil' });
    const data = readImport(file([tx('t2', -2000), tx('t3')]));
    expect(await summarize(data)).toMatchObject({ transactions: 2, newTransactions: 1, accounts: 1 });
    await applyImport(data, false);
    expect((await facts.transactions.toArray()).map((t) => [t.id, t.amount]).sort()).toEqual([['t1', -1000], ['t2', -2000], ['t3', -1000]]);
    expect((await facts.settings.get('main'))?.bridgePassword).toBe('secret-de-l-appareil');
    expect(await lastImportUndo()).not.toBeNull();
    // Annuler : tout redevient comme avant.
    expect(await undoImport()).toBe(true);
    expect((await facts.transactions.toArray()).map((t) => [t.id, t.amount]).sort()).toEqual([['t1', -1000], ['t2', -1000]]);
    expect(await lastImportUndo()).toBeNull();
  });

  it('remplacer : les données deviennent celles du fichier, réglages du moteur compris ; un export se réimporte', async () => {
    await facts.transactions.bulkPut([tx('t1'), tx('t2')] as never);
    const exported = JSON.stringify(await buildExport());
    await applyImport(readImport(file([tx('t9')], { engine: null })), true);
    expect((await facts.transactions.toArray()).map((t) => t.id)).toEqual(['t9']);
    await applyImport(readImport(exported), true);
    expect((await facts.transactions.toArray()).map((t) => t.id).sort()).toEqual(['t1', 't2']);
    expect((await facts.settings.get('main'))?.bridgePassword).toBe('secret-de-l-appareil');
  });
});
