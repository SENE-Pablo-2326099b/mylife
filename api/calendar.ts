// POST /api/calendar : { action: 'fetch', url } (session requise) — relais des agendas ICS de MyAgenda (rien n'est gardé)
import type { IncomingMessage, ServerResponse } from 'node:http';
import { calendarDispatch } from '../server/calendar.js';
import { bearer, getDb, getEnv, handle } from '../server/http.js';

export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  await handle(req, res, async (body) => {
    const env = getEnv();
    const db = await getDb();
    return calendarDispatch(db, { secret: env.secret }, bearer(req), body);
  });
}
