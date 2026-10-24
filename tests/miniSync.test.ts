import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';

// Un navigateur minimal : chaque « appareil » a son propre stockage, branché à la demande.
const storageOf = (m: Map<string, string>) =>
  ({
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  }) as Storage;

import * as core from '../server/core';
import { authDispatch } from '../server/auth';
import { createAccount, MyLifeApi, syncNow, type LocalStore, type Session } from '../packages/sync-client/src/index';
import { MAX_MINI_ENTRIES, MINI_TEMPLATES, addEntry, deleteMiniApp, emptyMiniApp, parseSpec, removeEntry, type MiniApp, type MiniSpec } from '../packages/lumen/src/miniapp';
import { miniStore } from '../web/src/ui/miniSync';
import { prefsStore } from '../web/src/ui/prefsSync';
import { migrateMiniApps, readMiniApps, readMiniDirty, readMiniLegacy, saveMiniApp } from '../web/src/ui/stats';

const env: core.Env = { secret: 'x'.repeat(40), invite: 'copains-2026', signup: 'open' };
const random = (n: number) => new Uint8Array(randomBytes(n));

async function server() {
  const db = new PGlite();
  await core.ensureSchema(db as unknown as core.Db);
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    const auth = (init.headers as Record<string, string>).authorization;
    try {
      let out: unknown;
      if (url.endsWith('/api/auth')) out = await authDispatch(db as unknown as core.Db, env, body, auth, { ip: '203.0.113.9' });
      else {
        const uid = core.verifyToken(auth, env.secret);
        if (!uid) throw new core.HttpError(401, 'Session expirée');
        out = body.action === 'status' ? await core.syncStatus(db as unknown as core.Db, uid, body) : await core.sync(db as unknown as core.Db, uid, body);
      }
      return new Response(JSON.stringify(out), { status: 200 });
    } catch (e) {
      return new Response(JSON.stringify({ error: (e as Error).message }), { status: e instanceof core.HttpError ? e.status : 500 });
    }
  }) as typeof fetch;
  return { db, api: new MyLifeApi('https://mylife.test', fetchImpl) };
}

const devices = new Map<string, Map<string, string>>();
/** Passe sur un appareil (son stockage devient celui du « navigateur »). */
function on(name: string): void {
  if (!devices.has(name)) devices.set(name, new Map());
  (globalThis as unknown as { localStorage: Storage }).localStorage = storageOf(devices.get(name)!);
}

let srv: Awaited<ReturnType<typeof server>>;
let session: Session;

/** Un passage de synchro de « Mes apps » sur un appareil, comme `syncMiniApps` (sans le réseau du navigateur). */
async function sync(name: string, store: LocalStore = miniStore): Promise<void> {
  on(name);
  migrateMiniApps();
  const st = await store.getState();
  if (st?.joinedAs !== session.login) await store.setState({ device: `appareil-${name}`, cursor: 0, joinedAs: session.login, lastSyncAt: null });
  for (let guard = 0; guard < 30; guard++) {
    await syncNow(store, srv.api, session, random);
    if (!(await store.pending(1)).length) break;
  }
}

