import webpush from 'web-push';
import { HttpError, verifyToken, type Db } from './core.js';

/**
 * Notifications (POST /api/push) : le rappel du dimanche (« Ta semaine est bouclée ») et les rappels écrits par
 * l'appareil (V4, F2). Le serveur ne sait rien de tes données : il envoie le même message générique à tous les
 * abonnés pour le dimanche, et pour les rappels un **signal vide** aux heures de réveil que l'appareil a demandées ;
 * c'est le service worker de l'appareil qui écrit le texte, à partir de ce qu'il garde lui-même. Il garde seulement
 * l'adresse d'abonnement du navigateur (fournie par Google/Apple/Mozilla) et ces heures (en minutes UTC), effacées au
 * désabonnement, à la suppression du compte ou si l'adresse n'est plus valable.
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
  // Heures de réveil d'un appareil (minute de la journée, en UTC) : rien d'autre.
  await db.query(`CREATE TABLE IF NOT EXISTS push_wakeups (
    endpoint TEXT NOT NULL REFERENCES push_subscriptions(endpoint) ON DELETE CASCADE,
    minute INTEGER NOT NULL,
    PRIMARY KEY (endpoint, minute)
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS push_state (k TEXT PRIMARY KEY, v BIGINT NOT NULL)`);
}

/** Heures de réveil gardées au plus par appareil. */
export const MAX_WAKEUPS = 48;

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
      // `weekly` : le rappel du dimanche (par défaut) ; un appareil abonné seulement pour ses rappels le refuse.
      const weekly = body.weekly !== false;
      await db.query(
        `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, weekly, created_at) VALUES ($1,$2,$3,$4,$6,$5)
         ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, weekly = push_subscriptions.weekly OR EXCLUDED.weekly`,
        [endpoint, uid, keys.p256dh, keys.auth, now, weekly],
      );
      return { ok: true };
    }
    case 'weekly': {
      if (!endpoint) throw new HttpError(400, 'Abonnement invalide.');
      await db.query('UPDATE push_subscriptions SET weekly = $3 WHERE endpoint = $1 AND user_id = $2', [endpoint, uid, body.on === true]);
      return { ok: true };
    }
    case 'wakeups': {
      // Les heures de réveil de cet appareil, remplacées en bloc ; jamais de texte ni de raison.
      const minutes = Array.isArray(body.minutes) ? [...new Set(body.minutes.filter((m): m is number => Number.isInteger(m) && m >= 0 && m < 1440))] : null;
      if (!endpoint || !minutes || minutes.length > MAX_WAKEUPS) throw new HttpError(400, `Heures de réveil invalides (${MAX_WAKEUPS} au plus).`);
      const { rows } = await db.query('SELECT 1 FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [endpoint, uid]);
      if (!rows.length) throw new HttpError(404, 'Cet appareil n’est pas abonné aux notifications.');
      await db.query('DELETE FROM push_wakeups WHERE endpoint = $1', [endpoint]);
      for (const m of minutes) await db.query('INSERT INTO push_wakeups (endpoint, minute) VALUES ($1, $2)', [endpoint, m]);
      return { ok: true, count: minutes.length };
    }
    case 'unsubscribe':
      if (endpoint) await db.query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [endpoint, uid]);
      return { ok: true };
    case 'status': {
      const { rows } = endpoint ? await db.query('SELECT 1 FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [endpoint, uid]) : { rows: [] };
      const weekly = endpoint ? await db.query<{ weekly: boolean }>('SELECT weekly FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [endpoint, uid]) : { rows: [] };
      return { subscribed: rows.length > 0, weekly: weekly.rows[0]?.weekly === true, enabled: !!env };
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

/**
 * Réveils (cron toutes les 15 minutes, /api/cron-reminders) : un signal vide à chaque appareil dont une heure de réveil
 * tombe depuis le dernier passage (une heure au plus en arrière). Le texte est écrit par l'appareil.
 */
export async function sendWakeups(db: Db, send: PushSender, now = Date.now()): Promise<{ sent: number; removed: number; failed: number }> {
  await ensurePushSchema(db);
  const { rows: st } = await db.query<{ v: string | number }>("SELECT v FROM push_state WHERE k = 'wakeups'");
  const last = Math.max(Number(st[0]?.v ?? now - 15 * 60_000), now - 60 * 60_000);
  await db.query("INSERT INTO push_state (k, v) VALUES ('wakeups', $1) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v", [now]);
  // Minutes de la journée (UTC) dans ]dernier passage, maintenant], minuit compris.
  const minutes: number[] = [];
  for (let t = Math.floor(last / 60_000) + 1; t <= Math.floor(now / 60_000); t++) minutes.push(t % 1440);
  if (!minutes.length) return { sent: 0, removed: 0, failed: 0 };
  const { rows } = await db.query<{ endpoint: string; p256dh: string; auth: string }>(
    `SELECT DISTINCT s.endpoint, s.p256dh, s.auth FROM push_wakeups w JOIN push_subscriptions s ON s.endpoint = w.endpoint WHERE w.minute = ANY($1::int[])`,
    [minutes],
  );
  const payload = JSON.stringify({ type: 'wake' });
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

