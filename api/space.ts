// POST /api/space : { action: 'spaces' | 'create' | 'invite' | 'join' | 'sync' | …, … } (session requise) — espaces partagés (Crew…)
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ensureSpaceSchema, spaceDispatch } from '../server/space.js';
import { bearer, getDb, getEnv, handle } from '../server/http.js';

let ready: Promise<void> | null = null;

export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  await handle(req, res, async (body) => {
    const env = getEnv();
    const db = await getDb();
    if (!ready)
      ready = ensureSpaceSchema(db).catch((e) => {
        ready = null;
        throw e;
      });
    await ready;
    return spaceDispatch(db, env.secret, bearer(req), body);
  });
}
