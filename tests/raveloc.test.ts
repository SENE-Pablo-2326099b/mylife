import { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import * as core from '../server/raveloc';
import { HttpError, signToken, verifyToken, type Db } from '../server/core';

/**
 * MyRave (/api/raveloc) sur un vrai Postgres en mémoire, avec les vraies sessions de MyLife.
 * Les contenus chiffrés sont des blocs base64 quelconques : le serveur ne sait pas les lire
 * (le chiffrement est testé côté app, dans apps/raveloc).
 */
const env = { secret: 's'.repeat(40) };
const T0 = 1_800_000_000_000;
const blob = (seed: string, n = 60) => Buffer.from(seed.repeat(n)).toString('base64').slice(0, n);
const gid = (n: number) => n.toString(16).padStart(32, 'a');

let db: Db;
let now = T0;
const as = (uid: string) => (action: core.Action, body: Record<string, unknown> = {}) => core.dispatch(db, env.secret, `Bearer ${signToken(uid, env.secret, now)}`, { action, ...body }, now);
const status = async (p: Promise<unknown>) => {
  try {
    await p;
    return 200;
  } catch (e) {
    return (e as HttpError).status;
  }
};

const alice = as('u_alice');
const bob = as('u_bob');
const eve = as('u_eve');

async function group(n = 1, durationMs = 12 * 3_600_000) {
  await alice('create', { gid: gid(n), name: blob('name'), profile: blob('alice'), wrappedKey: blob('key', 80), durationMs });
  return gid(n);
}
async function invite(g: string, o: Record<string, unknown> = {}) {
  return (await alice('invite', { gid: g, ttlMs: 3_600_000, ...o })) as { token: string; invite: core.InviteInfo };
}
async function join(who: typeof bob, token: string) {
  return who('join', { token, profile: blob('p'), wrappedKey: blob('k', 80) }) as Promise<{ gid: string; already: boolean }>;
}
const pos = (clientAt: number, seed = 'pos') => ({ payload: blob(seed, 120), clientAt });

beforeEach(async () => {
  now = T0;
  db = new PGlite() as unknown as Db;
  await core.ensureRavelocSchema(db);
});

describe('sessions MyLife', () => {
  it('session MyLife exigée ; jeton d’un autre secret ou expiré refusé', async () => {
    expect(await status(core.dispatch(db, env.secret, undefined, { action: 'groups' }, now))).toBe(401);
    expect(await status(core.dispatch(db, env.secret, `Bearer ${signToken('u_x', 'autre'.repeat(10), now)}`, { action: 'groups' }, now))).toBe(401);
    expect(await status(core.dispatch(db, env.secret, `Bearer ${signToken('u_x', env.secret, now - 400 * 86_400_000)}`, { action: 'groups' }, now))).toBe(401);
    expect(verifyToken(signToken('u_x', env.secret, now), env.secret, now)).toBe('u_x');
    expect(await status(alice('nope' as core.Action))).toBe(400);
  });
});

describe('groupes', () => {
  it('création, liste, durée bornée', async () => {
    const g = await group();
    const r = (await alice('groups')) as { groups: core.GroupSummary[] };
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]).toMatchObject({ id: g, role: 'admin', members: 1, sharing: 'off', expiresAt: T0 + 12 * 3_600_000 });
    expect(await status(alice('create', { gid: gid(2), name: blob('n'), profile: blob('p'), wrappedKey: blob('k', 80), durationMs: 60 * 86_400_000 }))).toBe(400);
    expect(await status(alice('create', { gid: g, name: blob('n'), profile: blob('p'), wrappedKey: blob('k', 80), durationMs: 3_600_000 }))).toBe(409);
  });
  it('un non-membre ne voit rien, et ne peut pas distinguer un groupe existant d’un groupe inventé', async () => {
    const g = await group();
    expect(await status(eve('poll', { gid: g }))).toBe(404);
    expect(await status(eve('poll', { gid: gid(99) }))).toBe(404);
    expect(await status(eve('invite', { gid: g, ttlMs: 3_600_000 }))).toBe(404);
    expect(((await eve('groups')) as { groups: unknown[] }).groups).toEqual([]);
  });
  it('un membre plusieurs groupes à la fois', async () => {
    await group(1);
    await group(2);
    expect(((await alice('groups')) as { groups: unknown[] }).groups).toHaveLength(2);
  });
});

