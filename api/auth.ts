// POST /api/auth : comptes MyLife (voir server/auth.ts pour la liste des actions).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { authDispatch } from '../server/auth.js';
import { ensureRavelocSchema } from '../server/raveloc.js';
import { bearer, clientIp, getDb, getEnv, handle } from '../server/http.js';

let ravelocReady: Promise<void> | null = null;

export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  await handle(req, res, async (body) => {
    const env = getEnv();
    const db = await getDb();
    // La suppression d'un compte touche aussi les tables de myRaveLoc.
    if (body.action === 'deleteAccount') {
      if (!ravelocReady)
        ravelocReady = ensureRavelocSchema(db).catch((e) => {
          ravelocReady = null;
          throw e;
        });
      await ravelocReady;
    }
    return authDispatch(db, env, body, bearer(req), { ip: clientIp(req) });
  });
}
