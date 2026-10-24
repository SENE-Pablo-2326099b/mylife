// GET /api/cron-weekly : appelé par le cron de Vercel le dimanche (vercel.json), protégé par CRON_SECRET.
// Purge les vieilles traces de suppression, puis envoie le rappel du dimanche (si les clés VAPID existent).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { purgeTombstones } from '../server/core.js';
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
  try {
    const db = await getDb();
    const purge = await purgeTombstones(db);
    const env = pushEnv();
    send(200, { ...purge, push: env ? await sendWeekly(db, webPushSender(env)) : 'VAPID non configuré' });
  } catch (e) {
    console.error(e);
    send(500, { error: 'Erreur interne' });
  }
}
