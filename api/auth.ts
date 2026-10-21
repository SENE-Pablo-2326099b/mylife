// POST /api/auth : { action: 'salt' | 'signup' | 'login' | 'recoverStart' | 'recoverFinish' | 'password', … }
import type { IncomingMessage, ServerResponse } from 'node:http';
import { changePassword, getSalt, HttpError, login, recoverFinish, recoverStart, signup, verifyToken } from '../server/core.js';
import { bearer, getDb, getEnv, handle } from '../server/http.js';

export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  await handle(req, res, async (body) => {
    const env = getEnv();
    const db = await getDb();
    switch (body.action) {
      case 'salt':
        return getSalt(db, env, body);
      case 'signup':
        return signup(db, env, body);
      case 'login':
        return login(db, env, body);
      case 'recoverStart':
        return recoverStart(db, env, body);
      case 'recoverFinish':
        return recoverFinish(db, env, body);
      case 'password': {
        const uid = verifyToken(bearer(req), env.secret);
        if (!uid) throw new HttpError(401, 'Session expirée : reconnecte-toi.');
        return changePassword(db, env, uid, body);
      }
      default:
        throw new HttpError(400, 'Action inconnue');
    }
  });
}
