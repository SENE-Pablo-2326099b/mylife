import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Comptes et synchronisation MyLife, côté serveur.
 *
 * Le serveur ne voit jamais ni le mot de passe ni les données : l'appareil dérive du mot de passe
 * une clé d'authentification (envoyée) et une clé de chiffrement (gardée), et chiffre chaque ligne
 * avant de l'envoyer (packages/sync-client). Le serveur range des blocs illisibles, les rend dans
 * l'ordre, et arbitre les conflits par date de modification (la plus récente gagne).
 */

/** Ce dont la logique a besoin d'une base : pg.Pool en production, PGlite dans les tests. */
export interface Db {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

export interface Env {
  /** Secret du serveur : signe les sessions et « poivre » les empreintes. */
  secret: string;
  /** Code à fournir pour créer un compte (toi et tes copains). */
  invite: string;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const APPS = ['finances', 'perf'] as const;
export type App = (typeof APPS)[number];
export const KDF_ITERATIONS = 200_000;
const SESSION_DAYS = 365;
const MAX_CHANGES = 500;
const MAX_PAYLOAD = 200_000;
const PULL_LIMIT = 1000;

// ---------------------------------------------------------------- schéma

export async function ensureSchema(db: Db): Promise<void> {
  await db.query(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    login TEXT UNIQUE NOT NULL,
    kdf_salt TEXT NOT NULL,
    kdf_iter INTEGER NOT NULL,
    auth_hash TEXT NOT NULL,
    rec_hash TEXT NOT NULL,
    wrapped_key TEXT NOT NULL,
    rec_wrapped_key TEXT NOT NULL,
    created_at BIGINT NOT NULL
  )`);
  await db.query(`CREATE SEQUENCE IF NOT EXISTS records_seq`);
  await db.query(`CREATE TABLE IF NOT EXISTS records (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    app TEXT NOT NULL,
    tbl TEXT NOT NULL,
    rid TEXT NOT NULL,
    seq BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    deleted BOOLEAN NOT NULL,
    device TEXT NOT NULL,
    payload TEXT,
    PRIMARY KEY (user_id, app, tbl, rid)
  )`);
  await db.query(`CREATE INDEX IF NOT EXISTS records_by_seq ON records (user_id, app, seq)`);
}

// ---------------------------------------------------------------- sessions

const b64u = (s: string | Buffer) => Buffer.from(s).toString('base64url');
const hmac = (secret: string, data: string) => createHmac('sha256', secret).update(data).digest();

export function signToken(uid: string, secret: string, now = Date.now()): string {
  const payload = b64u(JSON.stringify({ uid, exp: now + SESSION_DAYS * 86_400_000 }));
  return `${payload}.${b64u(hmac(secret, payload))}`;
}

export function verifyToken(token: string | undefined | null, secret: string, now = Date.now()): string | null {
  if (!token) return null;
  const [payload, sig] = token.replace(/^Bearer\s+/i, '').split('.');
  if (!payload || !sig) return null;
  const expected = hmac(secret, payload);
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const { uid, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { uid?: unknown; exp?: unknown };
    return typeof uid === 'string' && typeof exp === 'number' && exp > now ? uid : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- validation

const LOGIN = /^[a-z0-9][a-z0-9._@-]{2,63}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const HEX32 = /^[0-9a-f]{32}$/;
const B64 = /^[A-Za-z0-9+/_=-]{20,600}$/;

function str(body: Record<string, unknown>, key: string, re: RegExp, label = key): string {
  const v = typeof body[key] === 'string' ? (body[key] as string).trim() : '';
  if (!re.test(v)) throw new HttpError(400, `Paramètre invalide : ${label}`);
  return v;
}
const loginOf = (body: Record<string, unknown>) => str({ login: typeof body.login === 'string' ? body.login.trim().toLowerCase() : '' }, 'login', LOGIN, 'identifiant (3 à 64 caractères : lettres, chiffres, . _ - @)');

const fingerprint = (env: Env, key: string) => hmac(env.secret, `auth:${key}`).toString('hex');
function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
const slow = () => new Promise((r) => setTimeout(r, 400));

interface UserRow {
  id: string;
  kdf_salt: string;
  kdf_iter: number;
  auth_hash: string;
  rec_hash: string;
  wrapped_key: string;
  rec_wrapped_key: string;
}

// ---------------------------------------------------------------- comptes

/**
 * Sel de dérivation d'un identifiant. Pour un identifiant inconnu, un sel stable et plausible :
 * on ne révèle pas quels comptes existent.
 */
export async function getSalt(db: Db, env: Env, body: Record<string, unknown>): Promise<{ salt: string; iterations: number }> {
  const login = loginOf(body);
  const { rows } = await db.query<UserRow>('SELECT kdf_salt, kdf_iter FROM users WHERE login = $1', [login]);
  if (rows[0]) return { salt: rows[0].kdf_salt, iterations: rows[0].kdf_iter };
  return { salt: hmac(env.secret, `salt:${login}`).subarray(0, 16).toString('hex'), iterations: KDF_ITERATIONS };
}

export async function signup(db: Db, env: Env, body: Record<string, unknown>, now = Date.now()): Promise<{ token: string; login: string }> {
  const login = loginOf(body);
  const invite = typeof body.invite === 'string' ? body.invite.trim() : '';
  if (!env.invite || !same(invite, env.invite)) {
    await slow();
    throw new HttpError(403, 'Code d’invitation incorrect.');
  }
  const salt = str(body, 'salt', HEX32);
  const authKey = str(body, 'authKey', HEX64);
  const recAuth = str(body, 'recAuth', HEX64);
  const wrappedKey = str(body, 'wrappedKey', B64);
  const recWrappedKey = str(body, 'recWrappedKey', B64);
  const iterations = typeof body.iterations === 'number' && body.iterations >= 100_000 && body.iterations <= 2_000_000 ? Math.round(body.iterations) : KDF_ITERATIONS;
  const id = `u_${hmac(env.secret, `${login}:${now}:${Math.random()}`).subarray(0, 12).toString('hex')}`;
  try {
    await db.query(
      `INSERT INTO users (id, login, kdf_salt, kdf_iter, auth_hash, rec_hash, wrapped_key, rec_wrapped_key, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, login, salt, iterations, fingerprint(env, authKey), fingerprint(env, recAuth), wrappedKey, recWrappedKey, now],
    );
  } catch (e) {
    if (/unique|duplicate/i.test(String((e as Error).message))) throw new HttpError(409, 'Cet identifiant est déjà pris.');
    throw e;
  }
  return { token: signToken(id, env.secret, now), login };
}