describe('invitations', () => {
  it('rejoindre avec un jeton valide ; partage coupé par défaut ; deuxième ouverture sans effet', async () => {
    const g = await group();
    const { token } = await invite(g);
    expect(await bob('peek', { token })).toMatchObject({ gid: g, member: false });
    expect(await join(bob, token)).toEqual({ gid: g, already: false });
    expect(await join(bob, token)).toEqual({ gid: g, already: true });
    const r = (await bob('poll', { gid: g })) as { members: core.MemberView[] };
    expect(r.members.map((m) => [m.uid, m.role, m.sharing])).toEqual([
      ['u_alice', 'admin', 'off'],
      ['u_bob', 'member', 'off'],
    ]);
  });
  it('expiration', async () => {
    const g = await group();
    const { token } = await invite(g, { ttlMs: 10 * 60_000 });
    now += 11 * 60_000;
    expect(await status(join(bob, token))).toBe(404);
  });
  it('révocation immédiate', async () => {
    const g = await group();
    const { token, invite: inv } = await invite(g);
    await alice('revoke', { gid: g, inviteId: inv.id });
    expect(await status(bob('peek', { token }))).toBe(404);
    expect(((await alice('invites', { gid: g })) as { invites: unknown[] }).invites).toEqual([]);
  });
  it('lien à usage unique : un seul passe', async () => {
    const g = await group();
    const { token } = await invite(g, { maxUses: 1 });
    const results = await Promise.all([status(join(bob, token)), status(join(eve, token))]);
    expect(results.sort()).toEqual([200, 404]);
  });
  it('seuls les admins invitent et voient les liens', async () => {
    const g = await group();
    await join(bob, (await invite(g)).token);
    expect(await status(bob('invite', { gid: g, ttlMs: 3_600_000 }))).toBe(403);
    expect(await status(bob('invites', { gid: g }))).toBe(403);
  });
  it('jeton inventé : erreur générique, puis blocage après 10 essais (pas d’énumération)', async () => {
    await group();
    for (let i = 0; i < 10; i++) expect(await status(eve('peek', { token: `${'x'.repeat(21)}${i}` }))).toBe(404);
    expect(await status(eve('peek', { token: 'y'.repeat(22) }))).toBe(429);
    now += 16 * 60_000;
    expect(await status(eve('peek', { token: 'y'.repeat(22) }))).toBe(404);
  });
  it('le serveur ne garde que l’empreinte du jeton', async () => {
    const g = await group();
    const { token } = await invite(g);
    const { rows } = await db.query<{ token_hash: string }>('SELECT token_hash FROM raveloc_invites');
    expect(rows[0]!.token_hash).not.toContain(token);
    expect(rows[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('partage et positions', () => {
  async function pair() {
    const g = await group();
    await join(bob, (await invite(g)).token);
    return g;
  }
  const bobSeenBy = async (who: typeof alice, g: string) => ((await who('poll', { gid: g })) as { members: core.MemberView[] }).members.find((m) => m.uid === 'u_bob')!;

  it('position refusée tant que le partage n’est pas actif', async () => {
    const g = await pair();
    expect(await status(bob('poll', { gid: g, position: pos(now) }))).toBe(409);
  });
  it('partage actif : la position arrive aux membres, avec son ancienneté sur le serveur', async () => {
    const g = await pair();
    await bob('share', { gid: g, mode: 'on', until: now + 3_600_000 });
    expect(((await bob('poll', { gid: g, position: pos(now) })) as { accepted: boolean }).accepted).toBe(true);
    now += 7000;
    const b = await bobSeenBy(alice, g);
    expect(b.sharing).toBe('on');
    expect(b.position).toEqual({ payload: pos(0).payload, age: 7000 });
  });
  it('positions reçues dans le désordre : la plus ancienne est ignorée', async () => {
    const g = await pair();
    await bob('share', { gid: g, mode: 'on', until: now + 3_600_000 });
    await bob('poll', { gid: g, position: pos(now + 2000, 'new') });
    const r = (await bob('poll', { gid: g, position: pos(now + 1000, 'old') })) as { accepted: boolean };
    expect(r.accepted).toBe(false);
    expect((await bobSeenBy(alice, g)).position?.payload).toBe(pos(0, 'new').payload);
  });
  it('pause : plus d’envoi possible, dernière position visible ; arrêt : position effacée du serveur', async () => {
    const g = await pair();
    await bob('share', { gid: g, mode: 'on', until: now + 3_600_000 });
    await bob('poll', { gid: g, position: pos(now) });
    await bob('share', { gid: g, mode: 'paused' });
    expect(await status(bob('poll', { gid: g, position: pos(now + 1) }))).toBe(409);
    expect(await bobSeenBy(alice, g)).toMatchObject({ sharing: 'paused' });
    expect((await bobSeenBy(alice, g)).position).not.toBeNull();
    await bob('share', { gid: g, mode: 'off' });
    expect(await bobSeenBy(alice, g)).toMatchObject({ sharing: 'off', position: null });
    const { rows } = await db.query('SELECT * FROM raveloc_positions');
    expect(rows).toEqual([]);
  });
  it('partage limité dans le temps (jamais au-delà de la fin du groupe)', async () => {
    const g = await pair();
    const r = (await bob('share', { gid: g, mode: 'on', until: now + 30 * 86_400_000 })) as { shareUntil: number };
    expect(r.shareUntil).toBe(T0 + 12 * 3_600_000);
    await bob('share', { gid: g, mode: 'on', until: now + 10 * 60_000 });
    await bob('poll', { gid: g, position: pos(now) });
    now += 11 * 60_000;
    expect(await bobSeenBy(alice, g)).toMatchObject({ sharing: 'off', position: null });
    await core.purge(db, now);
    expect((await db.query('SELECT * FROM raveloc_positions')).rows).toEqual([]);
  });
  it('quitter : accès coupé immédiatement et position effacée', async () => {
    const g = await pair();
    await bob('share', { gid: g, mode: 'on', until: now + 3_600_000 });
    await bob('poll', { gid: g, position: pos(now) });
    await bob('leave', { gid: g });
    expect(await status(bob('poll', { gid: g }))).toBe(404);
    expect(((await alice('poll', { gid: g })) as { members: unknown[] }).members).toHaveLength(1);
    expect((await db.query('SELECT * FROM raveloc_positions')).rows).toEqual([]);
  });
  it('retrait par un admin : accès coupé immédiatement', async () => {
    const g = await pair();
    expect(await status(bob('remove', { gid: g, uid: 'u_alice' }))).toBe(403);
    await alice('remove', { gid: g, uid: 'u_bob' });
    expect(await status(bob('poll', { gid: g }))).toBe(404);
    expect(await status(bob('share', { gid: g, mode: 'on', until: now + 3_600_000 }))).toBe(404);
  });
  it('dernier admin parti : le plus ancien membre prend le relais ; dernier membre parti : groupe effacé', async () => {
    const g = await pair();
    await alice('leave', { gid: g });
    expect(((await bob('groups')) as { groups: core.GroupSummary[] }).groups[0]!.role).toBe('admin');
    await bob('leave', { gid: g });
    expect((await db.query('SELECT * FROM raveloc_groups')).rows).toEqual([]);
  });
  it('promotion et suppression du groupe par un admin', async () => {
    const g = await pair();
    expect(await status(bob('delete', { gid: g }))).toBe(403);
    await alice('role', { gid: g, uid: 'u_bob', role: 'admin' });
    await bob('delete', { gid: g });
    expect(await status(alice('poll', { gid: g }))).toBe(404);
  });
  it('fin du groupe : plus aucun accès, puis tout est effacé', async () => {
    const g = await pair();
    await bob('share', { gid: g, mode: 'on', until: now + 3_600_000 });
    await bob('poll', { gid: g, position: pos(now) });
    now += 13 * 3_600_000;
    expect(await status(alice('poll', { gid: g }))).toBe(404);
    await core.purge(db, now);
    for (const t of ['raveloc_groups', 'raveloc_members', 'raveloc_positions', 'raveloc_invites']) expect((await db.query(`SELECT * FROM ${t}`)).rows).toEqual([]);
  });
  it('position trop vieille : plus servie', async () => {
    const g = await group(1, 14 * 86_400_000);
    await join(bob, (await invite(g)).token);
    await bob('share', { gid: g, mode: 'on', until: now + 13 * 86_400_000 });
    await bob('poll', { gid: g, position: pos(now) });
    await bob('share', { gid: g, mode: 'paused' });
    now += core.LIMITS.positionTtlMs + 1000;
    expect((await bobSeenBy(alice, g)).position).toBeNull();
  });
  it('limitation des abus : trop d’échanges par minute', async () => {
    const g = await group();
    for (let i = 0; i < 45; i++) await alice('poll', { gid: g });
    expect(await status(alice('poll', { gid: g }))).toBe(429);
    now += 60_000;
    expect(await status(alice('poll', { gid: g }))).toBe(200);
  });
  it('paramètres invalides refusés', async () => {
    const g = await pair();
    await bob('share', { gid: g, mode: 'on', until: now + 3_600_000 });
    expect(await status(bob('poll', { gid: g, position: { payload: 'pas du base64 !', clientAt: now } }))).toBe(400);
    expect(await status(bob('poll', { gid: g, position: { payload: 'A'.repeat(5000), clientAt: now } }))).toBe(400);
    expect(await status(bob('share', { gid: g, mode: 'tout' }))).toBe(400);
    expect(await status(bob('poll', { gid: "'; DROP TABLE raveloc_groups; --" }))).toBe(400);
  });
});
