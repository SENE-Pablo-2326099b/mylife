import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import * as core from '../server/core';
import {
  createAccount,
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

const env: core.Env = { secret: 'x'.repeat(40), invite: 'copains-2026' };
const random = (n: number) => new Uint8Array(randomBytes(n));

/** Le vrai serveur (core) derrière un faux fetch, sur un vrai Postgres en mémoire. */
async function server() {
  const db = new PGlite();
  await core.ensureSchema(db as unknown as core.Db);
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    const auth = (init.headers as Record<string, string>).authorization;
    try {
      let out: unknown;
      if (url.endsWith('/api/auth')) {
        const fn = { salt: core.getSalt, signup: core.signup, login: core.login, recoverStart: core.recoverStart, recoverFinish: core.recoverFinish }[body.action as string];
        out = await fn!(db as unknown as core.Db, env, body);
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
      const [tbl, rid] = k.split('|');
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
    return [...this.rows].map(([k, row]) => ({ tbl: k.split('|')[0], rid: k.split('|')[1], row }));
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
    const { session, recoveryKey } = await createAccount(platform(a), { login: 'Pablo', password: 'mot-de-passe-long', invite: 'copains-2026' });
    expect(session.login).toBe('pablo');
    expect(recoveryKey).toMatch(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/);
    const b = new Device();
    const s2 = await signIn(platform(b), { login: ' PABLO ', password: 'mot-de-passe-long' });
    expect(s2.dek).toBe(session.dek);
  }, 30_000);

  it('refuse mauvais mot de passe, mauvaise invitation, identifiant pris', async () => {
    const a = new Device();
    await expect(createAccount(platform(a), { login: 'leo', password: 'mot-de-passe-long', invite: 'faux' })).rejects.toMatchObject({ status: 403 });
    await createAccount(platform(a), { login: 'leo', password: 'mot-de-passe-long', invite: 'copains-2026' });
    await expect(createAccount(platform(a), { login: 'leo', password: 'autre-mot-de-passe', invite: 'copains-2026' })).rejects.toMatchObject({ status: 409 });
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
    const { session, recoveryKey } = await createAccount(platform(a), { login: 'ines', password: 'premier-mot-de-passe', invite: 'copains-2026' });
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
    await expect(recoverAccount(platform(new Device()), { login: 'ines', recoveryKey: 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA', newPassword: 'x'.repeat(10) })).rejects.toMatchObject({ status: 401 });
  }, 60_000);
});

describe('synchronisation entre appareils', () => {
  it('PC ↔ téléphone : envoi, récupération, modifications, suppressions, conflit, sans écho', async () => {
    const srv = await server();
    const phone = new Device();
    const pc = new Device();
    const { session } = await createAccount({ api: srv.api, sessions: phone.sessions, random }, { login: 'pablo', password: 'mot-de-passe-long', invite: 'copains-2026' });
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
    const { session } = await createAccount({ api: srv.api, sessions: d.sessions, random }, { login: 'zoe', password: 'mot-de-passe-long', invite: 'copains-2026' });
    d.write('transactions', 't1', { label: 'Pharmacie Lafayette', amount: -1234 });
    await join(d, srv.api, session, random);
    const { rows } = await srv.db.query<{ payload: string }>('SELECT payload FROM records');
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).not.toMatch(/Pharmacie|1234/);
    const users = await srv.db.query('SELECT * FROM users');
    expect(JSON.stringify(users.rows)).not.toMatch(/mot-de-passe/);
  }, 30_000);

  it('« garder les données de cet appareil » remplace celles du compte', async () => {
    const srv = await server();
    const a = new Device();
    const b = new Device();
    const { session } = await createAccount({ api: srv.api, sessions: a.sessions, random }, { login: 'max', password: 'mot-de-passe-long', invite: 'copains-2026' });
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
