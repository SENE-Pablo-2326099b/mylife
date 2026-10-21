// POST /api/sync : { action: 'status' | 'sync', app, device, cursor, changes, reset } (session requise)
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, sync, syncStatus, verifyToken } from '../server/core.js';
import { bearer, getDb, getEnv, handle } from '../server/http.js';

export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  await handle(req, res, async (body) => {
    const env = getEnv();
    const uid = verifyToken(bearer(req), env.secret);
    if (!uid) throw new HttpError(401, 'Session expirée : reconnecte-toi.');
    const db = await getDb();
    return body.action === 'status' ? syncStatus(db, uid, body) : sync(db, uid, body);
  });
}
