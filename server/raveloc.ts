import { createHash, randomBytes } from 'node:crypto';
import { HttpError, verifyToken, type Db } from './core.js';

/**
 * myRaveLoc côté serveur (POST /api/raveloc) : groupes, invitations, partage de position.
 * Hébergé par MyLife, à côté des comptes : même session, mêmes secrets, même base (tables raveloc_*).
 *
 * Le serveur ne lit ni les positions, ni les noms de groupe, ni les pseudos : l'appareil les chiffre
 * avec la clé du groupe (AES-256-GCM), transmise entre amis dans le fragment `#` du lien d'invitation,
 * que le navigateur n'envoie jamais. Le serveur, lui, décide QUI reçoit QUOI : chaque requête est
 * authentifiée (session MyLife) et chaque lecture vérifie l'appartenance au groupe et le partage actif.
 *
 * Conservation : une seule position par membre et par groupe (pas d'historique), effacée à l'arrêt du
 * partage, au départ du groupe, à la fin du partage programmé et à l'expiration du groupe (tout le
 * groupe est alors effacé).
 */

export const LIMITS = {
  /** Durée de vie maximale d'un groupe. */
  maxGroupMs: 14 * 86_400_000,
  minGroupMs: 60 * 60_000,
  maxGroupsPerUser: 30,
  maxMembers: 60,
  maxInviteMs: 7 * 86_400_000,
  maxActiveInvites: 20,
  /** Une position plus vieille n'est plus servie (et est effacée). */
  positionTtlMs: 12 * 3_600_000,
  minShareMs: 5 * 60_000,
};

/** Garde-fous contre les abus : nombre de requêtes par fenêtre. */
const RATE = {
  poll: { max: 45, windowMs: 60_000 },
  write: { max: 60, windowMs: 10 * 60_000 },
  create: { max: 20, windowMs: 86_400_000 },
  /** Tentatives d'invitation ratées : protège contre l'essai de jetons au hasard. */
  badInvite: { max: 10, windowMs: 15 * 60_000 },
};

// ---------------------------------------------------------------- schéma

export async function ensureRavelocSchema(db: Db): Promise<void> {
  await db.query(`CREATE TABLE IF NOT EXISTS raveloc_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS raveloc_members (
    group_id TEXT NOT NULL REFERENCES raveloc_groups(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    profile TEXT NOT NULL,
    wrapped_key TEXT NOT NULL,
    joined_at BIGINT NOT NULL,
    last_seen BIGINT NOT NULL,
    sharing TEXT NOT NULL DEFAULT 'off',
    share_until BIGINT,
    PRIMARY KEY (group_id, user_id)
  )`);
  await db.query(`CREATE INDEX IF NOT EXISTS raveloc_members_by_user ON raveloc_members (user_id)`);
  await db.query(`CREATE TABLE IF NOT EXISTS raveloc_positions (
    group_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    client_at BIGINT NOT NULL,
    received_at BIGINT NOT NULL,
    PRIMARY KEY (group_id, user_id),
    FOREIGN KEY (group_id, user_id) REFERENCES raveloc_members (group_id, user_id) ON DELETE CASCADE
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS raveloc_invites (
    token_hash TEXT PRIMARY KEY,
    id TEXT UNIQUE NOT NULL,
    group_id TEXT NOT NULL REFERENCES raveloc_groups(id) ON DELETE CASCADE,
    created_by TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL,
    max_uses INTEGER,
    uses INTEGER NOT NULL DEFAULT 0,
    revoked BOOLEAN NOT NULL DEFAULT false
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS raveloc_rate (k TEXT PRIMARY KEY, win BIGINT NOT NULL, n INTEGER NOT NULL, at BIGINT NOT NULL)`);
}

// ---------------------------------------------------------------- validation

const GID = /^[0-9a-f]{32}$/;
const UID = /^[A-Za-z0-9_-]{1,64}$/;
const TOKEN = /^[A-Za-z0-9_-]{22}$/;
const INVITE_ID = /^[0-9a-f]{12}$/;
/** Blocs chiffrés : base64 (IV + texte + étiquette). */
const sealed = (max: number) => new RegExp(`^[A-Za-z0-9+/=]{32,${max}}$`);
const NAME = sealed(400);
const PROFILE = sealed(300);
const WRAPPED = sealed(120);
const POSITION = sealed(600);

type Body = Record<string, unknown>;

