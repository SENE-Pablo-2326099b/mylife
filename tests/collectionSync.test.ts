import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import * as core from '../server/core';
import { authDispatch } from '../server/auth';
import { createAccount, MyLifeApi, syncNow, type Session } from '../packages/sync-client/src/index';
import { collectionStore, defineCollection } from '../web/src/ui/collectionSync';

// Une app de test déclarée au serveur le temps du test (comme `npm run new-app` le fait pour de vrai).
(core.APPS as string[]).push('essai');
(core.ROW_QUOTA as Record<string, number>).essai = 1000;

const env: core.Env = { secret: 'x'.repeat(40), invite: 'x', signup: 'open' };
const random = (n: number) => new Uint8Array(randomBytes(n));
const storageOf = (m: Map<string, string>) =>
  ({ getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, String(v)), removeItem: (k: string) => void m.delete(k), key: (i: number) => [...m.keys()][i] ?? null, get length() { return m.size; } }) as Storage;

interface Item {
  name: string;
  qty: number;
}
const parseItem = (raw: unknown): Item | null => {
  const o = raw as Partial<Item> | null;
  return o && typeof o.name === 'string' && typeof o.qty === 'number' ? { name: o.name.slice(0, 60), qty: o.qty } : null;
};

let db: PGlite;
let api: MyLifeApi;
let session: Session;
const devices = new Map<string, Map<string, string>>();
const on = (name: string) => {
  if (!devices.has(name)) devices.set(name, new Map());
  (globalThis as unknown as { localStorage: Storage }).localStorage = storageOf(devices.get(name)!);
};
const items = () => defineCollection({ app: 'essai', name: 'items', parse: parseItem });
async function sync(name: string) {
  on(name);
  items();
  const store = collectionStore('essai');
  const st = await store.getState();
  if (st?.joinedAs !== session.login) await store.setState({ device: `appareil-${name}`, cursor: 0, joinedAs: session.login, lastSyncAt: null });
  for (let i = 0; i < 10; i++) {
    await syncNow(store, api, session, random);
    if (!(await store.pending(1)).length) break;
  }
}

beforeEach(async () => {
  devices.clear();
  on('setup');
  delete (globalThis as { window?: unknown }).window;
  db = new PGlite();
  await core.ensureSchema(db as unknown as core.Db);
  (globalThis as unknown as { window: EventTarget }).window = new EventTarget();
  api = new MyLifeApi('https://mylife.test', (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    const auth = (init.headers as Record<string, string>).authorization;
    try {
      const uid = url.endsWith('/api/auth') ? null : core.verifyToken(auth, env.secret);
      const out = url.endsWith('/api/auth') ? await authDispatch(db as unknown as core.Db, env, body, auth, { ip: '203.0.113.5' }) : await core.sync(db as unknown as core.Db, uid!, body);
      return new Response(JSON.stringify(out), { status: 200 });
    } catch (e) {
      return new Response(JSON.stringify({ error: (e as Error).message }), { status: e instanceof core.HttpError ? e.status : 500 });
    }
  }) as typeof fetch);
  ({ session } = await createAccount({ api, sessions: { get: async () => null, set: async () => {} }, random }, { login: 'collections', password: 'mot-de-passe-long' }));
});

describe('collections synchronisées (contrat d’app)', () => {
  it('une ligne ajoutée, modifiée, supprimée sur un appareil suit sur l’autre ; chiffrée en base', async () => {
    on('a');
    items().put('oeufs', { name: 'Œufs', qty: 6 }, 1000);
    items().put('lait', { name: 'Lait', qty: 1 }, 1000);
    await sync('a');
    await sync('b');
    expect(items().list().map((i) => i.value.name).sort()).toEqual(['Lait', 'Œufs']);
    const { rows } = await db.query<{ payload: string }>("SELECT payload FROM records WHERE app = 'essai'");
    expect(rows.every((r) => !r.payload.includes('Lait'))).toBe(true);
    // B en mange deux, A supprime le lait.
    items().put('oeufs', { name: 'Œufs', qty: 4 }, 2000);
    on('a');
    items().remove('lait', 2000);
    await sync('b');
    await sync('a');
    await sync('b');
    for (const d of ['a', 'b']) {
      on(d);
      expect(items().list().map((i) => [i.id, i.value.qty]), d).toEqual([['oeufs', 4]]);
    }
    // La trace de la suppression n'est plus gardée une fois envoyée.
    on('a');
    expect(JSON.parse(localStorage.getItem('mylife:app:essai:items')!)).not.toHaveProperty('lait');
  });

  it('deux modifications hors ligne de la même ligne : la plus récente gagne partout ; une ligne illisible est ignorée', async () => {
    on('a');
    items().put('pates', { name: 'Pâtes', qty: 2 }, 1000);
    await sync('a');
    await sync('b');
    items().put('pates', { name: 'Pâtes', qty: 1 }, 3000);
    on('a');
    items().put('pates', { name: 'Pâtes', qty: 5 }, 2000);
    await sync('a');
    await sync('b');
    await sync('a');
    expect(items().get('pates')?.qty).toBe(1);
    await collectionStore('essai').apply([{ tbl: 'items', rid: 'bizarre', deleted: false, row: { at: 1, v: { name: 42 } } }]);
    expect(items().get('bizarre')).toBeNull();
  });
});
