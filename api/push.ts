// POST /api/push : { action: 'key' | 'subscribe' | 'unsubscribe' | 'status', … } — rappel du dimanche (Web Push)
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pushDispatch } from '../server/push.js';
import { bearer, getDb, getEnv, handle } from '../server/http.js';

export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  await handle(req, res, async (body) => pushDispatch(await getDb(), getEnv().secret, bearer(req), body));
}
