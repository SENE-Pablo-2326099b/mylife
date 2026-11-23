// POST /api/push : { action: 'key' | 'subscribe' | 'unsubscribe' | 'status' | 'wakeups' | 'rest', … } — notifications (Web Push)
import type { IncomingMessage, ServerResponse } from 'node:http';
import { waitUntil } from '@vercel/functions';
import { pushDispatch, pushEnv, webPushSender, type RestRuntime } from '../server/push.js';
import { bearer, getDb, getEnv, handle } from '../server/http.js';

// Une fin de repos s'attend par tranches de 4 min 30 (les fonctions durent 5 min au plus) : avant d'expirer, la
// fonction se relance elle-même avec le même compte, pour le même repos.
const HOST = /^[A-Za-z0-9.-]+(:\d+)?$/;

export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  const env = pushEnv();
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '');
  const authorization = req.headers.authorization;
  const rest: RestRuntime = {
    wait: waitUntil,
    limitMs: 270_000,
    send: env ? (sub, payload) => webPushSender(env)(sub, payload) : null,
    relay: HOST.test(host)
      ? async ({ endpoint, at, token }) => {
          await fetch(`https://${host}/api/push`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) },
            body: JSON.stringify({ action: 'rest', endpoint, at, resume: token }),
          });
        }
      : null,
  };
  await handle(req, res, async (body) => pushDispatch(await getDb(), getEnv().secret, bearer(req), body, env, Date.now(), rest));
}
