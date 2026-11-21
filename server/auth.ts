import { available, changePassword, deleteAccount, getSalt, HttpError, login, recoverFinish, recoverStart, renewRecovery, requireSession, signup, type Client, type Db, type Env } from './core.js';
import { forgetUser } from './raveloc.js';
import { ensureSpaceSchema, forgetSpaceUser } from './space.js';
import { ensureSupportSchema } from './support.js';
import { ensurePushSchema } from './push.js';

/**
 * POST /api/auth : { action, … }. Sans session : `salt`, `available`, `signup`, `login`,
 * `recoverStart`, `recoverFinish`. Avec session : `password`, `renewRecovery`, `deleteAccount`.
 */
export async function authDispatch(db: Db, env: Env, body: Record<string, unknown>, auth: string | undefined, client: Client): Promise<unknown> {
  const session = () => requireSession(db, auth, env.secret, client.now);
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
      return changePassword(db, env, await session(), body, client.now);
    case 'renewRecovery':
      return renewRecovery(db, env, await session(), body);
    case 'deleteAccount': {
      const uid = await session();
      // Les tables hors du compte existent avant d'ouvrir la transaction (création au premier appel).
      await ensureSpaceSchema(db);
      await ensureSupportSchema(db);
      await ensurePushSchema(db);
      // Tout ou rien : s'il manque une étape, le compte reste entier et on peut réessayer.
      return deleteAccount(db, env, uid, body, client, async (tx) => {
        // Ses groupes MyRave : il les quitte (positions effacées, admin transmis).
        await forgetUser(tx, uid);
        // Ses espaces partagés (Crew…) : il les quitte, ses lignes sont effacées.
        await forgetSpaceUser(tx, uid);
        // Ses messages au support et ses abonnements aux notifications partent aussi.
        await tx.query('DELETE FROM support_messages WHERE user_id = $1', [uid]);
        await tx.query('DELETE FROM push_subscriptions WHERE user_id = $1', [uid]);
      });
    }
    default:
      throw new HttpError(400, 'Action inconnue');
  }
}