export async function login(db: Db, env: Env, body: Record<string, unknown>): Promise<{ token: string; login: string; wrappedKey: string }> {
  const name = loginOf(body);
  const authKey = str(body, 'authKey', HEX64);
  const { rows } = await db.query<UserRow>('SELECT id, auth_hash, wrapped_key FROM users WHERE login = $1', [name]);
  const user = rows[0];
  if (!user || !same(fingerprint(env, authKey), user.auth_hash)) {
    await slow();
    throw new HttpError(401, 'Identifiant ou mot de passe incorrect.');
  }
  return { token: signToken(user.id, env.secret), login: name, wrappedKey: user.wrapped_key };
}

/** Mot de passe oublié, étape 1 : la clé de secours prouve l'identité et rend la clé de données emballée. */
export async function recoverStart(db: Db, env: Env, body: Record<string, unknown>): Promise<{ recWrappedKey: string }> {
  const user = await byRecovery(db, env, body);
  return { recWrappedKey: user.rec_wrapped_key };
}

/** Étape 2 : nouveau mot de passe (nouvelle clé d'authentification, clé de données ré-emballée). */
export async function recoverFinish(db: Db, env: Env, body: Record<string, unknown>): Promise<{ token: string; login: string }> {
  const user = await byRecovery(db, env, body);
  await setPassword(db, env, user.id, body);
  return { token: signToken(user.id, env.secret), login: loginOf(body) };
}

