import webpush from 'web-push';
import { HttpError, verifyToken, type Db } from './core.js';

/**
 * Notifications (POST /api/push) : le rappel du dimanche (« Ta semaine est bouclée »). Le serveur ne sait
 * rien de tes données : il envoie le même message générique à tous les abonnés, chiffré jusqu'à l'appareil
 * par le protocole Web Push. Il garde seulement l'adresse d'abonnement du navigateur (fournie par
 * Google/Apple/Mozilla), effacée au désabonnement, à la suppression du compte ou si elle n'est plus valable.
 * Clés VAPID : variables VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (sans elles, la fonction est désactivée).
 */

export interface PushEnv {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export function pushEnv(): PushEnv | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY ?? '';
  const privateKey = process.env.VAPID_PRIVATE_KEY ?? '';
  return publicKey && privateKey ? { publicKey, privateKey, subject: process.env.VAPID_SUBJECT || 'https://mylife-liart.vercel.app' } : null;
}

export async function ensurePushSchema(db: Db): Promise<void> {
  await db.query(`CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    weekly BOOLEAN NOT NULL DEFAULT true,
    created_at BIGINT NOT NULL
  )`);
  await db.query(`CREATE INDEX IF NOT EXISTS push_by_user ON push_subscriptions (user_id)`);
}

const ENDPOINT = /^https:\/\/[A-Za-z0-9.-]+(:\d+)?\/[\x21-\x7e]{8,1000}$/;
const KEY = /^[A-Za-z0-9_-]{10,200}$/;

export async function pushDispatch(db: Db, secret: string, auth: string | undefined, body: Record<string, unknown>, env = pushEnv(), now = Date.now()): Promise<unknown> {
  if (body.action === 'key') return { publicKey: env?.publicKey ?? null };
  const uid = verifyToken(auth, secret, now);
  if (!uid) throw new HttpError(401, 'Session expirée : reconnecte-toi.');
  await ensurePushSchema(db);
  const endpoint = typeof body.endpoint === 'string' && ENDPOINT.test(body.endpoint) ? body.endpoint : null;
  switch (body.action) {
    case 'subscribe': {
      if (!env) throw new HttpError(503, 'Les notifications ne sont pas encore activées sur ce serveur.');
      const keys = body.keys as { p256dh?: unknown; auth?: unknown } | undefined;
      if (!endpoint || typeof keys?.p256dh !== 'string' || !KEY.test(keys.p256dh) || typeof keys.auth !== 'string' || !KEY.test(keys.auth)) throw new HttpError(400, 'Abonnement invalide.');
      const { rows } = await db.query<{ n: string | number }>('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = $1', [uid]);
      if (Number(rows[0]?.n ?? 0) >= 10) await db.query('DELETE FROM push_subscriptions WHERE endpoint = (SELECT endpoint FROM push_subscriptions WHERE user_id = $1 ORDER BY created_at LIMIT 1)', [uid]);
      await db.query(
        `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, weekly, created_at) VALUES ($1,$2,$3,$4,true,$5)
         ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, weekly = true`,
        [endpoint, uid, keys.p256dh, keys.auth, now],
      );
      return { ok: true };
    }
    case 'unsubscribe':
      if (endpoint) await db.query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [endpoint, uid]);
      return { ok: true };
    case 'status': {
      const { rows } = endpoint ? await db.query('SELECT 1 FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [endpoint, uid]) : { rows: [] };
      return { subscribed: rows.length > 0, enabled: !!env };
    }
    default:
      throw new HttpError(400, 'Action inconnue');
  }
}

export type PushSender = (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string) => Promise<{ statusCode: number }>;

export function webPushSender(env: PushEnv): PushSender {
  webpush.setVapidDetails(env.subject, env.publicKey, env.privateKey);
  return (sub, payload) => webpush.sendNotification(sub, payload, { TTL: 12 * 3600 });
}

/** Le rappel du dimanche à tous les abonnés ; les abonnements expirés (404/410) sont effacés. */
export async function sendWeekly(db: Db, send: PushSender): Promise<{ sent: number; removed: number; failed: number }> {
  await ensurePushSchema(db);
  const { rows } = await db.query<{ endpoint: string; p256dh: string; auth: string }>('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE weekly');
  const payload = JSON.stringify({ title: 'Ta semaine est bouclée', body: 'Ton bilan t’attend : séances, budget, quêtes.', url: '/bilan' });
  let sent = 0;
  let removed = 0;
  let failed = 0;
  for (const r of rows) {
    try {
      await send({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, payload);
      sent += 1;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await db.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [r.endpoint]);
        removed += 1;
      } else failed += 1;
    }
  }
  return { sent, removed, failed };
}
