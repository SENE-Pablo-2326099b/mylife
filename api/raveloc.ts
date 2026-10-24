// POST /api/raveloc : { action: 'groups' | 'create' | 'poll' | 'share' | 'invite' | 'join' | …, … } (session requise) — app MyRave
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dispatch, ensureRavelocSchema, purge } from '../server/raveloc.js';
import { bearer, getDb, getEnv, handle } from '../server/http.js';

let ready: Promise<void> | null = null;
let lastPurge = 0;

export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  await handle(req, res, async (body) => {
    const env = getEnv();
    const db = await getDb();
    if (!ready)
      ready = ensureRavelocSchema(db).catch((e) => {
        ready = null;
        throw e;
      });
    await ready;
    // Ménage (groupes expirés, partages terminés) au plus une fois par minute et par instance.
    const now = Date.now();
    if (now - lastPurge > 60_000) {
      lastPurge = now;
      await purge(db, now).catch((e: Error) => console.error('raveloc purge', e.message));
    }
    return dispatch(db, env.secret, bearer(req), body, now);
  });
}
