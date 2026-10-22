import { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import * as core from '../../MyLife/server/raveloc';
import { HttpError, signToken, type Db } from '../../MyLife/server/core';
import { ApiError, createApi } from '../src/lib/api';
import { inviteLink, newGroupId, newGroupKey, openName, openPosition, openProfile, parseInvite, sealName, sealPosition, sealProfile, unwrapGroupKey, wrapGroupKey } from '../src/lib/groupCrypto';

/**
 * Le client de l'app (API + chiffrement) contre la vraie API (hébergée par MyLife), par un faux réseau
 * qu'on peut couper.
 * Deux comptes MyLife, chacun avec sa clé de données : la clé de groupe passe uniquement par le lien.
 */
const env = { secret: 'c'.repeat(40) };
let db: Db;
let networkUp = true;
const seen: string[] = [];

function device(uid: string) {
  const dek = crypto.getRandomValues(new Uint8Array(32));
  let token: string | null = signToken(uid, env.secret);
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    if (!networkUp) throw new TypeError('Failed to fetch');
    seen.push(String(init.body));
    try {
      const out = await core.dispatch(db, env.secret, (init.headers as Record<string, string>).authorization, JSON.parse(String(init.body)));
      return new Response(JSON.stringify(out), { status: 200 });
    } catch (e) {
      return new Response(JSON.stringify({ error: (e as Error).message }), { status: e instanceof HttpError ? e.status : 500 });
    }
  }) as typeof fetch;
  return { uid, dek, api: createApi(() => token, '', fetchImpl), expire: () => (token = signToken(uid, env.secret, Date.now() - 366 * 86_400_000)) };
}

beforeEach(async () => {
  db = new PGlite() as unknown as Db;
  await core.ensureRavelocSchema(db);
  networkUp = true;
  seen.length = 0;
});

describe('parcours chiffré de bout en bout', () => {
  it('créer, inviter, rejoindre, partager, lire — sans que le serveur voie rien de lisible', async () => {
    const alice = device('u_alice');
    const bob = device('u_bob');

    // Alice crée le groupe et un lien.
    const gid = newGroupId();
    const key = newGroupKey();
    await alice.api.create({ gid, name: sealName(key, gid, 'Festival du week-end'), profile: sealProfile(key, gid, alice.uid, 'Alice'), wrappedKey: wrapGroupKey(alice.dek, gid, key), durationMs: 3 * 86_400_000 });
    const { token } = await alice.api.invite({ gid, ttlMs: 3_600_000 });
    const link = inviteLink('https://mylife-liart.vercel.app/raveloc/', token, key);

    // Bob ouvre le lien : seul le jeton part au serveur.
    const inv = parseInvite(link)!;
    const peek = await bob.api.peek({ token: inv.token });
    expect(openName(inv.key, peek.gid, peek.name)).toBe('Festival du week-end');
    await bob.api.join({ token: inv.token, profile: sealProfile(inv.key, gid, bob.uid, 'Bob'), wrappedKey: wrapGroupKey(bob.dek, gid, inv.key) });

    // Sur un autre appareil du même compte, Bob retrouve la clé grâce à sa clé de données.
    const mine = (await bob.api.groups()).groups[0]!;
    expect(unwrapGroupKey(bob.dek, gid, mine.wrappedKey)).toEqual(key);

    // Bob partage ; Alice reçoit une position qu'elle seule peut lire.
    await bob.api.share({ gid, mode: 'on', until: Date.now() + 3_600_000 });
    const fix = { lat: 48.8575, lon: 2.3535, acc: 9, age: 1200 };
    await bob.api.poll({ gid, position: { payload: sealPosition(key, gid, bob.uid, fix), clientAt: Date.now() } });
    const r = await alice.api.poll({ gid });
    const b = r.members.find((m) => m.uid === bob.uid)!;
    expect(openProfile(key, gid, bob.uid, b.profile)).toBe('Bob');
    expect(openPosition(key, gid, bob.uid, b.position!.payload)).toEqual(fix);

    // Rien de lisible n'a transité : ni coordonnées, ni noms, ni la clé du groupe.
    const traffic = seen.join('\n');
    for (const secret of ['48.8575', '2.3535', 'Festival', 'Alice', 'Bob', link.split('.').pop()!]) expect(traffic).not.toContain(secret);
    const dump = JSON.stringify((await db.query('SELECT * FROM raveloc_members')).rows) + JSON.stringify((await db.query('SELECT * FROM raveloc_positions')).rows);
    expect(dump).not.toContain('48.8575');

    // Arrêt : Alice ne reçoit plus rien.
    await bob.api.share({ gid, mode: 'off' });
    expect((await alice.api.poll({ gid })).members.find((m) => m.uid === bob.uid)!.position).toBeNull();
  });

  it('perte de réseau : erreur explicite (statut 0), puis reprise normale', async () => {
    const alice = device('u_alice');
    const gid = newGroupId();
    const key = newGroupKey();
    await alice.api.create({ gid, name: sealName(key, gid, 'G'), profile: sealProfile(key, gid, alice.uid, 'A'), wrappedKey: wrapGroupKey(alice.dek, gid, key), durationMs: 3_600_000 });
    networkUp = false;
    const err = await alice.api.poll({ gid }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(0);
    networkUp = true;
    expect((await alice.api.poll({ gid })).members).toHaveLength(1);
  });

  it('session expirée : 401, jamais de données', async () => {
    const alice = device('u_alice');
    alice.expire();
    const err = (await alice.api.groups().catch((e: unknown) => e)) as ApiError;
    expect(err.status).toBe(401);
    expect(err.message).toMatch(/Session expirée/);
  });

  it('sans session du tout : refus local, aucune requête', async () => {
    const api = createApi(() => null, '', (() => {
      throw new Error('ne doit pas partir');
    }) as typeof fetch);
    expect(((await api.groups().catch((e: unknown) => e)) as ApiError).status).toBe(401);
  });
});
