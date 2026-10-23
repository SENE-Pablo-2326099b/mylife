// GET /api/cron-weekly : appelé par le cron de Vercel le dimanche (vercel.json), protégé par CRON_SECRET.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pushEnv, sendWeekly, webPushSender } from '../server/push.js';
import { getDb } from '../server/http.js';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const send = (status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
  };
  const secret = process.env.CRON_SECRET ?? '';
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return send(401, { error: 'Non autorisé' });
  const env = pushEnv();
  if (!env) return send(200, { skipped: 'VAPID non configuré' });
  try {
    send(200, await sendWeekly(await getDb(), webPushSender(env)));
  } catch (e) {
    console.error(e);
    send(500, { error: 'Erreur interne' });
  }
}
