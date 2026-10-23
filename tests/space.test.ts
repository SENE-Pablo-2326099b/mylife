import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import * as core from '../server/core';
import { authDispatch } from '../server/auth';
import { ensureRavelocSchema } from '../server/raveloc';
import { ensureSpaceSchema, spaceDispatch, SPACE_LIMITS } from '../server/space';
import { ApiError, createAccount, deleteAccount, MyLifeApi, parseSpaceInvite, SpaceClient, type Session } from '../packages/sync-client/src/index';

const env: core.Env = { secret: 'x'.repeat(40), invite: '', signup: 'open' };
const random = (n: number) => new Uint8Array(randomBytes(n));

/** Le vrai serveur (comptes + espaces) derrière un faux fetch, sur un Postgres en mémoire. */
async function server() {
  const db = new PGlite();
  const Db = db as unknown as core.Db;
  await core.ensureSchema(Db);
  await ensureRavelocSchema(Db);
  await ensureSpaceSchema(Db);
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    const auth = (init.headers as Record<string, string>).authorization;
    try {
      const out = url.endsWith('/api/auth') ? await authDispatch(Db, env, body, auth, { ip: '203.0.113.9' }) : await spaceDispatch(Db, env.secret, auth, body);
      return new Response(JSON.stringify(out), { status: 200 });
    } catch (e) {
      const status = e instanceof core.HttpError ? e.status : 500;
      return new Response(JSON.stringify({ error: (e as Error).message }), { status });
    }
  }) as typeof fetch;
  return { db, api: new MyLifeApi('https://mylife.test', fetchImpl) };
}

let srv: Awaited<ReturnType<typeof server>>;
const people: Record<string, { session: Session; client: SpaceClient; uid: string }> = {};

async function person(login: string) {
  let s: Session | null = null;
  const { session } = await createAccount({ api: srv.api, sessions: { get: async () => s, set: async (v) => void (s = v) }, random }, { login, password: 'mot-de-passe-long' });
  const client = new SpaceClient(srv.api, session, random);
  const { uid } = await client.list();
  people[login] = { session, client, uid };
  return people[login]!;
}

const URL = 'https://mylife.test/crew/rejoindre';