export async function changePassword(db: Db, env: Env, uid: string, body: Record<string, unknown>): Promise<{ ok: true }> {
  await setPassword(db, env, uid, body);
  return { ok: true };
}

async function byRecovery(db: Db, env: Env, body: Record<string, unknown>): Promise<UserRow> {
  const name = loginOf(body);
  const recAuth = str(body, 'recAuth', HEX64);
  const { rows } = await db.query<UserRow>('SELECT id, rec_hash, rec_wrapped_key FROM users WHERE login = $1', [name]);
  const user = rows[0];
  if (!user || !same(fingerprint(env, recAuth), user.rec_hash)) {
    await slow();
    throw new HttpError(401, 'Identifiant ou clé de secours incorrect.');
  }
  return user;
}

async function setPassword(db: Db, env: Env, uid: string, body: Record<string, unknown>): Promise<void> {
  const salt = str(body, 'newSalt', HEX32);
  const authKey = str(body, 'newAuthKey', HEX64);
  const wrappedKey = str(body, 'newWrappedKey', B64);
  await db.query('UPDATE users SET kdf_salt = $2, kdf_iter = $3, auth_hash = $4, wrapped_key = $5 WHERE id = $1', [uid, salt, KDF_ITERATIONS, fingerprint(env, authKey), wrappedKey]);
}

// ---------------------------------------------------------------- synchronisation

export interface Change {
  tbl: string;
  rid: string;
  updatedAt: number;
  deleted: boolean;
  /** Ligne chiffrée (base64), absente pour une suppression. */
  payload: string | null;
}

interface RecordRow {
  tbl: string;
  rid: string;
  seq: string | number;
  updated_at: string | number;
  deleted: boolean;
  payload: string | null;
}

const TBL = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;

function appOf(body: Record<string, unknown>): App {
  const app = body.app;
  if (!APPS.includes(app as App)) throw new HttpError(400, 'Paramètre invalide : app');
  return app as App;
}

function parseChanges(raw: unknown): Change[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_CHANGES) throw new HttpError(400, `Paramètre invalide : changes (au plus ${MAX_CHANGES})`);
  return raw.map((c) => {
    const x = (c ?? {}) as Record<string, unknown>;
    const ok =
      typeof x.tbl === 'string' &&
      TBL.test(x.tbl) &&
      typeof x.rid === 'string' &&
      x.rid.length > 0 &&
      x.rid.length <= 300 &&
      typeof x.updatedAt === 'number' &&
      Number.isFinite(x.updatedAt) &&
      typeof x.deleted === 'boolean' &&
      (x.deleted ? x.payload == null : typeof x.payload === 'string' && x.payload.length <= MAX_PAYLOAD);
    if (!ok) throw new HttpError(400, 'Paramètre invalide : modification');
    return { tbl: x.tbl as string, rid: x.rid as string, updatedAt: Math.round(x.updatedAt as number), deleted: x.deleted as boolean, payload: (x.payload as string | null) ?? null };
  });
}

/** Ce que contient le compte pour une app (avant de rejoindre : récupérer ou envoyer ?). */
export async function syncStatus(db: Db, uid: string, body: Record<string, unknown>): Promise<{ count: number; lastUpdated: number | null }> {
  const app = appOf(body);
  const { rows } = await db.query<{ n: string | number; last: string | number | null }>(
    'SELECT COUNT(*) AS n, MAX(updated_at) AS last FROM records WHERE user_id = $1 AND app = $2 AND deleted = false',
    [uid, app],
  );
  return { count: Number(rows[0]?.n ?? 0), lastUpdated: rows[0]?.last == null ? null : Number(rows[0].last) };
}

/**
 * Un aller-retour : envoie les modifications de l'appareil (la plus récente gagne), puis renvoie
 * celles des autres appareils depuis `cursor`. `reset` vide d'abord le compte pour cette app (l'appareil
 * remplace les données du compte par les siennes).
 */
