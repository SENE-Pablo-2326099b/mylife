import { describe, expect, it } from 'vitest';
import { BudgetDB, setMeta } from '../src/db/db';
import { ensureSeeded, updateSettings } from '../src/db/seed';
import { changeTracker, dexieStore, pendingCount } from '../src/sync/cloud/dexieStore';
import { tx } from './helpers';

let n = 0;
async function device() {
  const database = new BudgetDB(`cloud-${Date.now()}-${n++}`);
  database.use(changeTracker);
  await ensureSeeded(database);
  const store = dexieStore(database);
  await store.clearPending();
  return { database, store };
}

describe('synchro MyFinances : suivi des modifications de la base locale', () => {
  it('note les lignes modifiées, ajoutées et supprimées', async () => {
    const { database, store } = await device();
    await database.transactions.bulkPut([tx({ id: 'a', amount: -100, date: '2026-10-01' }), tx({ id: 'b', amount: -200, date: '2026-10-02' })]);
    await database.transactions.delete('b');
    const p = await store.pending(100);
    expect(p.map((c) => [c.tbl, c.rid, c.row === null])).toEqual([
      ['transactions', 'a', false],
      ['transactions', 'b', true],
    ]);
  });

  it('une réécriture à l’identique n’est pas une modification (réglages remis à jour au lancement)', async () => {
    const { database, store } = await device();
    await ensureSeeded(database);
    await ensureSeeded(database);
    expect(await store.pending(100)).toEqual([]);
    await updateSettings({ payday: 26 }, database);
    expect((await store.pending(100)).map((c) => c.tbl)).toEqual(['settings']);
  });

  it('le mot de passe du relais et les repères techniques restent sur l’appareil', async () => {
    const { database, store } = await device();
    await updateSettings({ bridgePassword: 'secret-local', payday: 5 }, database);
    await setMeta('lastSyncAt', 123, database);
    await setMeta('exceptionalAllocations', { t1: 'envelope' }, database);
    const p = await store.pending(100);
    expect(p.map((c) => `${c.tbl}/${c.rid}`).sort()).toEqual(['meta/exceptionalAllocations', 'settings/main']);
    expect(JSON.stringify(p)).not.toContain('secret-local');
    const snap = await store.snapshot();
    expect(JSON.stringify(snap)).not.toContain('secret-local');
    expect(snap.some((r) => r.tbl === 'meta' && r.rid === 'lastSyncAt')).toBe(false);
  });

  it('les données reçues ne sont pas renvoyées, et gardent le mot de passe local', async () => {
    const { database, store } = await device();
    await updateSettings({ bridgePassword: 'secret-local' }, database);
    await store.clearPending();
    const settings = { ...(await database.settings.get('main'))!, payday: 15, bridgePassword: '' };
    await store.apply([
      { tbl: 'transactions', rid: 'r1', deleted: false, row: tx({ id: 'r1', amount: -999, date: '2026-10-03' }) },
      { tbl: 'settings', rid: 'main', deleted: false, row: settings },
    ]);
    expect(await database.transactions.get('r1')).toBeDefined();
    expect((await database.settings.get('main'))?.payday).toBe(15);
    expect((await database.settings.get('main'))?.bridgePassword).toBe('secret-local');
    expect(pendingCount()).toBe(0);
    // Une modification locale ensuite est bien notée.
    await database.transactions.update('r1', { note: 'vu' });
    expect((await store.pending(10)).map((c) => c.rid)).toEqual(['r1']);
  });

  it('vider une table note chaque ligne supprimée ; remplacer par le compte ne note rien', async () => {
    const { database, store } = await device();
    await database.transactions.bulkPut([tx({ id: 'x', amount: -1, date: '2026-10-01' }), tx({ id: 'y', amount: -2, date: '2026-10-01' })]);
    await store.clearPending();
    await database.transactions.clear();
    expect((await store.pending(10)).map((c) => [c.rid, c.row])).toEqual([
      ['x', null],
      ['y', null],
    ]);
    await store.clearPending();
    await store.replace([{ tbl: 'transactions', rid: 'z', deleted: false, row: tx({ id: 'z', amount: -3, date: '2026-10-02' }) }]);
    expect(await database.transactions.toArray()).toHaveLength(1);
    expect(await database.categories.count()).toBe(0);
    expect(pendingCount()).toBe(0);
  });
});
