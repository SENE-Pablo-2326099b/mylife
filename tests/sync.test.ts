import { createHmac, randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import * as core from '../server/core';
import { authDispatch } from '../server/auth';
import { createGroup, dispatch as ravelocDispatch, ensureRavelocSchema } from '../server/raveloc';
import { ensurePushSchema, pushDispatch } from '../server/push';
import { createInvite as createSpaceInvite, createSpace, ensureSpaceSchema, spaceDispatch } from '../server/space';
import { ensureSupportSchema } from '../server/support';
import { supportDispatch } from '../server/support';
import { syncDispatch } from '../server/sync';
import { seedUsers } from './seedUsers';
import {
  autoJoin,
  changePassword,
  checkLogin,
  createAccount,
  deleteAccount,
  passwordIssue,
  passwordKeys,
  passwordStrength,
  renewRecoveryKey,
  join,
  MyLifeApi,
  recoverAccount,
  signIn,
  syncNow,
  type LocalStore,
  type PendingChange,
  type RemoteRow,
  type Session,
  type SyncState,
} from '../packages/sync-client/src/index';

const env: core.Env = { secret: 'x'.repeat(40), invite: 'copains-2026', signup: 'open' };
const random = (n: number) => new Uint8Array(randomBytes(n));

/** Le vrai serveur (core) derrière un faux fetch, sur un vrai Postgres en mémoire. */
async function server(e: core.Env = env, ip = '203.0.113.7') {
  const db = new PGlite();
  await core.ensureSchema(db as unknown as core.Db);
  await ensureRavelocSchema(db as unknown as core.Db);
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    const auth = (init.headers as Record<string, string>).authorization;
    try {
      let out: unknown;
      if (url.endsWith('/api/auth')) {
        out = await authDispatch(db as unknown as core.Db, e, body, auth, { ip });
      } else {
        // Le vrai point d'entrée : la session est vérifiée en base (révocation, compte supprimé).
        out = await syncDispatch(db as unknown as core.Db, e, body, auth);
      }
      return new Response(JSON.stringify(out), { status: 200 });
    } catch (e) {
      const status = e instanceof core.HttpError ? e.status : 500;
      return new Response(JSON.stringify({ error: (e as Error).message }), { status });
    }
  }) as typeof fetch;
  return { db, api: new MyLifeApi('https://mylife.test', fetchImpl) };
}

/** Un appareil : une petite base clé → ligne, avec suivi des modifications comme dans les apps. */
class Device implements LocalStore {
  app = 'finances' as const;
  rows = new Map<string, unknown>();
  queue = new Map<string, { ver: number; at: number }>();
  state: SyncState | null = null;
  session: Session | null = null;
  forget?: () => Promise<void>;
  sessions = { get: async () => this.session, set: async (s: Session | null) => void (this.session = s) };
  write(tbl: string, rid: string, row: unknown | null, at = Date.now()) {
    const k = `${tbl}|${rid}`;
    if (row === null) this.rows.delete(k);
    else this.rows.set(k, row);
    this.queue.set(k, { ver: (this.queue.get(k)?.ver ?? 0) + 1, at });
  }
  async pending(limit: number): Promise<PendingChange[]> {
    return [...this.queue].slice(0, limit).map(([k, q]) => {
      const [tbl = '', rid = ''] = k.split('|');
      return { tbl, rid, ver: q.ver, updatedAt: q.at, row: this.rows.get(k) ?? null };
    });
  }
  async ack(done: Pick<PendingChange, 'tbl' | 'rid' | 'ver'>[]) {
    for (const d of done) if (this.queue.get(`${d.tbl}|${d.rid}`)?.ver === d.ver) this.queue.delete(`${d.tbl}|${d.rid}`);
  }
  async apply(rows: RemoteRow[]) {
    for (const r of rows) {
      if (r.deleted) this.rows.delete(`${r.tbl}|${r.rid}`);
      else this.rows.set(`${r.tbl}|${r.rid}`, r.row);
    }
  }
  async snapshot() {
    return [...this.rows].map(([k, row]) => ({ tbl: k.split('|')[0] ?? '', rid: k.split('|')[1] ?? '', row }));
  }
  async replace(rows: RemoteRow[]) {
    this.rows.clear();
    await this.apply(rows);
  }
  async clearPending() {
    this.queue.clear();
  }
  async getState() {
    return this.state;
  }
  async setState(s: SyncState) {
    this.state = s;
  }
}

