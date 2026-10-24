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
  /** Code d'invitation, exigé seulement quand `signup` vaut 'invite'. */
  invite: string;
  /**
   * 'open' (défaut) : tout le monde crée son compte en un écran, comme dans une app ordinaire ; les
   * abus sont bornés (comptes par réseau et par jour, essais de mot de passe, quotas de stockage).
   * 'invite' : le code d'invitation est exigé.
   */
  signup: 'open' | 'invite';
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * `mylife` : réglages communs à toutes les apps (apparence, compteurs du Personnage) ; `miniapps` : « Mes apps »,
 * une ligne par app et une par saisie.
 */
export const APPS = ['finances', 'perf', 'mylife', 'miniapps'] as const;
export type App = (typeof APPS)[number];
export const KDF_ITERATIONS = 200_000;
const SESSION_DAYS = 365;
const MAX_CHANGES = 500;
const MAX_PAYLOAD = 200_000;
const PULL_LIMIT = 1000;
/** Lignes gardées au plus par compte et par app (garde-fou de stockage, très au-delà d'un usage réel). */
export const ROW_QUOTA: Record<App, number> = { finances: 100_000, perf: 100_000, mylife: 200, miniapps: 40_000 };

/** Garde-fous contre les abus (fenêtres simples, par clé). */
export const RATES = {
  /** Comptes créés depuis un même réseau (adresse IP, gardée seulement sous forme d'empreinte). */
  signup: { max: 10, windowMs: 86_400_000 },
  /** Vérifications de disponibilité d'un identifiant. */
  available: { max: 120, windowMs: 3_600_000 },
  /** Mauvais mots de passe (ou clés de secours) pour un même identifiant. */
  badPassword: { max: 10, windowMs: 15 * 60_000 },
} as const;

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
  await db.query(`CREATE TABLE IF NOT EXISTS auth_rate (k TEXT PRIMARY KEY, win BIGINT NOT NULL, n INTEGER NOT NULL, at BIGINT NOT NULL)`);
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

// ---------------------------------------------------------------- abus

type Rule = { max: number; windowMs: number };

/** Compte un essai dans la fenêtre courante et renvoie le total. */
async function hit(db: Db, key: string, rule: Rule, now: number): Promise<number> {
  const win = Math.floor(now / rule.windowMs);
  const { rows } = await db.query<{ n: number }>(
    `INSERT INTO auth_rate (k, win, n, at) VALUES ($1, $2, 1, $3)
     ON CONFLICT (k) DO UPDATE SET n = CASE WHEN auth_rate.win = EXCLUDED.win THEN auth_rate.n + 1 ELSE 1 END, win = EXCLUDED.win, at = EXCLUDED.at
     RETURNING n`,
    [key, win, now],
  );
  // Ménage occasionnel des fenêtres périmées.
  if (Math.random() < 0.02) await db.query('DELETE FROM auth_rate WHERE at <= $1', [now - 2 * 86_400_000]);
  return Number(rows[0]?.n ?? 0);
}

/** Essais déjà comptés dans la fenêtre courante, sans en ajouter. */
async function count(db: Db, key: string, rule: Rule, now: number): Promise<number> {
  const { rows } = await db.query<{ n: number }>('SELECT n FROM auth_rate WHERE k = $1 AND win = $2', [key, Math.floor(now / rule.windowMs)]);
  return Number(rows[0]?.n ?? 0);
}

/** Empreinte de l'adresse du client : on ne garde jamais l'adresse elle-même. */
const ipKey = (env: Env, ip: string) => hmac(env.secret, `ip:${ip || 'inconnue'}`).subarray(0, 12).toString('hex');

/** Qui appelle : adresse (pour les garde-fous) et horloge (fixée dans les tests). */
export interface Client {
  ip: string;
  now?: number;
}

/** Trop de mauvais essais récents pour cet identifiant : on refuse sans même vérifier. */
async function guardAttempts(db: Db, kind: 'password' | 'recovery', login: string, now: number): Promise<void> {
  if ((await count(db, `bad-${kind}:${login}`, RATES.badPassword, now)) >= RATES.badPassword.max) {
    throw new HttpError(429, 'Trop d’essais pour cet identifiant : réessaie dans un quart d’heure.');
  }
}

async function failedAttempt(db: Db, kind: 'password' | 'recovery', login: string, now: number): Promise<void> {
  await hit(db, `bad-${kind}:${login}`, RATES.badPassword, now);
  await slow();
}

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

