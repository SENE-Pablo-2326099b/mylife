import { randomBytes } from 'node:crypto';
import { HttpError, verifyToken, type Db } from './core.js';

/**
 * Support (POST /api/support) : « Un problème, une idée ? » depuis l'app. Le message n'est PAS chiffré :
 * l'équipe doit pouvoir le lire (c'est dit à l'écran). Lié au compte, 5 par jour, effacé au plus tard
 * 90 jours après (ou dès qu'il est traité : scripts/support.mjs).
 */

export const SUPPORT_KINDS = ['bug', 'idee', 'question', 'donnees'] as const;
const KEEP_MS = 90 * 86_400_000;
const PER_DAY = 5;

export async function ensureSupportSchema(db: Db): Promise<void> {
  await db.query(`CREATE TABLE IF NOT EXISTS support_messages (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    app TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at BIGINT NOT NULL
  )`);
}

export async function sendSupport(db: Db, uid: string, body: Record<string, unknown>, now = Date.now()): Promise<{ ok: true }> {
  const kind = body.kind;
  if (typeof kind !== 'string' || !(SUPPORT_KINDS as readonly string[]).includes(kind)) throw new HttpError(400, 'Paramètre invalide : kind');
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (message.length < 3 || message.length > 2000) throw new HttpError(400, 'Message vide ou trop long (2 000 caractères au plus).');
  const app = typeof body.app === 'string' && /^[a-z]{2,12}$/.test(body.app) ? body.app : 'home';
  await db.query('DELETE FROM support_messages WHERE created_at <= $1', [now - KEEP_MS]);
  const { rows } = await db.query<{ n: string | number }>('SELECT COUNT(*) AS n FROM support_messages WHERE user_id = $1 AND created_at > $2', [uid, now - 86_400_000]);
  if (Number(rows[0]?.n ?? 0) >= PER_DAY) throw new HttpError(429, 'Tu nous as déjà écrit plusieurs fois aujourd’hui : on te lit, réessaie demain.');
  await db.query('INSERT INTO support_messages (id, user_id, kind, app, message, created_at) VALUES ($1,$2,$3,$4,$5,$6)', [randomBytes(8).toString('hex'), uid, kind, app, message, now]);
  return { ok: true };
}

export async function supportDispatch(db: Db, secret: string, auth: string | undefined, body: Record<string, unknown>): Promise<unknown> {
  const uid = verifyToken(auth, secret);
  if (!uid) throw new HttpError(401, 'Session expirée : reconnecte-toi.');
  if (body.action !== 'send') throw new HttpError(400, 'Action inconnue');
  await ensureSupportSchema(db);
  return sendSupport(db, uid, body);
}