function str(body: Body, key: string, re: RegExp): string {
  const v = body[key];
  if (typeof v !== 'string' || !re.test(v)) throw new HttpError(400, `Paramètre invalide : ${key}`);
  return v;
}

function int(body: Body, key: string, min: number, max: number): number {
  const v = body[key];
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new HttpError(400, `Paramètre invalide : ${key}`);
  return Math.round(v);
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

// ---------------------------------------------------------------- abus et ménage

async function rate(db: Db, key: string, rule: { max: number; windowMs: number }, now: number): Promise<number> {
  const win = Math.floor(now / rule.windowMs);
  const { rows } = await db.query<{ n: number }>(
    `INSERT INTO raveloc_rate (k, win, n, at) VALUES ($1, $2, 1, $3)
     ON CONFLICT (k) DO UPDATE SET n = CASE WHEN raveloc_rate.win = EXCLUDED.win THEN raveloc_rate.n + 1 ELSE 1 END, win = EXCLUDED.win, at = EXCLUDED.at
     RETURNING n`,
    [key, win, now],
  );
  return Number(rows[0]?.n ?? 0);
}

async function limit(db: Db, uid: string, kind: keyof typeof RATE, now: number): Promise<void> {
  if ((await rate(db, `${kind}:${uid}`, RATE[kind], now)) > RATE[kind].max) throw new HttpError(429, 'Trop de requêtes : réessaie dans un moment.');
}

async function tooManyBadInvites(db: Db, uid: string, now: number): Promise<boolean> {
  const win = Math.floor(now / RATE.badInvite.windowMs);
  const { rows } = await db.query<{ n: number }>('SELECT n FROM raveloc_rate WHERE k = $1 AND win = $2', [`badInvite:${uid}`, win]);
  return Number(rows[0]?.n ?? 0) >= RATE.badInvite.max;
}

/**
 * Effacement de ce qui n'a plus lieu d'être : groupes expirés (avec membres, positions, invitations),
 * partages arrivés à leur terme, positions trop vieilles. Les lectures filtrent de toute façon : ce
 * ménage borne la conservation, il ne conditionne pas la confidentialité.
 */
export async function purge(db: Db, now = Date.now()): Promise<void> {
  await db.query('DELETE FROM raveloc_groups WHERE expires_at <= $1', [now]);
  await db.query(
    `DELETE FROM raveloc_positions p USING raveloc_members m
     WHERE p.group_id = m.group_id AND p.user_id = m.user_id AND (m.sharing = 'off' OR m.share_until <= $1 OR p.received_at <= $2)`,
    [now, now - LIMITS.positionTtlMs],
  );
  await db.query(`UPDATE raveloc_members SET sharing = 'off', share_until = NULL WHERE sharing <> 'off' AND share_until <= $1`, [now]);
  await db.query('DELETE FROM raveloc_invites WHERE expires_at <= $1 OR revoked', [now - 86_400_000]);
  await db.query('DELETE FROM raveloc_rate WHERE at <= $1', [now - 2 * 86_400_000]);
}

// ---------------------------------------------------------------- accès

interface MemberRow {
  group_id: string;
  user_id: string;
  role: 'admin' | 'member';
  profile: string;
  wrapped_key: string;
  joined_at: string | number;
  last_seen: string | number;
  sharing: 'on' | 'paused' | 'off';
  share_until: string | number | null;
}

interface GroupRow {
  id: string;
  name: string;
  created_by: string;
  created_at: string | number;
  expires_at: string | number;
}

/**
 * Le groupe, si l'utilisateur en est membre. Groupe inexistant, expiré ou dont on n'est pas membre :
 * même réponse, pour ne rien révéler de l'existence des groupes.
 */
async function membership(db: Db, uid: string, body: Body, now: number): Promise<{ group: GroupRow; me: MemberRow }> {
  const gid = str(body, 'gid', GID);
  const { rows } = await db.query<GroupRow & MemberRow>(
    `SELECT g.id, g.name, g.created_by, g.created_at, g.expires_at, m.* FROM raveloc_groups g
     JOIN raveloc_members m ON m.group_id = g.id AND m.user_id = $2
     WHERE g.id = $1 AND g.expires_at > $3`,
    [gid, uid, now],
  );
  const r = rows[0];
  if (!r) throw new HttpError(404, 'Groupe introuvable (expiré, supprimé, ou tu n’en fais plus partie).');
  return { group: { id: r.id, name: r.name, created_by: r.created_by, created_at: r.created_at, expires_at: r.expires_at }, me: r };
}

async function asAdmin(db: Db, uid: string, body: Body, now: number) {
  const m = await membership(db, uid, body, now);
  if (m.me.role !== 'admin') throw new HttpError(403, 'Réservé aux administrateurs du groupe.');
  return m;
}

const sharingNow = (m: Pick<MemberRow, 'sharing' | 'share_until'>, now: number): MemberRow['sharing'] =>
  m.sharing !== 'off' && m.share_until != null && Number(m.share_until) > now ? m.sharing : 'off';

// ---------------------------------------------------------------- groupes

export interface GroupSummary {
  id: string;
  name: string;
  role: 'admin' | 'member';
  wrappedKey: string;
  createdAt: number;
  expiresAt: number;
  members: number;
  sharing: 'on' | 'paused' | 'off';
  shareUntil: number | null;
}

/** Mes groupes (actifs), avec ma clé de groupe emballée. */
export async function myGroups(db: Db, uid: string, now = Date.now()): Promise<{ uid: string; now: number; groups: GroupSummary[] }> {
  await limit(db, uid, 'poll', now);
  const { rows } = await db.query<GroupRow & MemberRow & { n: string | number }>(
    `SELECT g.id, g.name, g.created_at, g.expires_at, m.role, m.wrapped_key, m.sharing, m.share_until,
       (SELECT COUNT(*) FROM raveloc_members x WHERE x.group_id = g.id) AS n
     FROM raveloc_members m JOIN raveloc_groups g ON g.id = m.group_id
     WHERE m.user_id = $1 AND g.expires_at > $2 ORDER BY g.created_at DESC`,
    [uid, now],
  );
  return {
    uid,
    now,
    groups: rows.map((r) => {
      const sharing = sharingNow(r, now);
      return {
        id: r.id,
        name: r.name,
        role: r.role,
        wrappedKey: r.wrapped_key,
        createdAt: Number(r.created_at),
        expiresAt: Number(r.expires_at),
        members: Number(r.n),
        sharing,
        shareUntil: sharing === 'off' ? null : Number(r.share_until),
      };
    }),
  };
}

/**
 * Crée un groupe. L'identifiant vient de l'appareil (il sert à lier le chiffrement au groupe) : 128 bits
 * aléatoires, refusés s'ils existent déjà.
 */
export async function createGroup(db: Db, uid: string, body: Body, now = Date.now()): Promise<{ id: string; expiresAt: number }> {
  await limit(db, uid, 'create', now);
  const id = str(body, 'gid', GID);
  const name = str(body, 'name', NAME);
  const profile = str(body, 'profile', PROFILE);
  const wrappedKey = str(body, 'wrappedKey', WRAPPED);
  const duration = int(body, 'durationMs', LIMITS.minGroupMs, LIMITS.maxGroupMs);
  const { rows } = await db.query<{ n: string | number }>('SELECT COUNT(*) AS n FROM raveloc_members m JOIN raveloc_groups g ON g.id = m.group_id WHERE m.user_id = $1 AND g.expires_at > $2', [uid, now]);
  if (Number(rows[0]?.n ?? 0) >= LIMITS.maxGroupsPerUser) throw new HttpError(409, `Tu fais déjà partie de ${LIMITS.maxGroupsPerUser} groupes : quittes-en un d’abord.`);
  const expiresAt = now + duration;
  try {
    await db.query('INSERT INTO raveloc_groups (id, name, created_by, created_at, expires_at) VALUES ($1,$2,$3,$4,$5)', [id, name, uid, now, expiresAt]);
  } catch (e) {
    if (/unique|duplicate/i.test(String((e as Error).message))) throw new HttpError(409, 'Identifiant de groupe déjà utilisé : réessaie.');
    throw e;
  }
  await db.query(`INSERT INTO raveloc_members (group_id, user_id, role, profile, wrapped_key, joined_at, last_seen) VALUES ($1,$2,'admin',$3,$4,$5,$5)`, [id, uid, profile, wrappedKey, now]);
  return { id, expiresAt };
}

export async function deleteGroup(db: Db, uid: string, body: Body, now = Date.now()): Promise<{ ok: true }> {
  await limit(db, uid, 'write', now);
  const { group } = await asAdmin(db, uid, body, now);
  await db.query('DELETE FROM raveloc_groups WHERE id = $1', [group.id]);
  return { ok: true };
}

/**
 * Quitter : ma position et mon adhésion disparaissent tout de suite. Si j'étais le dernier admin, le
 * plus ancien membre le devient ; si j'étais le dernier membre, le groupe est effacé.
 */
export async function leaveGroup(db: Db, uid: string, body: Body, now = Date.now()): Promise<{ ok: true }> {
  await limit(db, uid, 'write', now);
  const { group } = await membership(db, uid, body, now);
  await db.query('DELETE FROM raveloc_members WHERE group_id = $1 AND user_id = $2', [group.id, uid]);
  await settleAfterDeparture(db, group.id);
  return { ok: true };
}

async function settleAfterDeparture(db: Db, gid: string): Promise<void> {
  const { rows } = await db.query<{ user_id: string; role: string }>('SELECT user_id, role FROM raveloc_members WHERE group_id = $1 ORDER BY joined_at, user_id', [gid]);
  if (!rows.length) {
    await db.query('DELETE FROM raveloc_groups WHERE id = $1', [gid]);
    return;
  }
  if (!rows.some((r) => r.role === 'admin')) await db.query(`UPDATE raveloc_members SET role = 'admin' WHERE group_id = $1 AND user_id = $2`, [gid, rows[0]!.user_id]);
}

/** Compte supprimé : il quitte tous ses groupes (positions effacées, admin transmis, groupe vide effacé). */
export async function forgetUser(db: Db, uid: string): Promise<void> {
  const { rows } = await db.query<{ group_id: string }>('SELECT group_id FROM raveloc_members WHERE user_id = $1', [uid]);
  for (const r of rows) {
    await db.query('DELETE FROM raveloc_members WHERE group_id = $1 AND user_id = $2', [r.group_id, uid]);
    await settleAfterDeparture(db, r.group_id);
  }
}

/** Un admin retire un membre : son adhésion et sa position sont effacées, ses accès coupés aussitôt. */
export async function removeMember(db: Db, uid: string, body: Body, now = Date.now()): Promise<{ ok: true }> {
  await limit(db, uid, 'write', now);
  const { group } = await asAdmin(db, uid, body, now);
  const target = str(body, 'uid', UID);
  if (target === uid) throw new HttpError(400, 'Pour te retirer toi-même, quitte le groupe.');
  const { rows } = await db.query('DELETE FROM raveloc_members WHERE group_id = $1 AND user_id = $2 RETURNING user_id', [group.id, target]);
  if (!rows.length) throw new HttpError(404, 'Ce membre ne fait plus partie du groupe.');
  await settleAfterDeparture(db, group.id);
  return { ok: true };
}

export async function setRole(db: Db, uid: string, body: Body, now = Date.now()): Promise<{ ok: true }> {
  await limit(db, uid, 'write', now);
  const { group } = await asAdmin(db, uid, body, now);
  const target = str(body, 'uid', UID);
  const role = body.role === 'admin' ? 'admin' : body.role === 'member' ? 'member' : null;
  if (!role) throw new HttpError(400, 'Paramètre invalide : role');
  const { rows } = await db.query('UPDATE raveloc_members SET role = $3 WHERE group_id = $1 AND user_id = $2 RETURNING user_id', [group.id, target, role]);
  if (!rows.length) throw new HttpError(404, 'Ce membre ne fait plus partie du groupe.');
  await settleAfterDeparture(db, group.id);
  return { ok: true };
}

export async function setProfile(db: Db, uid: string, body: Body, now = Date.now()): Promise<{ ok: true }> {
  await limit(db, uid, 'write', now);
  const { group } = await membership(db, uid, body, now);
  await db.query('UPDATE raveloc_members SET profile = $3 WHERE group_id = $1 AND user_id = $2', [group.id, uid, str(body, 'profile', PROFILE)]);
  return { ok: true };
}

// ---------------------------------------------------------------- invitations

export interface InviteInfo {
  id: string;
  createdAt: number;
  expiresAt: number;
  uses: number;
  maxUses: number | null;
  revoked: boolean;
}

/** Nouvelle invitation : le jeton n'est rendu qu'ici, le serveur n'en garde que l'empreinte. */
export async function createInvite(db: Db, uid: string, body: Body, now = Date.now()): Promise<{ token: string; invite: InviteInfo }> {
  await limit(db, uid, 'write', now);
  const { group } = await asAdmin(db, uid, body, now);
  const ttl = int(body, 'ttlMs', 10 * 60_000, LIMITS.maxInviteMs);
  const maxUses = body.maxUses == null ? null : int(body, 'maxUses', 1, LIMITS.maxMembers);
  const { rows } = await db.query<{ n: string | number }>('SELECT COUNT(*) AS n FROM raveloc_invites WHERE group_id = $1 AND NOT revoked AND expires_at > $2', [group.id, now]);
  if (Number(rows[0]?.n ?? 0) >= LIMITS.maxActiveInvites) throw new HttpError(409, 'Trop d’invitations actives : révoque les anciennes.');
  const token = randomBytes(16).toString('base64url');
  const id = randomBytes(6).toString('hex');
  const expiresAt = Math.min(now + ttl, Number(group.expires_at));
  await db.query('INSERT INTO raveloc_invites (token_hash, id, group_id, created_by, created_at, expires_at, max_uses) VALUES ($1,$2,$3,$4,$5,$6,$7)', [hashToken(token), id, group.id, uid, now, expiresAt, maxUses]);
  return { token, invite: { id, createdAt: now, expiresAt, uses: 0, maxUses, revoked: false } };
}

export async function listInvites(db: Db, uid: string, body: Body, now = Date.now()): Promise<{ invites: InviteInfo[] }> {
  const { group } = await asAdmin(db, uid, body, now);
  const { rows } = await db.query<{ id: string; created_at: string; expires_at: string; uses: number; max_uses: number | null; revoked: boolean }>(
    'SELECT id, created_at, expires_at, uses, max_uses, revoked FROM raveloc_invites WHERE group_id = $1 AND NOT revoked AND expires_at > $2 ORDER BY created_at DESC',
    [group.id, now],
  );
  return { invites: rows.map((r) => ({ id: r.id, createdAt: Number(r.created_at), expiresAt: Number(r.expires_at), uses: Number(r.uses), maxUses: r.max_uses == null ? null : Number(r.max_uses), revoked: r.revoked })) };
}

export async function revokeInvite(db: Db, uid: string, body: Body, now = Date.now()): Promise<{ ok: true }> {
  await limit(db, uid, 'write', now);
  const { group } = await asAdmin(db, uid, body, now);
  const { rows } = await db.query('UPDATE raveloc_invites SET revoked = true WHERE group_id = $1 AND id = $2 RETURNING id', [group.id, str(body, 'inviteId', INVITE_ID)]);
  if (!rows.length) throw new HttpError(404, 'Invitation introuvable.');
  return { ok: true };
}

interface InviteRow {
  group_id: string;
  expires_at: string | number;
  max_uses: number | null;
  uses: number;
  revoked: boolean;
  g_name: string;
  g_expires: string | number;
}

const BAD_INVITE = 'Invitation invalide, expirée ou révoquée. Demande un nouveau lien.';

/** Invitation utilisable, sinon une seule erreur générique (et la tentative ratée est comptée). */
async function usableInvite(db: Db, uid: string, body: Body, now: number): Promise<InviteRow> {
  if (await tooManyBadInvites(db, uid, now)) throw new HttpError(429, 'Trop de liens invalides : réessaie dans un quart d’heure.');
  const token = typeof body.token === 'string' ? body.token : '';
  const { rows } = TOKEN.test(token)
    ? await db.query<InviteRow>(
        `SELECT i.group_id, i.expires_at, i.max_uses, i.uses, i.revoked, g.name AS g_name, g.expires_at AS g_expires
         FROM raveloc_invites i JOIN raveloc_groups g ON g.id = i.group_id WHERE i.token_hash = $1`,
        [hashToken(token)],
      )
    : { rows: [] as InviteRow[] };
  const inv = rows[0];
  if (!inv || inv.revoked || Number(inv.expires_at) <= now || Number(inv.g_expires) <= now || (inv.max_uses != null && inv.uses >= inv.max_uses)) {
    await rate(db, `badInvite:${uid}`, RATE.badInvite, now);
    throw new HttpError(404, BAD_INVITE);
  }
  return inv;
}

/** Avant de rejoindre : de quoi afficher « Rejoindre … ? » (nom chiffré, déchiffré par l'appareil). */
export async function peekInvite(db: Db, uid: string, body: Body, now = Date.now()): Promise<{ gid: string; name: string; expiresAt: number; member: boolean }> {
  const inv = await usableInvite(db, uid, body, now);
  const { rows } = await db.query('SELECT 1 FROM raveloc_members WHERE group_id = $1 AND user_id = $2', [inv.group_id, uid]);
  return { gid: inv.group_id, name: inv.g_name, expiresAt: Number(inv.g_expires), member: rows.length > 0 };
}

/** Rejoindre. Déjà membre : rien ne change (le lien peut être ouvert deux fois). Partage coupé par défaut. */
export async function joinGroup(db: Db, uid: string, body: Body, now = Date.now()): Promise<{ gid: string; already: boolean }> {
  await limit(db, uid, 'write', now);
  const inv = await usableInvite(db, uid, body, now);
  const profile = str(body, 'profile', PROFILE);
  const wrappedKey = str(body, 'wrappedKey', WRAPPED);
  const existing = await db.query('SELECT 1 FROM raveloc_members WHERE group_id = $1 AND user_id = $2', [inv.group_id, uid]);
  if (existing.rows.length) return { gid: inv.group_id, already: true };
  const counts = await db.query<{ members: string | number; mine: string | number }>(
    `SELECT (SELECT COUNT(*) FROM raveloc_members WHERE group_id = $1) AS members,
            (SELECT COUNT(*) FROM raveloc_members m JOIN raveloc_groups g ON g.id = m.group_id WHERE m.user_id = $2 AND g.expires_at > $3) AS mine`,
    [inv.group_id, uid, now],
  );
  if (Number(counts.rows[0]?.members ?? 0) >= LIMITS.maxMembers) throw new HttpError(409, 'Ce groupe est complet.');
  if (Number(counts.rows[0]?.mine ?? 0) >= LIMITS.maxGroupsPerUser) throw new HttpError(409, `Tu fais déjà partie de ${LIMITS.maxGroupsPerUser} groupes : quittes-en un d’abord.`);
  // Utilisation comptée de façon atomique : deux amis sur un lien à usage unique, un seul passe.
  const used = await db.query(
    'UPDATE raveloc_invites SET uses = uses + 1 WHERE token_hash = $1 AND NOT revoked AND expires_at > $2 AND (max_uses IS NULL OR uses < max_uses) RETURNING group_id',
    [hashToken(body.token as string), now],
  );
  if (!used.rows.length) throw new HttpError(404, BAD_INVITE);
  await db.query(
    `INSERT INTO raveloc_members (group_id, user_id, role, profile, wrapped_key, joined_at, last_seen) VALUES ($1,$2,'member',$3,$4,$5,$5)
     ON CONFLICT (group_id, user_id) DO NOTHING`,
    [inv.group_id, uid, profile, wrappedKey, now],
  );
  return { gid: inv.group_id, already: false };
}

// ---------------------------------------------------------------- partage et positions

/**
 * on : partage jusqu'à `until` (au plus la fin du groupe) ; paused : plus d'envoi, la dernière position
 * reste visible et figée ; off : la position est effacée du serveur immédiatement.
 */
export async function setSharing(db: Db, uid: string, body: Body, now = Date.now()): Promise<{ sharing: 'on' | 'paused' | 'off'; shareUntil: number | null }> {
  await limit(db, uid, 'write', now);
  const { group, me } = await membership(db, uid, body, now);
  const mode = body.mode;
  if (mode === 'off') {
    await db.query(`UPDATE raveloc_members SET sharing = 'off', share_until = NULL WHERE group_id = $1 AND user_id = $2`, [group.id, uid]);
    await db.query('DELETE FROM raveloc_positions WHERE group_id = $1 AND user_id = $2', [group.id, uid]);
    return { sharing: 'off', shareUntil: null };
  }
  if (mode === 'paused') {
    if (sharingNow(me, now) === 'off') throw new HttpError(409, 'Le partage n’est pas actif.');
    await db.query(`UPDATE raveloc_members SET sharing = 'paused' WHERE group_id = $1 AND user_id = $2`, [group.id, uid]);
    return { sharing: 'paused', shareUntil: Number(me.share_until) };
  }
  if (mode !== 'on') throw new HttpError(400, 'Paramètre invalide : mode');
  const until = Math.min(int(body, 'until', now + LIMITS.minShareMs, Number.MAX_SAFE_INTEGER), Number(group.expires_at));
  await db.query(`UPDATE raveloc_members SET sharing = 'on', share_until = $3 WHERE group_id = $1 AND user_id = $2`, [group.id, uid, until]);
  return { sharing: 'on', shareUntil: until };
}

export interface MemberView {
  uid: string;
  role: 'admin' | 'member';
  profile: string;
  joinedAt: number;
  /** Depuis quand le serveur n'a plus eu de nouvelles de ce membre (ms). */
  seenAgo: number;
  sharing: 'on' | 'paused' | 'off';
  shareUntil: number | null;
  /** Dernière position (chiffrée) et son ancienneté sur le serveur (ms) ; null si non partagée. */
  position: { payload: string; age: number } | null;
}

/**
 * Un échange avec le serveur : envoie ma position (si je partage) et renvoie l'état du groupe.
 * Une position plus ancienne que celle déjà reçue (réseau qui livre dans le désordre) est ignorée.
 */
export async function poll(
  db: Db,
  uid: string,
  body: Body,
  now = Date.now(),
): Promise<{ now: number; accepted: boolean; group: { id: string; name: string; expiresAt: number; createdBy: string }; members: MemberView[] }> {
  await limit(db, uid, 'poll', now);
  const { group, me } = await membership(db, uid, body, now);
  await db.query('UPDATE raveloc_members SET last_seen = $3 WHERE group_id = $1 AND user_id = $2', [group.id, uid, now]);
  let accepted = false;
  if (body.position != null) {
    const p = (typeof body.position === 'object' ? body.position : {}) as Body;
    const payload = str(p, 'payload', POSITION);
    const clientAt = int(p, 'clientAt', 0, Number.MAX_SAFE_INTEGER);
    if (sharingNow(me, now) !== 'on') throw new HttpError(409, 'Partage inactif : position non envoyée.');
    const res = await db.query(
      `INSERT INTO raveloc_positions (group_id, user_id, payload, client_at, received_at) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (group_id, user_id) DO UPDATE SET payload = EXCLUDED.payload, client_at = EXCLUDED.client_at, received_at = EXCLUDED.received_at
       WHERE raveloc_positions.client_at < EXCLUDED.client_at
       RETURNING user_id`,
      [group.id, uid, payload, clientAt, now],
    );
    accepted = res.rows.length > 0;
  }
  const { rows } = await db.query<MemberRow & { payload: string | null; received_at: string | number | null }>(
    `SELECT m.*, p.payload, p.received_at FROM raveloc_members m
     LEFT JOIN raveloc_positions p ON p.group_id = m.group_id AND p.user_id = m.user_id
     WHERE m.group_id = $1 ORDER BY m.joined_at, m.user_id`,
    [group.id],
  );
  const members = rows.map((r): MemberView => {
    const sharing = sharingNow(r, now);
    const fresh = r.payload != null && r.received_at != null && Number(r.received_at) > now - LIMITS.positionTtlMs;
    return {
      uid: r.user_id,
      role: r.role,
      profile: r.profile,
      joinedAt: Number(r.joined_at),
      seenAgo: Math.max(0, now - Number(r.last_seen)),
      sharing,
      shareUntil: sharing === 'off' ? null : Number(r.share_until),
      position: sharing !== 'off' && fresh ? { payload: r.payload!, age: Math.max(0, now - Number(r.received_at)) } : null,
    };
  });
  return { now, accepted, group: { id: group.id, name: group.name, expiresAt: Number(group.expires_at), createdBy: group.created_by }, members };
}

// ---------------------------------------------------------------- aiguillage

export const ACTIONS = {
  groups: (db: Db, uid: string, _b: Body, now?: number) => myGroups(db, uid, now),
  create: createGroup,
  delete: deleteGroup,
  leave: leaveGroup,
  remove: removeMember,
  role: setRole,
  profile: setProfile,
  invite: createInvite,
  invites: listInvites,
  revoke: revokeInvite,
  peek: peekInvite,
  join: joinGroup,
  share: setSharing,
  poll,
} satisfies Record<string, (db: Db, uid: string, body: Body, now?: number) => Promise<unknown>>;

export type Action = keyof typeof ACTIONS;

export async function dispatch(db: Db, secret: string, auth: string | undefined, body: Body, now = Date.now()): Promise<unknown> {
  const uid = verifyToken(auth, secret, now);
  if (!uid) throw new HttpError(401, 'Session expirée : reconnecte-toi.');
  const fn = ACTIONS[body.action as Action];
  if (typeof body.action !== 'string' || !Object.hasOwn(ACTIONS, body.action) || !fn) throw new HttpError(400, 'Action inconnue');
  return fn(db, uid, body, now);
}