/** L'identifiant est-il libre ? (écran de création : réponse pendant la saisie). */
export async function available(db: Db, env: Env, body: Record<string, unknown>, client: Client = { ip: '' }): Promise<{ available: boolean }> {
  const now = client.now ?? Date.now();
  if ((await hit(db, `available:${ipKey(env, client.ip)}`, RATES.available, now)) > RATES.available.max) throw new HttpError(429, 'Trop de vérifications : réessaie dans un moment.');
  const login = loginOf(body);
  const { rows } = await db.query('SELECT 1 FROM users WHERE login = $1', [login]);
  return { available: !rows[0] };
}

export async function signup(db: Db, env: Env, body: Record<string, unknown>, client: Client = { ip: '' }): Promise<{ token: string; login: string }> {
  const now = client.now ?? Date.now();
  const login = loginOf(body);
  if (env.signup === 'invite') {
    const invite = typeof body.invite === 'string' ? body.invite.trim() : '';
    if (!env.invite || !same(invite, env.invite)) {
      await slow();
      throw new HttpError(403, 'Code d’invitation incorrect.');
    }
  }
  if ((await hit(db, `signup:${ipKey(env, client.ip)}`, RATES.signup, now)) > RATES.signup.max) throw new HttpError(429, 'Trop de comptes créés depuis ce réseau aujourd’hui : réessaie demain.');
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

export async function login(db: Db, env: Env, body: Record<string, unknown>, client: Client = { ip: '' }): Promise<{ token: string; login: string; wrappedKey: string }> {
  const now = client.now ?? Date.now();
  const name = loginOf(body);
  const authKey = str(body, 'authKey', HEX64);
  await guardAttempts(db, 'password', name, now);
  const { rows } = await db.query<UserRow>('SELECT id, auth_hash, wrapped_key FROM users WHERE login = $1', [name]);
  const user = rows[0];
  if (!user || !same(fingerprint(env, authKey), user.auth_hash)) {
    await failedAttempt(db, 'password', name, now);
    throw new HttpError(401, 'Identifiant ou mot de passe incorrect.');
  }
  return { token: signToken(user.id, env.secret, now), login: name, wrappedKey: user.wrapped_key };
}

/** Mot de passe oublié, étape 1 : la clé de secours prouve l'identité et rend la clé de données emballée. */
export async function recoverStart(db: Db, env: Env, body: Record<string, unknown>, client: Client = { ip: '' }): Promise<{ recWrappedKey: string }> {
  const user = await byRecovery(db, env, body, client.now);
  return { recWrappedKey: user.rec_wrapped_key };
}

/** Étape 2 : nouveau mot de passe (nouvelle clé d'authentification, clé de données ré-emballée). */
export async function recoverFinish(db: Db, env: Env, body: Record<string, unknown>, client: Client = { ip: '' }): Promise<{ token: string; login: string }> {
  const user = await byRecovery(db, env, body, client.now);
  await setPassword(db, env, user.id, body);
  return { token: signToken(user.id, env.secret), login: loginOf(body) };
}

export async function changePassword(db: Db, env: Env, uid: string, body: Record<string, unknown>): Promise<{ ok: true }> {
  await setPassword(db, env, uid, body);
  return { ok: true };
}

async function byRecovery(db: Db, env: Env, body: Record<string, unknown>, now = Date.now()): Promise<UserRow> {
  const name = loginOf(body);
  const recAuth = str(body, 'recAuth', HEX64);
  await guardAttempts(db, 'recovery', name, now);
  const { rows } = await db.query<UserRow>('SELECT id, rec_hash, rec_wrapped_key FROM users WHERE login = $1', [name]);
  const user = rows[0];
  if (!user || !same(fingerprint(env, recAuth), user.rec_hash)) {
    await failedAttempt(db, 'recovery', name, now);
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

/** Nouvelle clé de secours (l'ancienne cesse de fonctionner) : la session suffit, comme pour le mot de passe. */
export async function renewRecovery(db: Db, env: Env, uid: string, body: Record<string, unknown>): Promise<{ ok: true }> {
  const recAuth = str(body, 'recAuth', HEX64);
  const recWrappedKey = str(body, 'recWrappedKey', B64);
  await db.query('UPDATE users SET rec_hash = $2, rec_wrapped_key = $3 WHERE id = $1', [uid, fingerprint(env, recAuth), recWrappedKey]);
  return { ok: true };
}

/**
 * Suppression du compte : le mot de passe est redemandé (preuve fraîche), puis le compte et toutes ses
 * données synchronisées sont effacés du serveur. Les données restent sur les appareils.
 */
export async function deleteAccount(db: Db, env: Env, uid: string, body: Record<string, unknown>, client: Client = { ip: '' }): Promise<{ ok: true }> {
  const now = client.now ?? Date.now();
  const authKey = str(body, 'authKey', HEX64);
  const { rows } = await db.query<UserRow & { login: string }>('SELECT id, login, auth_hash FROM users WHERE id = $1', [uid]);
  const user = rows[0];
  if (!user) throw new HttpError(404, 'Compte introuvable.');
  await guardAttempts(db, 'password', user.login, now);
  if (!same(fingerprint(env, authKey), user.auth_hash)) {
    await failedAttempt(db, 'password', user.login, now);
    throw new HttpError(401, 'Mot de passe incorrect.');
  }
  await db.query('DELETE FROM users WHERE id = $1', [uid]);
  return { ok: true };
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

/**
 * Lit les modifications envoyées. Une ligne mal formée refuse tout l'envoi (appareil défaillant) ; une ligne
 * seulement trop grosse est écartée seule et signalée (`tooBig`) : elle ne bloque plus les autres.
 */
function parseChanges(raw: unknown): { changes: Change[]; tooBig: { tbl: string; rid: string }[] } {
  if (raw === undefined) return { changes: [], tooBig: [] };
  if (!Array.isArray(raw) || raw.length > MAX_CHANGES) throw new HttpError(400, `Paramètre invalide : changes (au plus ${MAX_CHANGES})`);
  const changes: Change[] = [];
  const tooBig: { tbl: string; rid: string }[] = [];
  for (const c of raw) {
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
      (x.deleted ? x.payload == null : typeof x.payload === 'string');
    if (!ok) throw new HttpError(400, 'Paramètre invalide : modification');
    if (!x.deleted && (x.payload as string).length > MAX_PAYLOAD) {
      tooBig.push({ tbl: x.tbl as string, rid: x.rid as string });
      continue;
    }
    changes.push({ tbl: x.tbl as string, rid: x.rid as string, updatedAt: Math.round(x.updatedAt as number), deleted: x.deleted as boolean, payload: (x.payload as string | null) ?? null });
  }
  return { changes, tooBig };
}

/**
 * Quota : seules comptent les lignes vivantes (pas les traces de suppression), et seules les lignes vraiment
 * nouvelles s'y ajoutent (modifier une ligne existante passe toujours).
 */
async function checkQuota(db: Db, uid: string, app: App, changes: Change[]): Promise<void> {
  const written = changes.filter((c) => !c.deleted);
  if (!written.length) return;
  const { rows: n } = await db.query<{ n: string | number }>('SELECT COUNT(*) AS n FROM records WHERE user_id = $1 AND app = $2 AND deleted = false', [uid, app]);
  const live = Number(n[0]?.n ?? 0);
  if (live + written.length <= ROW_QUOTA[app]) return;
  const params: unknown[] = [uid, app];
  const pairs = written.map((c) => {
    params.push(c.tbl, c.rid);
    return `($${params.length - 1},$${params.length})`;
  });
  const { rows: e } = await db.query<{ n: string | number }>(
    `SELECT COUNT(*) AS n FROM records WHERE user_id = $1 AND app = $2 AND deleted = false AND (tbl, rid) IN (${pairs.join(',')})`,
    params,
  );
  if (live + written.length - Number(e[0]?.n ?? 0) > ROW_QUOTA[app]) throw new HttpError(413, 'Espace du compte plein pour cette app : supprime des données anciennes ou écris-nous.');
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
): Promise<{ changes: (Change & { seq: number })[]; cursor: number; more: boolean; accepted: number; tooBig: { tbl: string; rid: string }[] }> {
  const app = appOf(body);
  const device = typeof body.device === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(body.device) ? body.device : null;
  if (!device) throw new HttpError(400, 'Paramètre invalide : device');
  const cursor = typeof body.cursor === 'number' && body.cursor >= 0 ? Math.floor(body.cursor) : 0;
  const { changes, tooBig } = parseChanges(body.changes);

  if (body.reset === true) await db.query('DELETE FROM records WHERE user_id = $1 AND app = $2', [uid, app]);
  await checkQuota(db, uid, app, changes);

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
    tooBig,
  };
}