export async function sync(
  db: Db,
  uid: string,
  body: Record<string, unknown>,
): Promise<{ changes: (Change & { seq: number })[]; cursor: number; more: boolean; accepted: number }> {
  const app = appOf(body);
  const device = typeof body.device === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(body.device) ? body.device : null;
  if (!device) throw new HttpError(400, 'Paramètre invalide : device');
  const cursor = typeof body.cursor === 'number' && body.cursor >= 0 ? Math.floor(body.cursor) : 0;
  const changes = parseChanges(body.changes);

  if (body.reset === true) await db.query('DELETE FROM records WHERE user_id = $1 AND app = $2', [uid, app]);

  let accepted = 0;
  let overruled: RecordRow[] = [];
  if (changes.length) {
    const values: unknown[] = [];
    const tuples = changes.map((c, i) => {
      values.push(uid, app, c.tbl, c.rid, c.updatedAt, c.deleted, device, c.deleted ? null : c.payload);
      const b = i * 8;
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},nextval('records_seq'),$${b + 5},$${b + 6},$${b + 7},$${b + 8})`;
    });
    // Une même ligne envoyée deux fois dans un lot : on garde la dernière.
    const res = await db.query(
      `INSERT INTO records (user_id, app, tbl, rid, seq, updated_at, deleted, device, payload) VALUES ${tuples.join(',')}
       ON CONFLICT (user_id, app, tbl, rid) DO UPDATE SET seq = nextval('records_seq'), updated_at = EXCLUDED.updated_at,
         deleted = EXCLUDED.deleted, device = EXCLUDED.device, payload = EXCLUDED.payload
       WHERE records.updated_at <= EXCLUDED.updated_at
       RETURNING tbl, rid`,
      values,
    );
    accepted = res.rows.length;
    // Refusées : le compte a plus récent. On renvoie sa version pour que l'appareil s'aligne.
    const ok = new Set((res.rows as { tbl: string; rid: string }[]).map((r) => `${r.tbl}|${r.rid}`));
    const refused = changes.filter((c) => !ok.has(`${c.tbl}|${c.rid}`));
    if (refused.length) {
      const params: unknown[] = [uid, app];
      const pairs = refused.map((c, i) => {
        params.push(c.tbl, c.rid);
        return `($${i * 2 + 3},$${i * 2 + 4})`;
      });
      overruled = (await db.query<RecordRow>(`SELECT tbl, rid, seq, updated_at, deleted, payload FROM records WHERE user_id = $1 AND app = $2 AND (tbl, rid) IN (${pairs.join(',')})`, params)).rows;
    }
  }

  // Les lignes écrites en dernier par cet appareil sont déjà chez lui : pas d'écho.
  const { rows } = await db.query<RecordRow>(
    'SELECT tbl, rid, seq, updated_at, deleted, payload FROM records WHERE user_id = $1 AND app = $2 AND seq > $3 AND device <> $4 ORDER BY seq LIMIT $5',
    [uid, app, cursor, device, PULL_LIMIT + 1],
  );
  const more = rows.length > PULL_LIMIT;
  const page = rows.slice(0, PULL_LIMIT);
  const seen = new Set(page.map((r) => `${r.tbl}|${r.rid}`));
  const extra = overruled.filter((r) => !seen.has(`${r.tbl}|${r.rid}`));
  // Curseur : dernière ligne renvoyée, ou à défaut la plus récente du compte (les nôtres comprises).
  let next = cursor;
  const lastRow = page[page.length - 1];
  if (lastRow) next = Number(lastRow.seq);
  else {
    const last = await db.query<{ s: string | number | null }>('SELECT MAX(seq) AS s FROM records WHERE user_id = $1 AND app = $2', [uid, app]);
    next = Math.max(cursor, Number(last.rows[0]?.s ?? 0));
  }
  return {
    changes: [...extra, ...page].map((r) => ({ tbl: r.tbl, rid: r.rid, seq: Number(r.seq), updatedAt: Number(r.updated_at), deleted: r.deleted, payload: r.payload })),
    cursor: next,
    more,
    accepted,
  };
}
