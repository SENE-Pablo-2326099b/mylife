import type { IncomingMessage, ServerResponse } from 'node:http';
import { attachDatabasePool } from '@vercel/functions';
import pg from 'pg';
import { ensureSchema, HttpError, type Db, type Env } from './core.js';
import { bodyLimit, checkDeclaredLength, checkJsonType } from './limits.js';

let db: Db | null = null;
let ready: Promise<void> | null = null;

/**
 * Une base sur un pool : chaque requête prend une connexion libre ; une transaction en garde une seule du début à
 * la fin (BEGIN, les requêtes, COMMIT ; ROLLBACK si quelque chose échoue), puis la rend au pool.
 */
export function poolDb(pool: pg.Pool): Db {
  const self: Db = {
    query: (text, params) => pool.query(text, params) as never,
    async transaction(fn) {
      const conn = await pool.connect();
      // Une connexion dont l'annulation a échoué n'est pas rendue au pool dans cet état : elle est fermée.
      let broken = false;
      try {
        await conn.query('BEGIN');
        const out = await fn({ query: (text, params) => conn.query(text, params) as never, transaction: () => Promise.reject(new Error('Transaction déjà ouverte.')) });
        await conn.query('COMMIT');
        return out;
      } catch (e) {
        await conn.query('ROLLBACK').catch(() => (broken = true));
        throw e;
      } finally {
        conn.release(broken || undefined);
      }
    },
  };
  return self;
}

/** Pool Postgres (Neon, connexion « pooled ») réutilisé entre requêtes (Fluid compute). */
export async function getDb(): Promise<Db> {
  if (!db) {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
    attachDatabasePool(pool);
    db = poolDb(pool);
  }
  const base = db;
  if (!ready) ready = ensureSchema(base).catch((e) => {
    ready = null;
    throw e;
  });
  await ready;
  return base;
}

export function getEnv(): Env {
  const secret = process.env.SESSION_SECRET ?? '';
  if (secret.length < 32) throw new HttpError(503, 'Serveur non configuré : SESSION_SECRET manquant.');
  return { secret, invite: process.env.INVITE_CODE ?? '', signup: process.env.SIGNUP === 'invite' ? 'invite' : 'open' };
}

type Req = IncomingMessage & { body?: unknown };

/** POST JSON → JSON ; erreurs métier en { error } avec le bon statut, le reste en 500 générique. */
export async function handle(req: Req, res: ServerResponse, fn: (body: Record<string, unknown>, req: Req) => Promise<unknown>): Promise<void> {
  const send = (status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(body));
  };
  if (req.method !== 'POST') return send(405, { error: 'Méthode non autorisée' });
  // Type et taille vérifiés avant de lire le corps (sur Vercel, `req.body` n'est analysé qu'au premier accès).
  const max = bodyLimit(req.url);
  try {
    checkJsonType(req.headers['content-type']);
    checkDeclaredLength(req.headers['content-length'], max);
  } catch (e) {
    return send((e as HttpError).status, { error: (e as Error).message });
  }
  let body = req.body;
  if (typeof body === 'string') {
    if (Buffer.byteLength(body) > max) return send(413, { error: 'Requête trop volumineuse.' });
    try {
      body = JSON.parse(body);
    } catch {
      return send(400, { error: 'Corps JSON invalide' });
    }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return send(400, { error: 'Corps JSON invalide' });
  try {
    send(200, await fn(body as Record<string, unknown>, req));
  } catch (e) {
    if (e instanceof HttpError) return send(e.status, { error: e.message });
    console.error(e);
    send(500, { error: 'Erreur interne du serveur.' });
  }
}

/** Adresse du client vue par Vercel (en-tête posé par la plateforme) : sert seulement aux garde-fous. */
export function clientIp(req: Req): string {
  const h = req.headers['x-real-ip'] ?? req.headers['x-forwarded-for'];
  const v = Array.isArray(h) ? h[0] : h;
  return (v ?? '').split(',')[0]!.trim();
}

export function bearer(req: Req): string | undefined {
  const h = req.headers.authorization;
  return Array.isArray(h) ? h[0] : h;
}
