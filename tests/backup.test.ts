import { describe, expect, it } from 'vitest';
import { updateSettings } from '../src/db/seed';
import { exportBackup, importBackup, validateBackup, wipeAll } from '../src/domain/backup';
import { freshDb, tx } from './helpers';

describe('sauvegarde JSON', () => {
  it('aller-retour complet, sans le mot de passe du relais', async () => {
    const a = await freshDb();
    await a.transactions.bulkPut([tx({ id: '1', amount: -1234, date: '2026-10-01' }), tx({ id: '2', amount: 500, date: '2026-10-02' })]);
    await updateSettings({ bridgePassword: 'secret', salary: 160000 }, a);
    const backup = JSON.parse(JSON.stringify(await exportBackup(a)));
    expect(JSON.stringify(backup)).not.toContain('secret');

    const b = await freshDb();
    await updateSettings({ bridgePassword: 'other-device' }, b);
    await b.transactions.put(tx({ id: 'old', amount: -1, date: '2026-01-01' }));
    const res = await importBackup(backup, b);
    expect(res.transactions).toBe(2);
    expect(await b.transactions.get('old')).toBeUndefined();
    expect((await b.transactions.get('1'))?.amount).toBe(-1234);
    const s = await b.settings.get('main');
    expect(s?.salary).toBe(160000);
    expect(s?.bridgePassword).toBe('other-device');
    expect(await b.rules.count()).toBe(await a.rules.count());
  });

  it('refuse un fichier étranger ou des montants non entiers', () => {
    expect(() => validateBackup({ foo: 1 })).toThrow(/pas une sauvegarde/);
    expect(() =>
      validateBackup({ format: 'budget-dodge-backup', version: 1, exportedAt: '', tables: { transactions: [{ id: 'x', date: '2026-01-01', amount: 12.5 }] } }),
    ).toThrow(/centimes/);
    expect(() => validateBackup({ format: 'budget-dodge-backup', version: 99, tables: {} })).toThrow(/plus récente/);
  });

  it('effacement total puis réinitialisation', async () => {
    const a = await freshDb();
    await a.transactions.put(tx({ id: '1', amount: -1, date: '2026-10-01' }));
    await wipeAll(a);
    expect(await a.transactions.count()).toBe(0);
    expect(await a.categories.count()).toBeGreaterThan(10);
  });
});