describe('comptes MyLife (chiffrement de bout en bout)', () => {
  let srv: Awaited<ReturnType<typeof server>>;
  beforeEach(async () => {
    srv = await server();
  });
  const platform = (d: Device) => ({ api: srv.api, sessions: d.sessions, random });

  it('création, connexion sur un autre appareil : même clé de données', async () => {
    const a = new Device();
    const { session, recoveryKey } = await createAccount(platform(a), { login: 'Camille', password: 'mot-de-passe-long' });
    expect(session.login).toBe('camille');
    expect(recoveryKey).toMatch(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/);
    const b = new Device();
    const s2 = await signIn(platform(b), { login: ' CAMILLE ', password: 'mot-de-passe-long' });
    expect(s2.dek).toBe(session.dek);
  }, 30_000);

  it('inscription ouverte : un identifiant et un mot de passe suffisent (pas de code)', async () => {
    const a = new Device();
    expect(await checkLogin(srv.api, 'Nina')).toBe(true);
    const { session } = await createAccount(platform(a), { login: 'Nina', password: 'mot-de-passe-long' });
    expect(session.login).toBe('nina');
    expect(await checkLogin(srv.api, ' NINA ')).toBe(false);
    await expect(checkLogin(srv.api, 'é')).rejects.toMatchObject({ status: 400 });
  }, 30_000);

  it('mode sur invitation : le code est exigé', async () => {
    const closed = await server({ ...env, signup: 'invite' });
    const p = { api: closed.api, sessions: new Device().sessions, random };
    await expect(createAccount(p, { login: 'leo', password: 'mot-de-passe-long' })).rejects.toMatchObject({ status: 403 });
    await expect(createAccount(p, { login: 'leo', password: 'mot-de-passe-long', invite: 'faux' })).rejects.toMatchObject({ status: 403 });
    expect((await createAccount(p, { login: 'leo', password: 'mot-de-passe-long', invite: 'copains-2026' })).session.login).toBe('leo');
  }, 30_000);

  it('refuse mauvais mot de passe, identifiant pris', async () => {
    const a = new Device();
    await createAccount(platform(a), { login: 'leo', password: 'mot-de-passe-long' });
    await expect(createAccount(platform(a), { login: 'leo', password: 'autre-mot-de-passe' })).rejects.toMatchObject({ status: 409 });
    await expect(signIn(platform(new Device()), { login: 'leo', password: 'pas-le-bon' })).rejects.toMatchObject({ status: 401 });
    await expect(signIn(platform(new Device()), { login: 'inconnu', password: 'peu-importe' })).rejects.toMatchObject({ status: 401 });
  }, 30_000);

  it('identifiant inconnu : un sel stable, sans révéler que le compte n’existe pas', async () => {
    const s1 = await core.getSalt(srv.db as unknown as core.Db, env, { login: 'personne' });
    const s2 = await core.getSalt(srv.db as unknown as core.Db, env, { login: 'personne' });
    expect(s1).toEqual(s2);
    expect(s1.salt).toMatch(/^[0-9a-f]{32}$/);
  });

  it('mot de passe oublié : la clé de secours rend l’accès, les données restent lisibles', async () => {
    const a = new Device();
    const { session, recoveryKey } = await createAccount(platform(a), { login: 'ines', password: 'premier-mot-de-passe' });
    a.write('accounts', 'bnp', { name: 'BNP', balance: 12345 });
    await join(a, srv.api, session, random);
    const b = new Device();
    const s = await recoverAccount(platform(b), { login: 'ines', recoveryKey: recoveryKey.toLowerCase().replace(/-/g, ' '), newPassword: 'nouveau-mot-de-passe' });
    expect(s.dek).toBe(session.dek);
    await expect(signIn(platform(new Device()), { login: 'ines', password: 'premier-mot-de-passe' })).rejects.toMatchObject({ status: 401 });
    const c = new Device();
    const s3 = await signIn(platform(c), { login: 'ines', password: 'nouveau-mot-de-passe' });
    await join(c, srv.api, s3, random);
    expect(c.rows.get('accounts|bnp')).toEqual({ name: 'BNP', balance: 12345 });
    await expect(recoverAccount(platform(new Device()), { login: 'ines', recoveryKey: 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA', newPassword: 'un-autre-mot-de-passe' })).rejects.toMatchObject({ status: 401 });
  }, 60_000);
});

describe('synchronisation entre appareils', () => {
  it('PC ↔ téléphone : envoi, récupération, modifications, suppressions, conflit, sans écho', async () => {
    const srv = await server();
    const phone = new Device();
    const pc = new Device();
    const { session } = await createAccount({ api: srv.api, sessions: phone.sessions, random }, { login: 'camille', password: 'mot-de-passe-long' });
    // Le téléphone a déjà des données : il alimente le compte vide.
    phone.write('transactions', 't1', { label: 'Carrefour', amount: -2350 });
    phone.write('transactions', 't2', { label: 'Loyer', amount: -40000 });
    phone.write('investmentOps', 'op1', { type: 'buy', amount: 3345 }); // nom de table en camelCase (MyFinances)
    expect(await join(phone, srv.api, session, random)).toEqual({ action: 'uploaded', count: 3 });
    // Le PC avait d'autres données (ancienne copie) : il prend celles du compte.
    pc.write('transactions', 'vieux', { label: 'Ancienne copie' });
    pc.session = session;
    expect((await join(pc, srv.api, session, random)).action).toBe('downloaded');
    expect([...pc.rows.keys()].sort()).toEqual(['investmentOps|op1', 'transactions|t1', 'transactions|t2']);

    // Modifications des deux côtés.
    pc.write('transactions', 't3', { label: 'Resto', amount: -1800 });
    phone.write('transactions', 't2', null); // suppression
    expect(await syncNow(pc, srv.api, session, random)).toEqual({ pushed: 1, pulled: 0 });
    const r = await syncNow(phone, srv.api, session, random);
    expect(r).toEqual({ pushed: 1, pulled: 1 });
    expect(phone.rows.get('transactions|t3')).toEqual({ label: 'Resto', amount: -1800 });
    await syncNow(pc, srv.api, session, random);
    expect(pc.rows.has('transactions|t2')).toBe(false);

    // Conflit : la modification la plus récente gagne, quel que soit l'ordre d'envoi.
    const t = Date.now() + 10_000;
    pc.write('transactions', 't1', { label: 'Carrefour (PC)' }, t + 2_000);
    phone.write('transactions', 't1', { label: 'Carrefour (tél)' }, t + 1_000);
    await syncNow(pc, srv.api, session, random);
    await syncNow(phone, srv.api, session, random);
    await syncNow(pc, srv.api, session, random);
    expect(phone.rows.get('transactions|t1')).toEqual({ label: 'Carrefour (PC)' });
    expect(pc.rows.get('transactions|t1')).toEqual({ label: 'Carrefour (PC)' });

    // Une modification plus ancienne que celle du compte est refusée, et l'appareil s'aligne.
    pc.write('transactions', 't3', { label: 'Resto (vieille modif)' }, 5);
    await syncNow(pc, srv.api, session, random);
    expect(pc.rows.get('transactions|t3')).toEqual({ label: 'Resto', amount: -1800 });

    // Rien de nouveau : rien ne revient (pas d'écho de ses propres envois).
    expect(await syncNow(pc, srv.api, session, random)).toEqual({ pushed: 0, pulled: 0 });
  }, 30_000);

  it('le serveur ne stocke rien de lisible', async () => {
    const srv = await server();
    const d = new Device();
    const { session } = await createAccount({ api: srv.api, sessions: d.sessions, random }, { login: 'zoe', password: 'mot-de-passe-long' });
    d.write('transactions', 't1', { label: 'Pharmacie Lafayette', amount: -1234 });
    await join(d, srv.api, session, random);
    const { rows } = await srv.db.query<{ payload: string }>('SELECT payload FROM records');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload).not.toMatch(/Pharmacie|1234/);
    const users = await srv.db.query('SELECT * FROM users');
    expect(JSON.stringify(users.rows)).not.toMatch(/mot-de-passe/);
  }, 30_000);

  it('« garder les données de cet appareil » remplace celles du compte', async () => {
    const srv = await server();
    const a = new Device();
    const b = new Device();
    const { session } = await createAccount({ api: srv.api, sessions: a.sessions, random }, { login: 'max', password: 'mot-de-passe-long' });
    a.write('workouts', 'w1', { name: 'A' });
    await join(a, srv.api, session, random);
    b.write('workouts', 'w9', { name: 'B' });
    expect((await join(b, srv.api, session, random, 'useDevice')).action).toBe('uploaded');
    await syncNow(a, srv.api, session, random);
    // A reçoit les lignes de B ; la ligne w1 n'existe plus côté compte (A la garde jusqu'à ce qu'il rejoigne à nouveau).
    expect(a.rows.get('workouts|w9')).toEqual({ name: 'B' });
  }, 30_000);

  it('jeton falsifié ou expiré refusé', () => {
    const t = core.signToken('u1', env.secret, 0);
    expect(core.verifyToken(t, env.secret, 1000)).toBe('u1');
    expect(core.verifyToken(t, env.secret, 400 * 86_400_000)).toBeNull();
    expect(core.verifyToken(t.replace(/.$/, 'A'), env.secret, 1000)).toBeNull();
    expect(core.verifyToken(t, 'y'.repeat(40), 1000)).toBeNull();
  });
});

describe('chiffrement des lignes', () => {
  it('aller-retour fidèle : accents, émojis, nombres ; lié à son emplacement', async () => {
    const { encryptRow, decryptRow } = await import('../packages/sync-client/src/crypto');
    const dek = random(32);
    const row = { label: 'Café « Élysée » ☕ 🏋️‍♂️', amount: -1234, nested: { ok: true, list: [1, 2.5, null] } };
    const payload = encryptRow(dek, 'perf', 'sets', 's1', row, random);
    expect(decryptRow(dek, 'perf', 'sets', 's1', payload)).toEqual(row);
    expect(() => decryptRow(dek, 'perf', 'sets', 'autre-ligne', payload)).toThrow();
    expect(() => decryptRow(random(32), 'perf', 'sets', 's1', payload)).toThrow();
  });
});

describe('compte comme une app ordinaire', () => {
  it('dérivation native (WebCrypto) identique à la version JavaScript de l’app Android', async () => {
    const { pbkdf2Async } = await import('@noble/hashes/pbkdf2.js');
    const { sha256 } = await import('@noble/hashes/sha2.js');
    const { hkdf } = await import('@noble/hashes/hkdf.js');
    const salt = '00112233445566778899aabbccddeeff';
    const fast = await passwordKeys('Été-2026 ☀', salt, 200_000);
    const master = await pbkdf2Async(sha256, new TextEncoder().encode('Été-2026 ☀'.normalize('NFKC')), Buffer.from(salt, 'hex'), { c: 200_000, dkLen: 32 });
    const auth = Buffer.from(hkdf(sha256, master, undefined, new TextEncoder().encode('mylife/auth/v1'), 32)).toString('hex');
    expect(fast.authKey).toBe(auth);
  }, 60_000);

  it('mots de passe : trop courts, trop connus ou contenant l’identifiant refusés ; robustesse indicative', () => {
    expect(passwordIssue('court')).toMatch(/8 caractères/);
    expect(passwordIssue('azertyuiop')).toMatch(/courant/);
    expect(passwordIssue('aaaaaaaaaa')).toMatch(/courant/);
    expect(passwordIssue('camille-2026!', 'Camille')).toMatch(/identifiant/);
    expect(passwordIssue('cheval-agrafe-pile')).toBeNull();
    expect(passwordStrength('abc')).toBe(0);
    expect(passwordStrength('cheval-agrafe-pile-Rouge7')).toBe(4);
  });

  it('garde-fous : comptes par réseau et par jour, essais de mot de passe', async () => {
    const srv = await server();
    const p = () => ({ api: srv.api, sessions: new Device().sessions, random });
    for (let i = 0; i < core.RATES.signup.max; i++) await createAccount(p(), { login: `ami${i}`, password: 'mot-de-passe-long' });
    await expect(createAccount(p(), { login: 'encore-un', password: 'mot-de-passe-long' })).rejects.toMatchObject({ status: 429 });
    // 10 mauvais mots de passe : même le bon est refusé un quart d'heure (pas de devinette en ligne).
    for (let i = 0; i < core.RATES.badPassword.max; i++) await expect(signIn(p(), { login: 'ami0', password: `faux-${i}-xxxx` })).rejects.toMatchObject({ status: 401 });
    await expect(signIn(p(), { login: 'ami0', password: 'mot-de-passe-long' })).rejects.toMatchObject({ status: 429 });
    // Un autre réseau peut toujours créer son compte.
    const other = await server(env, '198.51.100.1');
    expect((await createAccount({ api: other.api, sessions: new Device().sessions, random }, { login: 'voisin', password: 'mot-de-passe-long' })).session.login).toBe('voisin');
  }, 120_000);

  it('nouvelle clé de secours : l’ancienne ne marche plus, la nouvelle oui', async () => {
    const srv = await server();
    const a = new Device();
    const { session, recoveryKey } = await createAccount({ api: srv.api, sessions: a.sessions, random }, { login: 'lou', password: 'mot-de-passe-long' });
    const fresh = await renewRecoveryKey({ api: srv.api, sessions: a.sessions, random }, session);
    const p = { api: srv.api, sessions: new Device().sessions, random };
    await expect(recoverAccount(p, { login: 'lou', recoveryKey, newPassword: 'nouveau-mot-de-passe' })).rejects.toMatchObject({ status: 401 });
    expect((await recoverAccount(p, { login: 'lou', recoveryKey: fresh, newPassword: 'nouveau-mot-de-passe' })).dek).toBe(session.dek);
  }, 60_000);

  it('supprimer son compte : mot de passe redemandé, données et groupes effacés du serveur', async () => {
    const srv = await server();
    const a = new Device();
    const plat = { api: srv.api, sessions: a.sessions, random };
    const { session } = await createAccount(plat, { login: 'sam', password: 'mot-de-passe-long' });
    a.write('transactions', 't1', { label: 'x' });
    await join(a, srv.api, session, random);
    const uid = core.verifyToken(session.token, env.secret)!;
    const blob = (seed: string, n = 60) => Buffer.from(seed.repeat(n)).toString('base64').slice(0, n);
    await createGroup(srv.db as unknown as core.Db, uid, { gid: 'a'.repeat(32), name: blob('name'), profile: blob('sam'), wrappedKey: blob('key', 80), durationMs: 3_600_000 });
    expect((await srv.db.query('SELECT * FROM raveloc_members')).rows).toHaveLength(1);
    await expect(deleteAccount(plat, session, 'pas-le-bon-mdp')).rejects.toMatchObject({ status: 401 });
    await deleteAccount(plat, session, 'mot-de-passe-long');
    expect(a.session).toBeNull();
    expect((await srv.db.query('SELECT * FROM records')).rows).toHaveLength(0);
    expect((await srv.db.query('SELECT * FROM users')).rows).toHaveLength(0);
    expect((await srv.db.query('SELECT * FROM raveloc_members')).rows).toHaveLength(0);
    // L'identifiant redevient libre.
    expect(await checkLogin(srv.api, 'sam')).toBe(true);
  }, 60_000);

  it('reliure automatique : compte vide → envoi ; appareil neuf → récupération ; les deux remplis → on demande', async () => {
    const srv = await server();
    const a = new Device();
    const { session } = await createAccount({ api: srv.api, sessions: a.sessions, random }, { login: 'eli', password: 'mot-de-passe-long' });
    a.write('workouts', 'w1', { name: 'A' });
    // Compte neuf, appareil déjà rempli (avant tout compte) : on demande, rien n'est envoyé d'office.
    expect(await autoJoin(a, srv.api, session, random, async () => true)).toEqual({ action: 'ask', account: 0, lastUpdated: null });
    expect(await join(a, srv.api, session, random, 'useDevice')).toEqual({ action: 'uploaded', count: 1 });
    const fresh = new Device();
    fresh.write('settings', 'main', { defaults: true });
    expect((await autoJoin(fresh, srv.api, session, random, async () => false)).action).toBe('downloaded');
    expect(fresh.rows.get('workouts|w1')).toEqual({ name: 'A' });
    const busy = new Device();
    busy.write('workouts', 'w9', { name: 'B' });
    expect(await autoJoin(busy, srv.api, session, random, async () => true)).toMatchObject({ action: 'ask', account: 1 });
    expect(busy.state?.joinedAs ?? null).toBeNull();
  }, 60_000);

  it('un autre compte sur le même appareil ne reçoit jamais les données du précédent', async () => {
    const srv = await server();
    const d = new Device();
    let forgotten = 0;
    d.forget = async () => {
      forgotten++;
      d.rows.clear();
    };
    const first = await createAccount({ api: srv.api, sessions: d.sessions, random }, { login: 'premier', password: 'mot-de-passe-long' });
    expect((await autoJoin(d, srv.api, first.session, random, async () => false)).action).toBe('uploaded');
    d.write('workouts', 'w1', { name: 'Séance du premier' });
    d.write('settings', 'main', { salaire: 2100 });
    await syncNow(d, srv.api, first.session, random);
    // Déconnexion, puis un compte neuf sur le même navigateur : il part de zéro, sans question.
    const second = await createAccount({ api: srv.api, sessions: d.sessions, random }, { login: 'second', password: 'mot-de-passe-long' });
    expect(await autoJoin(d, srv.api, second.session, random, async () => true)).toEqual({ action: 'downloaded', count: 0 });
    expect(forgotten).toBe(1);
    expect(d.rows.size).toBe(0);
    expect(d.state?.joinedAs).toBe('second');
    // Et le compte du second n'a rien reçu du premier.
    const other = new Device();
    expect(await join(other, srv.api, second.session, random, 'useAccount')).toEqual({ action: 'downloaded', count: 0 });
    // Le premier retrouve ses données en se reconnectant.
    const again = await signIn({ api: srv.api, sessions: d.sessions, random }, { login: 'premier', password: 'mot-de-passe-long' });
    expect((await autoJoin(d, srv.api, again, random, async () => false)).action).toBe('downloaded');
    expect(d.rows.get('workouts|w1')).toEqual({ name: 'Séance du premier' });
  }, 60_000);

  it('quota de stockage par app', async () => {
    const srv = await server();
    const { session } = await createAccount({ api: srv.api, sessions: new Device().sessions, random }, { login: 'quota', password: 'mot-de-passe-long' });
    const uid = core.verifyToken(session.token, env.secret)!;
    const changes = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ tbl: 'prefs', rid: `r${from + i}`, updatedAt: 1, deleted: false, payload: 'A'.repeat(40) }));
    await core.sync(srv.db as unknown as core.Db, uid, { app: 'mylife', device: 'device-1', cursor: 0, changes: changes(core.ROW_QUOTA.mylife) });
    await expect(core.sync(srv.db as unknown as core.Db, uid, { app: 'mylife', device: 'device-1', cursor: 0, changes: changes(1, 999) })).rejects.toMatchObject({ status: 413 });
  }, 30_000);
});

