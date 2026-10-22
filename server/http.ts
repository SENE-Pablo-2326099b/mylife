import type { IncomingMessage, ServerResponse } from 'node:http';
import { attachDatabasePool } from '@vercel/functions';
import pg from 'pg';
import { dispatch, ensureSchema, HttpError, purge, type Db, type Env } from './core.js';

let pool: pg.Pool | null = null;
let ready: Promise<void> | null = null;
let lastPurge = 0;

/** Pool Postgres (Neon, connexion « pooled ») réutilisé entre requêtes (Fluid compute). */
export async function getDb(): Promise<Db> {
  if (!pool) {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
    attachDatabasePool(pool);
  }
  if (!ready)
    ready = ensureSchema(pool).catch((e) => {
      ready = null;
      throw e;
    });
  await ready;
  return pool;
}

export function getEnv(): Env {
  const secret = process.env.SESSION_SECRET ?? '';
  if (secret.length < 32) throw new HttpError(503, 'Serveur non configuré : SESSION_SECRET manquant.');
  if (!process.env.DATABASE_URL) throw new HttpError(503, 'Serveur non configuré : DATABASE_URL manquant.');
  return { secret };
}

type Req = IncomingMessage & { body?: unknown };

/**
 * POST JSON → JSON. Erreurs métier en { error } avec le bon statut, le reste en 500 générique.
 * Jamais de corps de requête dans les journaux : il peut contenir des positions (chiffrées) et des jetons.
 */
export async function handle(req: Req, res: ServerResponse): Promise<void> {
  const send = (status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(body));
  };
  if (req.method !== 'POST') return send(405, { error: 'Méthode non autorisée' });
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return send(400, { error: 'Corps JSON invalide' });
    }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return send(400, { error: 'Corps JSON invalide' });
  try {
    const env = getEnv();
    const db = await getDb();
    const now = Date.now();
    if (now - lastPurge > 60_000) {
      lastPurge = now;
      await purge(db, now).catch((e: Error) => console.error('purge', e.message));
    }
    const auth = Array.isArray(req.headers.authorization) ? req.headers.authorization[0] : req.headers.authorization;
    send(200, await dispatch(db, env, auth, body as Record<string, unknown>, now));
  } catch (e) {
    if (e instanceof HttpError) return send(e.status, { error: e.message });
    console.error('raveloc', (e as Error).name, (e as Error).message);
    send(500, { error: 'Erreur interne du serveur.' });
  }
}
