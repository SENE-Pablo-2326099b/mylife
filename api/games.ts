// POST /api/games : { action: 'steam', profile } (session requise) — relais Steam de MyGames (rien n'est gardé)
import type { IncomingMessage, ServerResponse } from 'node:http';
import { gamesDispatch } from '../server/games.js';
import { bearer, getDb, getEnv, handle } from '../server/http.js';

export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  await handle(req, res, async (body) => {
    const env = getEnv();
    const db = await getDb();
    return gamesDispatch(db, { secret: env.secret, steamKey: process.env.STEAM_API_KEY ?? '' }, bearer(req), body);
  });
}
