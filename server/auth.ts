import { available, changePassword, deleteAccount, getSalt, HttpError, login, recoverFinish, recoverStart, renewRecovery, signup, verifyToken, type Client, type Db, type Env } from './core.js';
import { forgetUser } from './raveloc.js';
import { ensureSpaceSchema, forgetSpaceUser } from './space.js';

/**
 * POST /api/auth : { action, … }. Sans session : `salt`, `available`, `signup`, `login`,
 * `recoverStart`, `recoverFinish`. Avec session : `password`, `renewRecovery`, `deleteAccount`.
 */
export async function authDispatch(db: Db, env: Env, body: Record<string, unknown>, auth: string | undefined, client: Client): Promise<unknown> {
  const session = () => {
    const uid = verifyToken(auth, env.secret, client.now);
    if (!uid) throw new HttpError(401, 'Session expirée : reconnecte-toi.');
    return uid;
  };
  switch (body.action) {
    case 'salt':
      return getSalt(db, env, body);
    case 'available':
      return available(db, env, body, client);
    case 'signup':
      return signup(db, env, body, client);
    case 'login':
      return login(db, env, body, client);
    case 'recoverStart':
      return recoverStart(db, env, body, client);
    case 'recoverFinish':
      return recoverFinish(db, env, body, client);
    case 'password':
      return changePassword(db, env, session(), body);
    case 'renewRecovery':
      return renewRecovery(db, env, session(), body);
    case 'deleteAccount': {
      const uid = session();
      const out = await deleteAccount(db, env, uid, body, client);
      // Ses groupes myRaveLoc : il les quitte (positions effacées, admin transmis).
      await forgetUser(db, uid);
      // Ses espaces partagés (Crew…) : il les quitte, ses lignes sont effacées.
      await ensureSpaceSchema(db);
      await forgetSpaceUser(db, uid);
      return out;
    }
    default:
      throw new HttpError(400, 'Action inconnue');
  }
}
