import { createHash, randomBytes } from 'node:crypto';
import { HttpError, verifyToken, type Db } from './core.js';

/**
 * Espaces partagés (POST /api/space) : la brique commune des fonctions « à plusieurs » de MyLife
 * (Crew du Personnage, puis Sortie, Pacte…). Un espace = des membres et des lignes chiffrées que chacun
 * lit et que chacun écrit selon une règle simple.
 *
 * Le serveur ne lit rien : nom de l'espace, pseudos et contenus sont chiffrés avec la clé de l'espace
 * (AES-256-GCM), transmise entre amis dans le fragment `#` du lien d'invitation (jamais envoyé au
 * serveur), et rangée par chaque membre emballée par SA clé de données MyLife. Le serveur décide QUI lit
 * et écrit QUOI : chaque requête est authentifiée et chaque accès vérifie l'appartenance.
 *
 * Règle d'écriture : une ligne appartient à son auteur (personne d'autre ne peut la modifier), sauf si
 * elle a été créée « ouverte » (liste commune : tout membre peut la modifier). Un administrateur peut
 * supprimer n'importe quelle ligne. Quitter l'espace efface les lignes dont on est l'auteur.
 */

export const SPACE_LIMITS = {
  maxSpacesPerUser: 30,
  maxMembers: 50,
  maxRowsPerSpace: 5000,
  maxInviteMs: 30 * 86_400_000,
  maxActiveInvites: 20,
  pageSize: 500,
};

const RATE = {
  read: { max: 120, windowMs: 60_000 },
  write: { max: 120, windowMs: 10 * 60_000 },
  create: { max: 20, windowMs: 86_400_000 },
  badInvite: { max: 10, windowMs: 15 * 60_000 },
};

export const SPACE_KINDS = ['crew', 'sortie', 'pacte', 'liste'] as const;
type Kind = (typeof SPACE_KINDS)[number];

// ---------------------------------------------------------------- schéma

export async function ensureSpaceSchema(db: Db): Promise<void> {
  await db.query(`CREATE TABLE IF NOT EXISTS spaces (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at BIGINT NOT NULL
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS space_members (
    space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    profile TEXT NOT NULL,
    wrapped_key TEXT NOT NULL,
    joined_at BIGINT NOT NULL,
    last_seen BIGINT NOT NULL,
    PRIMARY KEY (space_id, user_id)
  )`);
  await db.query(`CREATE INDEX IF NOT EXISTS space_members_by_user ON space_members (user_id)`);
  await db.query(`CREATE SEQUENCE IF NOT EXISTS space_seq`);
  await db.query(`CREATE TABLE IF NOT EXISTS space_records (
    space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    tbl TEXT NOT NULL,
    rid TEXT NOT NULL,
    author TEXT NOT NULL,
    open BOOLEAN NOT NULL DEFAULT false,
    seq BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    deleted BOOLEAN NOT NULL DEFAULT false,
    payload TEXT,
    PRIMARY KEY (space_id, tbl, rid)
  )`);
  await db.query(`CREATE INDEX IF NOT EXISTS space_records_by_seq ON space_records (space_id, seq)`);
  await db.query(`CREATE TABLE IF NOT EXISTS space_invites (
    token_hash TEXT PRIMARY KEY,
    id TEXT UNIQUE NOT NULL,
    space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    created_by TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL,
    max_uses INTEGER,
    uses INTEGER NOT NULL DEFAULT 0,
    revoked BOOLEAN NOT NULL DEFAULT false
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS space_rate (k TEXT PRIMARY KEY, win BIGINT NOT NULL, n INTEGER NOT NULL, at BIGINT NOT NULL)`);
}

// ---------------------------------------------------------------- validation

