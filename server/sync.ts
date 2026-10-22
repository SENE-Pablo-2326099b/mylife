import { HttpError, sync, syncStatus, verifyToken, type Db, type Env } from './core.js';

/** POST /api/sync : { action: 'status' | 'sync', app, device, cursor, changes, reset } (session requise). */
export async function syncDispatch(db: Db, env: Env, body: Record<string, unknown>, auth: string | undefined): Promise<unknown> {
  const uid = verifyToken(auth, env.secret);
  if (!uid) throw new HttpError(401, 'Session expirée : reconnecte-toi.');
  return body.action === 'status' ? syncStatus(db, uid, body) : sync(db, uid, body);
}
