import { describe, expect, it } from 'vitest';
import { updateSettings } from '../src/db/seed';
import { exportBackup, importBackup, wipeAll } from '../src/domain/backup';
import { MAX_RESTORE_POINTS, RestoreDB, clearRestorePoints, createRestorePoint, deleteRestorePoint, listRestorePoints, restoreFromPoint } from '../src/domain/restorePoints';
import { dexieStore } from '../src/sync/cloud/dexieStore';
import { freshDb, tx } from './helpers';

let n = 0;
const points = () => new RestoreDB(`test-points-${Date.now()}-${n++}`);

describe('points de restauration', () => {
  it('une restauration de sauvegarde ancienne se rattrape : on revient à l’état d’avant', async () => {
    const database = await freshDb();
    const store = points();
    await database.transactions.bulkPut([tx({ id: 'vieux', amount: -100, date: '2026-09-01' })]);
    const old = JSON.parse(JSON.stringify(await exportBackup(database)));
    // Ensuite : de nouvelles opérations, des réglages changés.
    await database.transactions.bulkPut([tx({ id: 'recent', amount: -250, date: '2026-10-20' })]);
    await updateSettings({ payday: 25, bridgePassword: 'mdp-appareil' }, database);

    expect(await createRestorePoint('Avant une restauration de sauvegarde', database, store, 1000)).not.toBeNull();
    await importBackup(old, database);
    expect(await database.transactions.get('recent')).toBeUndefined();

    const [p] = await listRestorePoints(store);
    expect(p).toMatchObject({ reason: 'Avant une restauration de sauvegarde', transactions: 2, at: 1000 });
    expect(p).not.toHaveProperty('backup');
    expect(await restoreFromPoint(p!.id!, database, store)).toEqual({ transactions: 2 });
    expect((await database.transactions.get('recent'))?.amount).toBe(-250);
    expect((await database.settings.get('main'))?.payday).toBe(25);
    // Le mot de passe du relais reste celui de l'appareil ; le retour lui-même a laissé un point.
    expect((await database.settings.get('main'))?.bridgePassword).toBe('mdp-appareil');
    expect((await listRestorePoints(store)).map((x) => x.reason)).toEqual(['Avant de revenir à un point de restauration', 'Avant une restauration de sauvegarde']);
  });

  it('rien à garder sur une base vide ; 5 points au plus, les plus récents ; suppression', async () => {
    const database = await freshDb();
    const store = points();
    expect(await createRestorePoint('vide', database, store)).toBeNull();
    await database.transactions.put(tx({ id: 'a', amount: -1, date: '2026-10-01' }));
    for (let i = 0; i < MAX_RESTORE_POINTS + 2; i++) await createRestorePoint(`point ${i}`, database, store, 1000 + i);
    const list = await listRestorePoints(store);
    expect(list.map((x) => x.reason)).toEqual(['point 6', 'point 5', 'point 4', 'point 3', 'point 2']);
    await deleteRestorePoint(list[0]!.id!, store);
    expect(await listRestorePoints(store)).toHaveLength(MAX_RESTORE_POINTS - 1);
    await clearRestorePoints(store);
    expect(await listRestorePoints(store)).toHaveLength(0);
    await expect(restoreFromPoint(999, database, store)).rejects.toThrow(/n’existe plus/);
  });

  it('« Tout effacer » puis retour : tout revient', async () => {
    const database = await freshDb();
    const store = points();
    await database.transactions.bulkPut([tx({ id: 'x', amount: -5, date: '2026-10-02' }), tx({ id: 'y', amount: 900, date: '2026-10-03' })]);
    await createRestorePoint('Avant « Tout effacer »', database, store);
    await wipeAll(database);
    expect(await database.transactions.count()).toBe(0);
    await restoreFromPoint((await listRestorePoints(store))[0]!.id!, database, store);
    expect(await database.transactions.count()).toBe(2);
  });

  it('synchro : les données du compte remplacent celles de l’appareil après un point ; un autre compte les efface', async () => {
    const database = await freshDb();
    const store = points();
    const sync = dexieStore(database, store);
    await database.transactions.put(tx({ id: 'local', amount: -42, date: '2026-10-05' }));
    await sync.replace([{ tbl: 'transactions', rid: 'compte', deleted: false, row: tx({ id: 'compte', amount: -7, date: '2026-10-06' }) }]);
    expect((await database.transactions.toArray()).map((t) => t.id)).toEqual(['compte']);
    const [p] = await listRestorePoints(store);
    expect(p).toMatchObject({ reason: 'Avant de reprendre les données du compte', transactions: 1 });
    await sync.forget?.();
    expect(await listRestorePoints(store)).toHaveLength(0);
  });
});
