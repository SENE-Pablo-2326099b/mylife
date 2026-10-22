// POST /api/raveloc : { action: 'groups' | 'create' | 'poll' | 'share' | 'invite' | 'join' | …, … } (session MyLife requise)
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handle } from '../server/http.js';

export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  await handle(req, res);
}
