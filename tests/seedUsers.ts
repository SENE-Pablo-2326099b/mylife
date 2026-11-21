import { ensureSchema, type Db } from '../server/core';

/**
 * Comptes minimaux en base, pour les tests qui signent eux-mêmes des jetons : une session n'est valable que pour un
 * compte qui existe (server/core.ts, `verifySession`). Aucune donnée réelle : des empreintes factices.
 */
export async function seedUsers(db: Db, ...uids: string[]): Promise<void> {
  await ensureSchema(db);
  for (const uid of uids) {
    await db.query(
      `INSERT INTO users (id, login, kdf_salt, kdf_iter, auth_hash, rec_hash, wrapped_key, rec_wrapped_key, created_at) VALUES ($1,$1,'s',1,'a','r','w','rw',0) ON CONFLICT (id) DO NOTHING`,
      [uid],
    );
  }
}
