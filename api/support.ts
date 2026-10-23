// POST /api/support : { action: 'send', kind, message, app } (session requise) — « Un problème, une idée ? »
import type { IncomingMessage, ServerResponse } from 'node:http';
import { supportDispatch } from '../server/support.js';
import { bearer, getDb, getEnv, handle } from '../server/http.js';

export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  await handle(req, res, async (body) => supportDispatch(await getDb(), getEnv().secret, bearer(req), body));
}