describe('espaces partagés', () => {
  beforeEach(async () => {
    srv = await server();
  });

  it('créer, inviter par lien (clé dans le fragment), rejoindre, se voir, écrire et lire chiffré', async () => {
    const ana = await person('ana-test');
    const bob = await person('bob-test');
    const crew = await ana.client.create('crew', 'La bande', 'Ana', ana.uid);
    const { link } = await ana.client.invite(crew, URL);
    expect(link.startsWith(`${URL}#espace=`)).toBe(true);
    const invite = parseSpaceInvite(link)!;
    const peek = await bob.client.peek(invite);
    expect(peek).toMatchObject({ sid: crew.id, kind: 'crew', name: 'La bande', member: false });
    expect(await bob.client.join(invite, peek.sid, 'Bob', bob.uid)).toEqual({ sid: crew.id, already: false });
    const bobSpace = (await bob.client.list()).spaces[0]!;
    expect(bobSpace.name).toBe('La bande');
    expect((await bob.client.members(bobSpace)).map((m) => [m.pseudo, m.role])).toEqual([
      ['Ana', 'admin'],
      ['Bob', 'member'],
    ]);
    await ana.client.sync(crew, 0, [{ tbl: 'score', rid: ana.uid, row: { level: 12 } }]);
    const got = await bob.client.sync(bobSpace, 0, [{ tbl: 'score', rid: bob.uid, row: { level: 7 } }]);
    expect(got.records.map((r) => [r.author === ana.uid ? 'ana' : 'bob', r.row])).toEqual([
      ['ana', { level: 12 }],
      ['bob', { level: 7 }],
    ]);
    // Le serveur ne voit que des blocs chiffrés.
    const raw = await srv.db.query<{ payload: string; name: string }>('SELECT r.payload, s.name FROM space_records r JOIN spaces s ON s.id = r.space_id');
    for (const r of raw.rows) {
      expect(r.payload).not.toContain('level');
      expect(r.name).not.toContain('bande');
    }
  }, 60_000);

  it('une ligne appartient à son auteur ; une ligne ouverte se modifie à plusieurs ; curseur incrémental', async () => {
    const ana = await person('ana-test');
    const bob = await person('bob-test');
    const crew = await ana.client.create('liste', 'Courses', 'Ana', ana.uid);
    const inv = parseSpaceInvite((await ana.client.invite(crew, URL)).link)!;
    await bob.client.join(inv, crew.id, 'Bob', bob.uid);
    const bobSpace = (await bob.client.list()).spaces[0]!;
    const first = await ana.client.sync(crew, 0, [
      { tbl: 'score', rid: ana.uid, row: { level: 1 } },
      { tbl: 'item', rid: 'pain', row: { done: false }, open: true },
    ]);
    const tryit = await bob.client.sync(bobSpace, 0, [
      { tbl: 'score', rid: ana.uid, row: { level: 99 } },
      { tbl: 'item', rid: 'pain', row: { done: true } },
    ]);
    expect(tryit.refused).toEqual([{ tbl: 'score', rid: ana.uid }]);
    const after = await ana.client.sync(crew, first.cursor);
    expect(after.records.map((r) => [r.rid, r.row])).toEqual([['pain', { done: true }]]);
  }, 60_000);

  it('quitter efface ce qu’on a écrit ; le dernier parti, l’espace disparaît ; un admin est désigné', async () => {
    const ana = await person('ana-test');
    const bob = await person('bob-test');
    const crew = await ana.client.create('crew', 'La bande', 'Ana', ana.uid);
    await bob.client.join(parseSpaceInvite((await ana.client.invite(crew, URL)).link)!, crew.id, 'Bob', bob.uid);
    const bobSpace = (await bob.client.list()).spaces[0]!;
    await ana.client.sync(crew, 0, [{ tbl: 'score', rid: ana.uid, row: { level: 3 } }]);
    await ana.client.leave(crew);
    expect((await bob.client.members(bobSpace)).map((m) => [m.pseudo, m.role])).toEqual([['Bob', 'admin']]);
    expect((await bob.client.sync(bobSpace, 0)).records).toEqual([]);
    await bob.client.leave(bobSpace);
    expect((await srv.db.query('SELECT 1 FROM spaces')).rows).toHaveLength(0);
  }, 60_000);

  it('hors de l’espace : rien à lire ni écrire ; lien faux ou révoqué refusé, et les essais au hasard sont freinés', async () => {
    const ana = await person('ana-test');
    const eve = await person('eve-test');
    const crew = await ana.client.create('crew', 'Privé', 'Ana', ana.uid);
    await expect(eve.client.sync(crew, 0)).rejects.toMatchObject({ status: 404 });
    await expect(eve.client.members(crew)).rejects.toMatchObject({ status: 404 });
    const fake = { token: 'A'.repeat(22), key: random(32) };
    for (let i = 0; i < 10; i++) await expect(eve.client.peek(fake)).rejects.toBeInstanceOf(ApiError);
    const real = parseSpaceInvite((await ana.client.invite(crew, URL)).link)!;
    await expect(eve.client.peek(real)).rejects.toMatchObject({ status: 429 });
  }, 60_000);

  it('lien à usage unique ; un mauvais lien (clé abîmée) ne permet pas de lire le nom', async () => {
    const ana = await person('ana-test');
    const bob = await person('bob-test');
    const cyd = await person('cyd-test');
    const crew = await ana.client.create('crew', 'Duo', 'Ana', ana.uid);
    const inv = parseSpaceInvite((await ana.client.invite(crew, URL, { maxUses: 1 })).link)!;
    await bob.client.join(inv, crew.id, 'Bob', bob.uid);
    await expect(cyd.client.join(inv, crew.id, 'Cyd', cyd.uid)).rejects.toMatchObject({ status: 404 });
    const other = parseSpaceInvite((await ana.client.invite(crew, URL)).link)!;
    await expect(cyd.client.peek({ token: other.token, key: random(32) })).rejects.toMatchObject({ status: 400 });
  }, 60_000);

  it('compte supprimé : il quitte ses espaces et ses lignes partent', async () => {
    const ana = await person('ana-test');
    const bob = await person('bob-test');
    const crew = await ana.client.create('crew', 'La bande', 'Ana', ana.uid);
    await bob.client.join(parseSpaceInvite((await ana.client.invite(crew, URL)).link)!, crew.id, 'Bob', bob.uid);
    const bobSpace = (await bob.client.list()).spaces[0]!;
    await bob.client.sync(bobSpace, 0, [{ tbl: 'score', rid: bob.uid, row: { level: 4 } }]);
    await deleteAccount({ api: srv.api, sessions: { get: async () => bob.session, set: async () => undefined }, random }, bob.session, 'mot-de-passe-long');
    expect((await ana.client.members(crew)).map((m) => m.pseudo)).toEqual(['Ana']);
    expect((await ana.client.sync(crew, 0)).records).toEqual([]);
  }, 60_000);

  it('limites : taille des lignes, nombre de modifications par envoi', async () => {
    const ana = await person('ana-test');
    const crew = await ana.client.create('crew', 'Gros', 'Ana', ana.uid);
    await expect(ana.client.sync(crew, 0, [{ tbl: 'score', rid: 'x', row: { blob: 'a'.repeat(9000) } }])).rejects.toMatchObject({ status: 400 });
    await expect(ana.client.sync(crew, 0, Array.from({ length: 201 }, (_, i) => ({ tbl: 'score', rid: `r${i}`, row: 1 })))).rejects.toMatchObject({ status: 413 });
    expect(SPACE_LIMITS.maxRowsPerSpace).toBeGreaterThan(100);
  }, 60_000);
});