describe('sessions révocables et suppression de compte tout ou rien', () => {
  const PW = 'mot-de-passe-long';
  const bearer = (t: string) => `Bearer ${t}`;
  /** Un jeton d'avant la génération de session (charge `{ uid, exp }` seulement), signé comme à l'époque. */
  const legacyToken = (uid: string) => {
    const payload = Buffer.from(JSON.stringify({ uid, exp: Date.now() + 86_400_000 })).toString('base64url');
    return `${payload}.${createHmac('sha256', env.secret).update(payload).digest('base64url')}`;
  };
  /** Tous les points d'entrée qui exigent une session, appelés avec ce jeton : leur statut HTTP (200 si accepté). */
  async function statuses(db: core.Db, token: string): Promise<number[]> {
    const calls: (() => Promise<unknown>)[] = [
      () => syncDispatch(db, env, { action: 'status', app: 'finances' }, bearer(token)),
      () => authDispatch(db, env, { action: 'renewRecovery', recAuth: 'f'.repeat(64), recWrappedKey: 'A'.repeat(40) }, bearer(token), { ip: '' }),
      () => spaceDispatch(db, env.secret, bearer(token), { action: 'list' }),
      () => ravelocDispatch(db, env.secret, bearer(token), { action: 'groups' }),
      () => pushDispatch(db, env.secret, bearer(token), { action: 'status', endpoint: 'https://push.exemple.test/abonnement-1' }, null),
      () => supportDispatch(db, env.secret, bearer(token), { action: 'send', kind: 'bug', message: 'Ça plante' }),
    ];
    const out: number[] = [];
    for (const call of calls) {
      try {
        await call();
        out.push(200);
      } catch (e) {
        out.push(e instanceof core.HttpError ? e.status : 500);
      }
    }
    return out;
  }
  const revoked = (codes: number[]) => codes.every((c) => c === 401);

  it('changer de mot de passe coupe les sessions des autres appareils (et les jetons d’avant) ; celui qui le change continue', async () => {
    const srv = await server();
    const db = srv.db as unknown as core.Db;
    const { ensureSpaceSchema } = await import('../server/space');
    await ensureSpaceSchema(db);
    await ensurePushSchema(db);
    const a = new Device();
    const pa = { api: srv.api, sessions: a.sessions, random };
    const { session } = await createAccount(pa, { login: 'zoe', password: PW });
    a.write('accounts', 'bnp', { balance: 1 });
    await join(a, srv.api, session, random);
    const b = new Device();
    const sb = await signIn({ api: srv.api, sessions: b.sessions, random }, { login: 'zoe', password: PW });
    await join(b, srv.api, sb, random);
    const uid = core.verifyToken(session.token, env.secret)!;
    const old = legacyToken(uid);
    // Avant : toutes ces sessions valent (un jeton d'avant la génération aussi, pour ne déconnecter personne au déploiement).
    expect(revoked(await statuses(db, old))).toBe(false);
    expect(await core.verifySession(db, old, env.secret)).toBe(uid);

    await changePassword(pa, session, 'nouveau-mot-de-passe');
    // L'appareil qui a changé le mot de passe a reçu une nouvelle session et continue sans se reconnecter.
    expect(a.session!.token).not.toBe(session.token);
    a.write('accounts', 'bnp', { balance: 2 });
    expect((await syncNow(a, srv.api, a.session!, random)).pushed).toBe(1);
    // L'autre appareil, l'ancienne session du premier et le jeton d'avant : refusés partout.
    for (const t of [sb.token, session.token, old]) {
      expect(await core.verifySession(db, t, env.secret)).toBeNull();
      expect(await statuses(db, t)).toEqual([401, 401, 401, 401, 401, 401]);
    }
    await expect(syncNow(b, srv.api, sb, random)).rejects.toMatchObject({ status: 401 });
    // Il se reconnecte avec le nouveau mot de passe : même clé de données, il reçoit la modification.
    const sb2 = await signIn({ api: srv.api, sessions: b.sessions, random }, { login: 'zoe', password: 'nouveau-mot-de-passe' });
    expect(sb2.dek).toBe(session.dek);
    await syncNow(b, srv.api, sb2, random);
    expect(b.rows.get('accounts|bnp')).toEqual({ balance: 2 });
  }, 60_000);

  it('passer par la clé de secours coupe toutes les sessions ouvertes ; seule la nouvelle vaut', async () => {
    const srv = await server();
    const db = srv.db as unknown as core.Db;
    const a = new Device();
    const { session, recoveryKey } = await createAccount({ api: srv.api, sessions: a.sessions, random }, { login: 'max', password: PW });
    const c = new Device();
    const fresh = await recoverAccount({ api: srv.api, sessions: c.sessions, random }, { login: 'max', recoveryKey, newPassword: 'nouveau-mot-de-passe' });
    expect(await core.verifySession(db, session.token, env.secret)).toBeNull();
    await expect(syncDispatch(db, env, { action: 'status', app: 'finances' }, bearer(session.token))).rejects.toMatchObject({ status: 401 });
    expect(await core.verifySession(db, fresh.token, env.secret)).toBe(core.verifyToken(session.token, env.secret));
    // Une connexion ordinaire ensuite reçoit une session de la génération en cours.
    const again = await signIn({ api: srv.api, sessions: new Device().sessions, random }, { login: 'max', password: 'nouveau-mot-de-passe' });
    expect(await core.verifySession(db, again.token, env.secret)).not.toBeNull();
  }, 60_000);

  it('suppression : une panne au milieu n’efface rien (le compte reste entier, on réessaie) ; réussie, ses jetons ne valent plus nulle part', async () => {
    const srv = await server();
    const db = srv.db as unknown as core.Db;
    await ensurePushSchema(db);
    const a = new Device();
    const plat = { api: srv.api, sessions: a.sessions, random };
    const { session } = await createAccount(plat, { login: 'sam', password: PW });
    a.write('transactions', 't1', { label: 'x' });
    await join(a, srv.api, session, random);
    const uid = core.verifyToken(session.token, env.secret)!;
    const blob = (seed: string, n = 60) => Buffer.from(seed.repeat(n)).toString('base64').slice(0, n);
    await createGroup(db, uid, { gid: 'a'.repeat(32), name: blob('name'), profile: blob('sam'), wrappedKey: blob('key', 80), durationMs: 3_600_000 });
    await supportDispatch(db, env.secret, bearer(session.token), { action: 'send', kind: 'bug', message: 'Ça plante' });
    await db.query(`INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, created_at) VALUES ('https://push.exemple.test/abonnement-1', $1, 'p', 'a', 0)`, [uid]);
    const count = async (table: string) => (await db.query(`SELECT 1 FROM ${table}`)).rows.length;
    const snapshot = async () => [await count('users'), await count('records'), await count('raveloc_members'), await count('support_messages'), await count('push_subscriptions')];
    const before = await snapshot();
    expect(before.every((n) => n > 0)).toBe(true);

    // La dernière étape tombe en panne (après le départ des groupes et l'effacement des messages) : tout est annulé.
    const { salt, iterations } = await core.getSalt(db, env, { login: 'sam' });
    const { authKey } = await passwordKeys(PW, salt, iterations);
    const flaky = (d: Pick<core.Db, 'query'>) => ((text: string, params?: unknown[]) => (/DELETE FROM push_subscriptions/.test(text) ? Promise.reject(new Error('panne simulée')) : d.query(text, params))) as core.Db['query'];
    const broken: core.Db = { query: flaky(db), transaction: (fn) => db.transaction((tx) => fn({ query: flaky(tx), transaction: tx.transaction })) };
    await expect(authDispatch(broken, env, { action: 'deleteAccount', authKey }, bearer(session.token), { ip: '' })).rejects.toThrow('panne simulée');
    expect(await snapshot()).toEqual(before);
    expect(await core.verifySession(db, session.token, env.secret)).toBe(uid);

    // On réessaie : tout part, et le jeton (pourtant bien signé et non échu) ne vaut plus nulle part.
    await deleteAccount(plat, session, PW);
    expect(await snapshot()).toEqual([0, 0, 0, 0, 0]);
    expect(core.verifyToken(session.token, env.secret)).toBe(uid);
    expect(await core.verifySession(db, session.token, env.secret)).toBeNull();
    expect(await statuses(db, session.token)).toEqual([401, 401, 401, 401, 401, 401]);
  }, 60_000);

  /**
   * Garde-fou de la suppression de compte (plutôt qu'un effacement en cascade dans la base, qui demanderait de migrer
   * la production) : toute table connue est soit vidée du compte, soit sans donnée de compte. Une table ajoutée sans
   * passer par ici fait échouer le test ; et après suppression, l'identifiant du compte n'apparaît plus nulle part.
   */
  it('suppression : aucune table ne garde trace du compte, et toute nouvelle table doit être déclarée ici', async () => {
    const srv = await server();
    const db = srv.db as unknown as core.Db;
    await ensurePushSchema(db);
    await ensureSpaceSchema(db);
    await ensureSupportSchema(db);
    const TABLES: Record<string, string> = {
      users: 'le compte',
      records: 'ses données synchronisées',
      records_purge: 'ses curseurs de purge',
      raveloc_groups: 'ses groupes MyRave (effacés quand il était seul)',
      raveloc_members: 'ses adhésions MyRave',
      raveloc_positions: 'ses positions MyRave',
      raveloc_invites: 'les liens de ses groupes',
      spaces: 'ses espaces (effacés quand il était seul)',
      space_members: 'ses adhésions aux espaces',
      space_records: 'ses lignes dans les espaces',
      space_invites: 'les liens de ses espaces',
      support_messages: 'ses messages au support',
      push_subscriptions: 'ses abonnements aux notifications',
      push_wakeups: 'les heures de réveil de ses abonnements',
      auth_rate: 'sans donnée de compte : compteurs d’essais par empreinte',
      space_rate: 'sans donnée de compte : compteurs par empreinte',
      raveloc_rate: 'sans donnée de compte : compteurs par empreinte',
      push_state: 'sans donnée de compte : état de l’envoi',
    };
    const tables = (await db.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`)).rows.map((r) => r.table_name);
    expect(tables.filter((t) => !(t in TABLES)), 'nouvelle table : l’effacer à la suppression du compte (server/auth.ts), puis la déclarer ici').toEqual([]);

    // Un compte qui a tout utilisé, et un autre qui reste.
    const a = new Device();
    const plat = { api: srv.api, sessions: a.sessions, random };
    const { session } = await createAccount(plat, { login: 'lou', password: PW });
    await createAccount({ api: srv.api, sessions: new Device().sessions, random }, { login: 'reste', password: PW });
    a.write('transactions', 't1', { label: 'x' });
    await join(a, srv.api, session, random);
    const uid = core.verifyToken(session.token, env.secret)!;
    const blob = (seed: string, n = 60) => Buffer.from(seed.repeat(n)).toString('base64').slice(0, n);
    await createGroup(db, uid, { gid: 'b'.repeat(32), name: blob('name'), profile: blob('lou'), wrappedKey: blob('key', 80), durationMs: 3_600_000 });
    await createSpace(db, uid, { id: 'c'.repeat(32), kind: 'crew', name: blob('crew'), profile: blob('lou'), wrappedKey: blob('key', 80) });
    await createSpaceInvite(db, uid, { sid: 'c'.repeat(32) });
    await db.query(`INSERT INTO space_records (space_id, tbl, rid, author, open, seq, updated_at, deleted, payload) VALUES ($1, 'notes', 'n1', $2, false, 1, 0, false, 'x')`, ['c'.repeat(32), uid]);
    await supportDispatch(db, env.secret, bearer(session.token), { action: 'send', kind: 'bug', message: 'Ça plante' });
    await db.query(`INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, created_at) VALUES ('https://push.exemple.test/abonnement-2', $1, 'p', 'a', 0)`, [uid]);
    await db.query(`INSERT INTO push_wakeups (endpoint, minute) VALUES ('https://push.exemple.test/abonnement-2', 480)`);

    /** Les colonnes texte où figure l'identifiant du compte (ou l'adresse de son abonnement), table par table. */
    const traces = async () => {
      const cols = (await db.query<{ table_name: string; column_name: string }>(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND data_type = 'text'`)).rows;
      const found: string[] = [];
      for (const c of cols) {
        const { rows } = await db.query(`SELECT 1 FROM ${c.table_name} WHERE ${c.column_name} IN ($1, $2) LIMIT 1`, [uid, 'https://push.exemple.test/abonnement-2']);
        if (rows.length) found.push(`${c.table_name}.${c.column_name}`);
      }
      return found.sort();
    };
    expect(await traces()).toEqual(expect.arrayContaining(['users.id', 'records.user_id', 'raveloc_members.user_id', 'space_members.user_id', 'space_records.author', 'support_messages.user_id', 'push_subscriptions.user_id', 'push_wakeups.endpoint']));
    await deleteAccount(plat, session, PW);
    expect(await traces()).toEqual([]);
    expect((await db.query('SELECT 1 FROM users')).rows.length).toBe(1);
  }, 60_000);
});