const spec = (raw: unknown): MiniSpec => {
  const r = parseSpec(raw);
  if (!r.spec) throw new Error(r.error);
  return r.spec;
};
const day = (i: number) => new Date(Date.UTC(2022, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
const app = (id: string) => readMiniApps()[id]!;

beforeEach(async () => {
  devices.clear();
  on('setup');
  // PGlite se croirait dans un navigateur avec un `window` : celui des apps (événements) n'est posé qu'après.
  delete (globalThis as { window?: unknown }).window;
  srv = await server();
  (globalThis as unknown as { window: EventTarget }).window = new EventTarget();
  ({ session } = await createAccount({ api: srv.api, sessions: { get: async () => null, set: async () => {} }, random }, { login: 'mesapps', password: 'mot-de-passe-long' }));
});

describe('Mes apps : une ligne par saisie (app `miniapps`)', () => {
  it('une app à 1 500 saisies de 8 longs textes passe (l’ancienne ligne unique aurait été refusée) et arrive entière sur un autre appareil', async () => {
    const journal = spec({ name: 'Journal', fields: 'abcdefgh'.split('').map((l) => ({ label: `Note ${l}`, type: 'text' })) });
    let a: MiniApp = emptyMiniApp('journal1', journal, 1000);
    const long = 'éa'.repeat(100);
    for (let i = 0; i < MAX_MINI_ENTRIES; i++) a = addEntry(a, { id: `e${i}`, day: day(i), values: Object.fromEntries(journal.fields.map((f) => [f.id, `${i} ${long}`.slice(0, 200)])) }, 2000 + i);
    // L'ancien format : une seule ligne, bien au-delà de ce que le serveur accepte.
    expect(JSON.stringify(a).length).toBeGreaterThan(1_000_000);
    on('a');
    saveMiniApp(a);
    await sync('a');
    expect(readMiniDirty()).toEqual({});
    await sync('b');
    expect(app('journal1').entries).toHaveLength(MAX_MINI_ENTRIES);
    expect(app('journal1').entries[42]).toEqual(a.entries[42]);
    const { rows } = await srv.db.query<{ tbl: string; n: number }>("SELECT tbl, COUNT(*)::int AS n FROM records WHERE app = 'miniapps' GROUP BY tbl ORDER BY tbl");
    expect(rows).toEqual([
      { tbl: 'app', n: 1 },
      { tbl: 'entry', n: MAX_MINI_ENTRIES },
    ]);
  }, 120_000);

  it('deux saisies notées hors ligne sur deux appareils s’additionnent ; une saisie puis l’app supprimées suivent', async () => {
    on('a');
    saveMiniApp(emptyMiniApp('lecture1', MINI_TEMPLATES[0]!, 1000));
    await sync('a');
    await sync('b');
    expect(app('lecture1').spec?.name).toBe(MINI_TEMPLATES[0]!.name);
    // Chacun note une saisie hors ligne.
    on('a');
    saveMiniApp(addEntry(app('lecture1'), { id: 'aaa', day: '2026-10-20', values: { pages: 12 } }, 5000));
    on('b');
    saveMiniApp(addEntry(app('lecture1'), { id: 'bbb', day: '2026-10-21', values: { pages: 30 } }, 6000));
    await sync('a');
    await sync('b');
    await sync('a');
    for (const d of ['a', 'b']) {
      on(d);
      expect(app('lecture1').entries.map((e) => e.id), d).toEqual(['aaa', 'bbb']);
    }
    // Une saisie supprimée sur A disparaît de B ; A n'en garde plus la trace une fois envoyée.
    on('a');
    saveMiniApp(removeEntry(app('lecture1'), 'aaa', 7000));
    await sync('a');
    expect(app('lecture1').gone).toBeUndefined();
    await sync('b');
    expect(app('lecture1').entries.map((e) => e.id)).toEqual(['bbb']);
    // L'app supprimée sur B : sur A, il n'en reste qu'une trace, et ses saisies sont effacées du compte.
    saveMiniApp(deleteMiniApp(app('lecture1'), 8000));
    await sync('b');
    await sync('a');
    expect(app('lecture1')).toMatchObject({ spec: null, entries: [] });
    const { rows } = await srv.db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM records WHERE app = 'miniapps' AND deleted = false");
    expect(rows[0]!.n).toBe(0);
  }, 60_000);

  it('l’ancien format : les saisies d’ici et celles d’un appareil pas encore à jour sont reprises, l’ancienne ligne est effacée', async () => {
    const lecture = MINI_TEMPLATES[0]!;
    on('c');
    // Données d'avant la mise à jour : une app, une saisie sans date.
    localStorage.setItem('mylife:miniapps', JSON.stringify({ vieux01: { v: 1, id: 'vieux01', at: 100, created: 50, spec: lecture, entries: [{ id: 'old1', day: '2026-09-01', values: { pages: 5 } }] } }));
    migrateMiniApps();
    expect(app('vieux01').entries[0]!.at).toBe(100);
    expect(Object.keys(readMiniDirty()).sort()).toEqual(['app/vieux01', 'entry/vieux01.old1']);
    expect(Object.keys(readMiniLegacy())).toEqual(['vieux01']);
    // Un autre appareil, pas encore à jour, envoie l'ancienne ligne avec une saisie de plus.
    await prefsStore.apply([{ tbl: 'miniapp', rid: 'vieux01', deleted: false, row: { v: 1, id: 'vieux01', at: 120, created: 50, spec: lecture, entries: [{ id: 'old1', day: '2026-09-01', values: { pages: 5 } }, { id: 'old2', day: '2026-09-02', values: { pages: 8 } }] } }]);
    expect(app('vieux01').entries.map((e) => e.id)).toEqual(['old1', 'old2']);
    // L'ancienne ligne part en suppression avec les réglages communs.
    expect((await prefsStore.pending(400)).filter((p) => p.tbl === 'miniapp')).toMatchObject([{ rid: 'vieux01', row: null }]);
    await sync('c', prefsStore);
    expect(readMiniLegacy()).toEqual({});
    await sync('c');
    await sync('d');
    expect(app('vieux01').entries.map((e) => e.id)).toEqual(['old1', 'old2']);
  }, 60_000);

  it('une saisie arrivée avant la description de son app attend, puis la rejoint', async () => {
    on('e');
    await miniStore.apply([{ tbl: 'entry', rid: 'tardive1.x1', deleted: false, row: { app: 'tardive1', entry: { id: 'x1', day: '2026-10-01', values: { pages: 3 }, at: 10 } } }]);
    expect(readMiniApps()).toEqual({});
    await miniStore.apply([{ tbl: 'app', rid: 'tardive1', deleted: false, row: { v: 1, id: 'tardive1', at: 5, created: 5, spec: MINI_TEMPLATES[0] } }]);
    expect(app('tardive1').entries.map((e) => e.id)).toEqual(['x1']);
    // Rien de ce qui arrive du compte n'est renvoyé.
    expect(readMiniDirty()).toEqual({});
  });
});

describe('serveur : une ligne trop grosse ne bloque plus les autres, quota juste', () => {
  const uid = () => core.verifyToken(session.token, env.secret)!;
  const row = (rid: string, payload = 'A'.repeat(40), deleted = false) => ({ tbl: 'prefs', rid, updatedAt: Date.now(), deleted, payload: deleted ? null : payload });

  it('la ligne trop grosse est écartée seule et signalée ; le moteur l’acquitte et prévient l’app', async () => {
    const res = await core.sync(srv.db as unknown as core.Db, uid(), { app: 'mylife', device: 'device-1', cursor: 0, changes: [row('petite'), row('enorme', 'A'.repeat(200_001))] });
    expect(res.accepted).toBe(1);
    expect(res.tooBig).toEqual([{ tbl: 'prefs', rid: 'enorme' }]);
    // Côté appareil : la grosse ligne n'est pas renvoyée en boucle, et l'app le sait.
    const seen: string[] = [];
    let queue = [{ tbl: 'big', rid: 'r1', ver: 1, updatedAt: 1, row: 'x'.repeat(160_000) }];
    const store: LocalStore = {
      app: 'mylife',
      pending: async () => queue,
      ack: async (done) => void (queue = queue.filter((q) => !done.some((d) => d.rid === q.rid))),
      apply: async () => {},
      snapshot: async () => [],
      replace: async () => {},
      clearPending: async () => {},
      // Curseur au-delà des fausses lignes écrites juste avant (illisibles).
      getState: async () => ({ device: 'device-2', cursor: 1e9, joinedAs: session.login, lastSyncAt: null }),
      setState: async () => {},
      tooBig: async (rows) => void seen.push(...rows.map((r) => r.rid)),
    };
    await syncNow(store, srv.api, session, random);
    expect(seen).toEqual(['r1']);
    expect(queue).toEqual([]);
  });

  it('le quota ne compte que les lignes vivantes et vraiment nouvelles', async () => {
    const db = srv.db as unknown as core.Db;
    const fill = Array.from({ length: core.ROW_QUOTA.mylife }, (_, i) => row(`r${i}`));
    await core.sync(db, uid(), { app: 'mylife', device: 'device-1', cursor: 0, changes: fill });
    // Plein : modifier une ligne existante passe, en ajouter une non.
    await expect(core.sync(db, uid(), { app: 'mylife', device: 'device-1', cursor: 0, changes: [row('r3', 'B'.repeat(40))] })).resolves.toMatchObject({ accepted: 1 });
    await expect(core.sync(db, uid(), { app: 'mylife', device: 'device-1', cursor: 0, changes: [row('nouvelle')] })).rejects.toMatchObject({ status: 413 });
    // Une ligne supprimée libère sa place.
    await core.sync(db, uid(), { app: 'mylife', device: 'device-1', cursor: 0, changes: [row('r4', '', true)] });
    await expect(core.sync(db, uid(), { app: 'mylife', device: 'device-1', cursor: 0, changes: [row('nouvelle')] })).resolves.toMatchObject({ accepted: 1 });
  }, 30_000);
});
