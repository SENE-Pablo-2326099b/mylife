import { createTestDb } from '@/db/__tests__/testDb';
import { db } from '@/db/db';

import { installSyncTriggers, pendingCount, sqliteStore } from '../sqliteStore';

const body = (id: string, value: number) => db().run('INSERT INTO body_entries (id, date, metric, value, created_at) VALUES (?, ?, ?, ?, ?)', [id, '2026-10-21', 'weight', value, 1]);
const queue = () => db().all<{ tbl: string; rid: string }>('SELECT tbl, rid FROM sync_queue ORDER BY tbl, rid').map((q) => `${q.tbl}/${q.rid}`);

function setup(joined = true) {
  createTestDb();
  installSyncTriggers(db());
  const store = sqliteStore();
  void store.setState({ device: 'test-device', cursor: 0, joinedAs: joined ? 'camille' : null, lastSyncAt: null });
  return store;
}

describe('synchro MyPerf : suivi des modifications SQLite', () => {
  it('rien n’est noté tant que l’appareil n’est pas relié à un compte', () => {
    setup(false);
    body('b1', 72);
    expect(pendingCount()).toBe(0);
  });

  it('ajout, modification réelle, suppression ; une mise à jour sans changement ne compte pas', async () => {
    const store = setup();
    body('b1', 72);
    db().run('DELETE FROM sync_queue');
    db().run('UPDATE body_entries SET value = 72 WHERE id = ?', ['b1']);
    expect(pendingCount()).toBe(0);
    db().run('UPDATE body_entries SET value = 71.5 WHERE id = ?', ['b1']);
    body('b2', 70);
    db().run('DELETE FROM body_entries WHERE id = ?', ['b2']);
    const p = await store.pending(10);
    expect(p.map((c) => [c.rid, c.row === null])).toEqual([
      ['b1', false],
      ['b2', true],
    ]);
    expect((p[0]?.row as { value: number }).value).toBe(71.5);
  });

  it('acquitte seulement la version envoyée (une ligne remodifiée entre-temps repart)', async () => {
    const store = setup();
    body('b1', 72);
    const [sent] = await store.pending(10);
    db().run('UPDATE body_entries SET value = 73 WHERE id = ?', ['b1']);
    await store.ack([sent!]);
    expect(queue()).toEqual(['body_entries/b1']);
  });

  it('le minuteur de repos et la sauvegarde automatique restent sur l’appareil', async () => {
    const store = setup();
    db().run("INSERT INTO settings (key, value) VALUES ('rest_timer', '{}'), ('auto_backup_last', '1'), ('app', '{\"theme\":\"nuit\"}') ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    expect(queue()).toEqual(['settings/app']);
    expect((await store.snapshot()).filter((r) => r.tbl === 'settings').map((r) => r.rid)).toEqual(['app']);
  });

  it('clé composée (remplacements d’exercices) et données reçues jamais renvoyées', async () => {
    const store = setup();
    const [a, b] = ['ex_a', 'ex_b'];
    db().exec('PRAGMA foreign_keys = OFF;');
    db().run('DELETE FROM sync_queue');
    db().run('INSERT INTO exercise_substitutions (from_exercise_id, to_exercise_id, last_used_at) VALUES (?, ?, ?)', [a!, b!, 1]);
    expect(queue()).toEqual([`exercise_substitutions/${a}|${b}`]);
    db().run('DELETE FROM sync_queue');
    await store.apply([
      { tbl: 'body_entries', rid: 'r1', deleted: false, row: { id: 'r1', date: '2026-10-20', metric: 'weight', value: 71, created_at: 2 } },
      { tbl: 'exercise_substitutions', rid: `${a}|${b}`, deleted: true, row: null },
    ]);
    expect(db().first<{ value: number }>('SELECT value FROM body_entries WHERE id = ?', ['r1'])?.value).toBe(71);
    expect(db().first('SELECT * FROM exercise_substitutions')).toBeNull();
    expect(pendingCount()).toBe(0);
  });

  it('remplacer par les données du compte : tout est remplacé, sauf les réglages propres à l’appareil', async () => {
    const store = setup();
    body('local', 80);
    db().run("INSERT INTO settings (key, value) VALUES ('rest_timer', 'en cours') ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    await store.replace([{ tbl: 'body_entries', rid: 'remote', deleted: false, row: { id: 'remote', date: '2026-10-19', metric: 'weight', value: 70, created_at: 3 } }]);
    expect(db().all<{ id: string }>('SELECT id FROM body_entries').map((r) => r.id)).toEqual(['remote']);
    expect(db().first<{ value: string }>("SELECT value FROM settings WHERE key = 'rest_timer'")?.value).toBe('en cours');
    // Le remplacement lui-même ne note rien (le moteur vide ensuite la file de l'appareil).
    expect(queue().some((k) => k.includes('remote'))).toBe(false);
  });
});