describe('synchronisation : dates bornées et remplacement tout ou rien', () => {
  const NOW = Date.parse('2026-11-21T12:00:00Z');
  const YEAR = 365 * 86_400_000;
  async function setup() {
    const srv = await server();
    const db = srv.db as unknown as core.Db;
    await seedUsers(db, 'u1');
    const write = (device: string, rows: { rid: string; at: number; payload?: string }[], now: number, extra: Record<string, unknown> = {}) =>
      core.sync(db, 'u1', { app: 'mylife', device, cursor: 0, changes: rows.map((r) => ({ tbl: 't', rid: r.rid, updatedAt: r.at, deleted: false, payload: r.payload ?? `v-${device}` })), ...extra }, now);
    const stored = async (rid: string) => (await db.query<{ updated_at: string; payload: string }>('SELECT updated_at, payload FROM records WHERE rid = $1', [rid])).rows[0];
    return { db, write, stored };
  }

  it('une date lointaine (horloge déréglée) est ramenée à quelques minutes : un autre appareil peut ensuite modifier la ligne', async () => {
    const { write, stored } = await setup();
    await write('appareil-a', [{ rid: 'x', at: NOW + YEAR }], NOW);
    expect(Number((await stored('x'))!.updated_at)).toBe(NOW + core.CLOCK_SKEW_MS);
    // Dix minutes plus tard, une vraie modification ailleurs l'emporte.
    const later = NOW + 10 * 60_000;
    expect((await write('appareil-b', [{ rid: 'x', at: later }], later)).accepted).toBe(1);
    expect((await stored('x'))!.payload).toBe('v-appareil-b');
    // Une date négative ou nulle ne passe pas devant non plus.
    await write('appareil-a', [{ rid: 'y', at: -5 }], NOW);
    expect(Number((await stored('y'))!.updated_at)).toBe(0);
  }, 30_000);

  it('une ligne déjà enregistrée avec une date future (avant cette borne) ne bloque plus : elle est remplacée, sans migration', async () => {
    const { db, write, stored } = await setup();
    await db.query(`INSERT INTO records (user_id, app, tbl, rid, seq, updated_at, deleted, device, payload) VALUES ('u1','mylife','t','z',nextval('records_seq'),$1,false,'ancien','bloquee')`, [NOW + 50 * YEAR]);
    expect((await write('appareil-b', [{ rid: 'z', at: NOW }], NOW)).accepted).toBe(1);
    expect((await stored('z'))!.payload).toBe('v-appareil-b');
  }, 30_000);

  it('la plus récente gagne toujours : une modification plus ancienne est refusée et l’appareil reçoit la version du compte', async () => {
    const { write, stored } = await setup();
    await write('appareil-a', [{ rid: 'x', at: NOW }], NOW);
    const r = await write('appareil-b', [{ rid: 'x', at: NOW - 60_000 }], NOW);
    expect(r.accepted).toBe(0);
    expect(r.changes.map((c) => [c.rid, c.payload])).toEqual([['x', 'v-appareil-a']]);
    expect((await stored('x'))!.payload).toBe('v-appareil-a');
  }, 30_000);

  it('remplacer le compte (« garder les données de cet appareil ») : si le lot est refusé (quota), le compte reste intact', async () => {
    const { db, write } = await setup();
    await write('appareil-a', [{ rid: 'garde-1', at: NOW }, { rid: 'garde-2', at: NOW }], NOW);
    const tooMany = Array.from({ length: core.ROW_QUOTA.mylife + 1 }, (_, i) => ({ rid: `n${i}`, at: NOW }));
    await expect(write('appareil-b', tooMany, NOW, { reset: true })).rejects.toMatchObject({ status: 413 });
    expect((await db.query<{ rid: string }>('SELECT rid FROM records ORDER BY rid')).rows.map((r) => r.rid)).toEqual(['garde-1', 'garde-2']);
    // Un lot valable remplace bien tout.
    await write('appareil-b', [{ rid: 'nouveau', at: NOW }], NOW, { reset: true });
    expect((await db.query<{ rid: string }>('SELECT rid FROM records')).rows.map((r) => r.rid)).toEqual(['nouveau']);
  }, 30_000);
});