const SID = /^[0-9a-f]{32}$/;
const UID = /^[A-Za-z0-9_-]{1,64}$/;
const TOKEN = /^[A-Za-z0-9_-]{22}$/;
const INVITE_ID = /^[0-9a-f]{12}$/;
const TBL = /^[a-z][a-z0-9_]{0,31}$/;
const RID = /^[A-Za-z0-9_.:-]{1,80}$/;
const sealed = (max: number) => new RegExp(`^[A-Za-z0-9+/=]{32,${max}}$`);
const NAME = sealed(400);
const PROFILE = sealed(400);
const WRAPPED = sealed(160);
const PAYLOAD = sealed(8000);
const BAD_INVITE = 'Ce lien d’invitation n’est plus valable. Demande-en un nouveau.';

type Body = Record<string, unknown>;

function str(body: Body, key: string, re: RegExp): string {
  const v = body[key];
  if (typeof v !== 'string' || !re.test(v)) throw new HttpError(400, `Paramètre invalide : ${key}`);
  return v;
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

async function rate(db: Db, key: string, rule: { max: number; windowMs: number }, now: number): Promise<number> {
  const win = Math.floor(now / rule.windowMs);
  const { rows } = await db.query<{ n: number }>(
    `INSERT INTO space_rate (k, win, n, at) VALUES ($1, $2, 1, $3)
     ON CONFLICT (k) DO UPDATE SET n = CASE WHEN space_rate.win = EXCLUDED.win THEN space_rate.n + 1 ELSE 1 END, win = EXCLUDED.win, at = EXCLUDED.at
     RETURNING n`,
    [key, win, now],
  );
  return Number(rows[0]?.n ?? 0);
}

async function limit(db: Db, uid: string, kind: keyof typeof RATE, now: number): Promise<void> {
  if ((await rate(db, `${kind}:${uid}`, RATE[kind], now)) > RATE[kind].max) throw new HttpError(429, 'Trop de requêtes : réessaie dans un moment.');
}

interface MemberRow {
  space_id: string;
  user_id: string;
  role: string;
  profile: string;
  wrapped_key: string;
  joined_at: string | number;
  last_seen: string | number;
}

async function membership(db: Db, uid: string, body: Body, now: number): Promise<MemberRow> {
  const sid = str(body, 'sid', SID);
  const { rows } = await db.query<MemberRow>('SELECT * FROM space_members WHERE space_id = $1 AND user_id = $2', [sid, uid]);
  if (!rows[0]) throw new HttpError(404, 'Espace introuvable (ou tu n’en fais plus partie).');
  await db.query('UPDATE space_members SET last_seen = $3 WHERE space_id = $1 AND user_id = $2', [sid, uid, now]);
  return rows[0];
}

async function asAdmin(db: Db, uid: string, body: Body, now: number): Promise<MemberRow> {
  const me = await membership(db, uid, body, now);
  if (me.role !== 'admin') throw new HttpError(403, 'Réservé aux administrateurs de l’espace.');
  return me;
}

// ---------------------------------------------------------------- espaces

export interface SpaceSummary {
  id: string;
  kind: string;
  /** Nom chiffré. */
  name: string;
  role: string;
  wrappedKey: string;
  members: number;
  createdAt: number;
}

export async function mySpaces(db: Db, uid: string): Promise<{ uid: string; spaces: SpaceSummary[] }> {
  const { rows } = await db.query<{ id: string; kind: string; name: string; role: string; wrapped_key: string; members: string | number; created_at: string | number }>(
    `SELECT s.id, s.kind, s.name, s.created_at, m.role, m.wrapped_key,
            (SELECT COUNT(*) FROM space_members x WHERE x.space_id = s.id) AS members
     FROM space_members m JOIN spaces s ON s.id = m.space_id WHERE m.user_id = $1 ORDER BY s.created_at`,
    [uid],
  );
  return { uid, spaces: rows.map((r) => ({ id: r.id, kind: r.kind, name: r.name, role: r.role, wrappedKey: r.wrapped_key, members: Number(r.members), createdAt: Number(r.created_at) })) };
}

export async function createSpace(db: Db, uid: string, body: Body, now = Date.now()): Promise<{ id: string }> {
  await limit(db, uid, 'create', now);
  const id = str(body, 'id', SID);
  const kind = body.kind;
  if (typeof kind !== 'string' || !(SPACE_KINDS as readonly string[]).includes(kind)) throw new HttpError(400, 'Paramètre invalide : kind');
  const name = str(body, 'name', NAME);
  const profile = str(body, 'profile', PROFILE);
  const wrappedKey = str(body, 'wrappedKey', WRAPPED);
  const { rows } = await db.query<{ n: string | number }>('SELECT COUNT(*) AS n FROM space_members WHERE user_id = $1', [uid]);
  if (Number(rows[0]?.n ?? 0) >= SPACE_LIMITS.maxSpacesPerUser) throw new HttpError(409, `Tu fais déjà partie de ${SPACE_LIMITS.maxSpacesPerUser} espaces : quittes-en un d’abord.`);
  const exists = await db.query('SELECT 1 FROM spaces WHERE id = $1', [id]);
  if (exists.rows.length) throw new HttpError(409, 'Identifiant déjà pris.');
  await db.query('INSERT INTO spaces (id, kind, name, created_by, created_at) VALUES ($1,$2,$3,$4,$5)', [id, kind as Kind, name, uid, now]);
  await db.query(`INSERT INTO space_members (space_id, user_id, role, profile, wrapped_key, joined_at, last_seen) VALUES ($1,$2,'admin',$3,$4,$5,$5)`, [id, uid, profile, wrappedKey, now]);
  return { id };
}

export async function renameSpace(db: Db, uid: string, body: Body, now = Date.now()): Promise<{ ok: true }> {
  await limit(db, uid, 'write', now);
  const me = await asAdmin(db, uid, body, now);
  await db.query('UPDATE spaces SET name = $2 WHERE id = $1', [me.space_id, str(body, 'name', NAME)]);
  return { ok: true };
}

export async function deleteSpace(db: Db, uid: string, body: Body, now = Date.now()): Promise<{ ok: true }> {
  const me = await asAdmin(db, uid, body, now);
  await db.query('DELETE FROM spaces WHERE id = $1', [me.space_id]);
  return { ok: true };
}

/** Départ d'un membre : ses lignes partent avec lui ; un administrateur est désigné s'il n'en reste plus ; espace vide effacé. */
async function depart(db: Db, sid: string, uid: string): Promise<void> {
  await db.query('DELETE FROM space_records WHERE space_id = $1 AND author = $2', [sid, uid]);
  await db.query('DELETE FROM space_members WHERE space_id = $1 AND user_id = $2', [sid, uid]);
  const left = await db.query<{ user_id: string; role: string }>('SELECT user_id, role FROM space_members WHERE space_id = $1 ORDER BY joined_at', [sid]);
  if (!left.rows.length) return void (await db.query('DELETE FROM spaces WHERE id = $1', [sid]));
  if (!left.rows.some((r) => r.role === 'admin')) await db.query(`UPDATE space_members SET role = 'admin' WHERE space_id = $1 AND user_id = $2`, [sid, left.rows[0]!.user_id]);
}

export async function leaveSpace(db: Db, uid: string, body: Body, now = Date.now()): Promise<{ ok: true }> {
  const me = await membership(db, uid, body, now);
  await depart(db, me.space_id, uid);
  return { ok: true };
}

export async function removeMember(db: Db, uid: string, body: Body, now = Date.now()): Promise<{ ok: true }> {
  const me = await asAdmin(db, uid, body, now);
  const target = str(body, 'uid', UID);
  if (target === uid) throw new HttpError(400, 'Pour partir, quitte l’espace.');
  await depart(db, me.space_id, target);
  return { ok: true };
}

/** Compte supprimé : il quitte tous ses espaces (ses lignes sont effacées). */
export async function forgetSpaceUser(db: Db, uid: string): Promise<void> {
  const { rows } = await db.query<{ space_id: string }>('SELECT space_id FROM space_members WHERE user_id = $1', [uid]);
  for (const r of rows) await depart(db, r.space_id, uid);
}

export async function members(db: Db, uid: string, body: Body, now = Date.now()): Promise<{ members: { uid: string; role: string; profile: string; joinedAt: number; lastSeen: number }[] }> {
  await limit(db, uid, 'read', now);
  const me = await membership(db, uid, body, now);
  const { rows } = await db.query<MemberRow>('SELECT * FROM space_members WHERE space_id = $1 ORDER BY joined_at', [me.space_id]);
  return { members: rows.map((r) => ({ uid: r.user_id, role: r.role, profile: r.profile, joinedAt: Number(r.joined_at), lastSeen: Number(r.last_seen) })) };
}

export async function setProfile(db: Db, uid: string, body: Body, now = Date.now()): Promise<{ ok: true }> {
  await limit(db, uid, 'write', now);
  const me = await membership(db, uid, body, now);
  await db.query('UPDATE space_members SET profile = $3 WHERE space_id = $1 AND user_id = $2', [me.space_id, uid, str(body, 'profile', PROFILE)]);
  return { ok: true };
}

// ---------------------------------------------------------------- invitations

export async function createInvite(db: Db, uid: string, body: Body, now = Date.now()): Promise<{ token: string; id: string; expiresAt: number }> {
  await limit(db, uid, 'write', now);
  const me = await membership(db, uid, body, now);
  const { rows } = await db.query<{ n: string | number }>('SELECT COUNT(*) AS n FROM space_invites WHERE space_id = $1 AND NOT revoked AND expires_at > $2', [me.space_id, now]);
  if (Number(rows[0]?.n ?? 0) >= SPACE_LIMITS.maxActiveInvites) throw new HttpError(409, 'Trop de liens actifs : révoque-en un.');
  const ttl = typeof body.ttlMs === 'number' && Number.isFinite(body.ttlMs) ? Math.min(SPACE_LIMITS.maxInviteMs, Math.max(60 * 60_000, body.ttlMs)) : 7 * 86_400_000;
  const maxUses = typeof body.maxUses === 'number' && Number.isInteger(body.maxUses) && body.maxUses > 0 && body.maxUses <= 100 ? body.maxUses : null;
  const token = randomBytes(16).toString('base64url');
  const id = randomBytes(6).toString('hex');
  await db.query('INSERT INTO space_invites (token_hash, id, space_id, created_by, created_at, expires_at, max_uses) VALUES ($1,$2,$3,$4,$5,$6,$7)', [hashToken(token), id, me.space_id, uid, now, now + ttl, maxUses]);
  return { token, id, expiresAt: now + ttl };
}

export async function revokeInvite(db: Db, uid: string, body: Body, now = Date.now()): Promise<{ ok: true }> {
  const me = await membership(db, uid, body, now);
  await db.query('UPDATE space_invites SET revoked = true WHERE id = $1 AND space_id = $2', [str(body, 'invite', INVITE_ID), me.space_id]);
  return { ok: true };
}

interface InviteRow {
  space_id: string;
  expires_at: string | number;
  max_uses: number | null;
  uses: number;
  revoked: boolean;
  s_name: string;
  s_kind: string;
}

async function usableInvite(db: Db, uid: string, body: Body, now: number): Promise<InviteRow> {
  const win = Math.floor(now / RATE.badInvite.windowMs);
  const bad = await db.query<{ n: number }>('SELECT n FROM space_rate WHERE k = $1 AND win = $2', [`badInvite:${uid}`, win]);
  if (Number(bad.rows[0]?.n ?? 0) >= RATE.badInvite.max) throw new HttpError(429, 'Trop de liens invalides : réessaie dans un quart d’heure.');
  const token = typeof body.token === 'string' ? body.token : '';
  const { rows } = TOKEN.test(token)
    ? await db.query<InviteRow>(
        `SELECT i.space_id, i.expires_at, i.max_uses, i.uses, i.revoked, s.name AS s_name, s.kind AS s_kind
         FROM space_invites i JOIN spaces s ON s.id = i.space_id WHERE i.token_hash = $1`,
        [hashToken(token)],
      )
    : { rows: [] as InviteRow[] };
  const inv = rows[0];
  if (!inv || inv.revoked || Number(inv.expires_at) <= now || (inv.max_uses != null && inv.uses >= inv.max_uses)) {
    await rate(db, `badInvite:${uid}`, RATE.badInvite, now);
    throw new HttpError(404, BAD_INVITE);
  }
  return inv;
}

export async function peekInvite(db: Db, uid: string, body: Body, now = Date.now()): Promise<{ sid: string; kind: string; name: string; member: boolean }> {
  const inv = await usableInvite(db, uid, body, now);
  const { rows } = await db.query('SELECT 1 FROM space_members WHERE space_id = $1 AND user_id = $2', [inv.space_id, uid]);
  return { sid: inv.space_id, kind: inv.s_kind, name: inv.s_name, member: rows.length > 0 };
}

export async function joinSpace(db: Db, uid: string, body: Body, now = Date.now()): Promise<{ sid: string; already: boolean }> {
  await limit(db, uid, 'write', now);
  const inv = await usableInvite(db, uid, body, now);
  const profile = str(body, 'profile', PROFILE);
  const wrappedKey = str(body, 'wrappedKey', WRAPPED);
  const existing = await db.query('SELECT 1 FROM space_members WHERE space_id = $1 AND user_id = $2', [inv.space_id, uid]);
  if (existing.rows.length) return { sid: inv.space_id, already: true };
  const counts = await db.query<{ members: string | number; mine: string | number }>(
    `SELECT (SELECT COUNT(*) FROM space_members WHERE space_id = $1) AS members, (SELECT COUNT(*) FROM space_members WHERE user_id = $2) AS mine`,
    [inv.space_id, uid],
  );
  if (Number(counts.rows[0]?.members ?? 0) >= SPACE_LIMITS.maxMembers) throw new HttpError(409, 'Cet espace est complet.');
  if (Number(counts.rows[0]?.mine ?? 0) >= SPACE_LIMITS.maxSpacesPerUser) throw new HttpError(409, `Tu fais déjà partie de ${SPACE_LIMITS.maxSpacesPerUser} espaces : quittes-en un d’abord.`);
  const used = await db.query('UPDATE space_invites SET uses = uses + 1 WHERE token_hash = $1 AND NOT revoked AND expires_at > $2 AND (max_uses IS NULL OR uses < max_uses) RETURNING space_id', [hashToken(body.token as string), now]);
  if (!used.rows.length) throw new HttpError(404, BAD_INVITE);
  await db.query(`INSERT INTO space_members (space_id, user_id, role, profile, wrapped_key, joined_at, last_seen) VALUES ($1,$2,'member',$3,$4,$5,$5) ON CONFLICT DO NOTHING`, [inv.space_id, uid, profile, wrappedKey, now]);
  return { sid: inv.space_id, already: false };
}

// ---------------------------------------------------------------- lignes

interface RecordRow {
  tbl: string;
  rid: string;
  author: string;
  open: boolean;
  seq: string | number;
  updated_at: string | number;
  deleted: boolean;
  payload: string | null;
}

export interface SpaceChange {
  tbl: string;
  rid: string;
  author: string;
  open: boolean;
  seq: number;
  updatedAt: number;
  deleted: boolean;
  payload: string | null;
}

/**
 * Un passage : envoie des lignes (créées, modifiées, supprimées), reçoit tout ce qui a changé depuis
 * `cursor`. Une écriture refusée (ligne d'un autre, non ouverte) est renvoyée dans `refused`.
 */
export async function syncSpace(db: Db, uid: string, body: Body, now = Date.now()): Promise<{ changes: SpaceChange[]; cursor: number; more: boolean; refused: { tbl: string; rid: string }[] }> {
  const me = await membership(db, uid, body, now);
  const sid = me.space_id;
  const incoming = Array.isArray(body.changes) ? body.changes : [];
  if (incoming.length > 200) throw new HttpError(413, 'Trop de modifications d’un coup.');
  const refused: { tbl: string; rid: string }[] = [];
  if (incoming.length) {
    await limit(db, uid, 'write', now);
    for (const raw of incoming) {
      if (!raw || typeof raw !== 'object') throw new HttpError(400, 'Modification invalide.');
      const c = raw as Body;
      const tbl = str(c, 'tbl', TBL);
      const rid = str(c, 'rid', RID);
      const deleted = c.deleted === true;
      const payload = deleted ? null : str(c, 'payload', PAYLOAD);
      const { rows } = await db.query<RecordRow>('SELECT author, open FROM space_records WHERE space_id = $1 AND tbl = $2 AND rid = $3', [sid, tbl, rid]);
      const row = rows[0];
      const allowed = !row || row.author === uid || row.open || (deleted && me.role === 'admin');
      if (!allowed) {
        refused.push({ tbl, rid });
        continue;
      }
      if (!row) {
        const n = await db.query<{ n: string | number }>('SELECT COUNT(*) AS n FROM space_records WHERE space_id = $1', [sid]);
        if (Number(n.rows[0]?.n ?? 0) >= SPACE_LIMITS.maxRowsPerSpace) throw new HttpError(413, 'Cet espace est plein.');
      }
      await db.query(
        `INSERT INTO space_records (space_id, tbl, rid, author, open, seq, updated_at, deleted, payload)
         VALUES ($1,$2,$3,$4,$5,nextval('space_seq'),$6,$7,$8)
         ON CONFLICT (space_id, tbl, rid) DO UPDATE SET seq = nextval('space_seq'), updated_at = EXCLUDED.updated_at, deleted = EXCLUDED.deleted, payload = EXCLUDED.payload`,
        [sid, tbl, rid, uid, c.open === true, now, deleted, payload],
      );
    }
  } else {
    await limit(db, uid, 'read', now);
  }
  const cursor = typeof body.cursor === 'number' && Number.isFinite(body.cursor) && body.cursor >= 0 ? body.cursor : 0;
  const { rows } = await db.query<RecordRow>(
    `SELECT tbl, rid, author, open, seq, updated_at, deleted, payload FROM space_records WHERE space_id = $1 AND seq > $2 ORDER BY seq LIMIT $3`,
    [sid, cursor, SPACE_LIMITS.pageSize + 1],
  );
  const more = rows.length > SPACE_LIMITS.pageSize;
  const page = rows.slice(0, SPACE_LIMITS.pageSize);
  const changes = page.map((r) => ({ tbl: r.tbl, rid: r.rid, author: r.author, open: r.open, seq: Number(r.seq), updatedAt: Number(r.updated_at), deleted: r.deleted, payload: r.payload }));
  return { changes, cursor: changes.length ? changes[changes.length - 1]!.seq : cursor, more, refused };
}

// ---------------------------------------------------------------- aiguillage

const ACTIONS = {
  spaces: (db: Db, uid: string) => mySpaces(db, uid),
  create: createSpace,
  rename: renameSpace,
  delete: deleteSpace,
  leave: leaveSpace,
  remove: removeMember,
  members,
  profile: setProfile,
  invite: createInvite,
  revoke: revokeInvite,
  peek: peekInvite,
  join: joinSpace,
  sync: syncSpace,
} as const;
type Action = keyof typeof ACTIONS;

export async function spaceDispatch(db: Db, secret: string, auth: string | undefined, body: Body, now = Date.now()): Promise<unknown> {
  const uid = verifyToken(auth, secret, now);
  if (!uid) throw new HttpError(401, 'Session expirée : reconnecte-toi.');
  if (typeof body.action !== 'string' || !Object.hasOwn(ACTIONS, body.action)) throw new HttpError(400, 'Action inconnue');
  const fn = ACTIONS[body.action as Action] as (db: Db, uid: string, body: Body, now: number) => Promise<unknown>;
  return fn(db, uid, body, now);
}
