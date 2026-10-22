import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import * as core from '../server/core';
import { authDispatch } from '../server/auth';
import { createGroup, ensureRavelocSchema } from '../server/raveloc';
import {
  autoJoin,
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
        const uid = core.verifyToken(auth, env.secret);
        if (!uid) throw new core.HttpError(401, 'Session expirée');
        out = body.action === 'status' ? await core.syncStatus(db as unknown as core.Db, uid, body) : await core.sync(db as unknown as core.Db, uid, body);
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
    const { session, recoveryKey } = await createAccount(platform(a), { login: 'Pablo', password: 'mot-de-passe-long' });
    expect(session.login).toBe('pablo');
    expect(recoveryKey).toMatch(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/);
    const b = new Device();
    const s2 = await signIn(platform(b), { login: ' PABLO ', password: 'mot-de-passe-long' });
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
    const { session } = await createAccount({ api: srv.api, sessions: phone.sessions, random }, { login: 'pablo', password: 'mot-de-passe-long' });
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
    expect(passwordIssue('pablo-2026!', 'Pablo')).toMatch(/identifiant/);
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
    expect(await autoJoin(a, srv.api, session, random, async () => true)).toEqual({ action: 'uploaded', count: 1 });
    const fresh = new Device();
    fresh.write('settings', 'main', { defaults: true });
    expect((await autoJoin(fresh, srv.api, session, random, async () => false)).action).toBe('downloaded');
    expect(fresh.rows.get('workouts|w1')).toEqual({ name: 'A' });
    const busy = new Device();
    busy.write('workouts', 'w9', { name: 'B' });
    expect(await autoJoin(busy, srv.api, session, random, async () => true)).toMatchObject({ action: 'ask', account: 1 });
    expect(busy.state?.joinedAs ?? null).toBeNull();
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
