// POST /api/sync : synchronisation chiffrée (voir server/sync.ts).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { syncDispatch } from '../server/sync.js';
import { bearer, getDb, getEnv, handle } from '../server/http.js';

export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  await handle(req, res, async (body) => syncDispatch(await getDb(), getEnv(), body, bearer(req)));
}
