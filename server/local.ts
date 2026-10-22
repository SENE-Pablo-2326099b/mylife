/**
 * Serveur local pour le développement et les tests de bout en bout — jamais déployé.
 *
 * - `/raveloc/*` : l'app construite (dist), avec les mêmes en-têtes de sécurité qu'en production ;
 * - `/api/raveloc` : la vraie API, hébergée par MyLife (`../MyLife/server/raveloc.ts`) ;
 * - `/api/auth` : la vraie authentification de MyLife (`../MyLife/server/core.ts`) ;
 * le tout sur un Postgres en mémoire (PGlite) : aucune donnée réelle.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import * as mylife from '../../MyLife/server/core';
import { dispatch, ensureRavelocSchema, purge } from '../../MyLife/server/raveloc';
import vercel from '../vercel.json';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
};

export interface LocalServer {
  url: string;
  db: mylife.Db;
  server: Server;
  invite: string;
  close(): Promise<void>;
}

const securityHeaders = (vercel.headers.find((h) => h.source === '/(.*)')?.headers ?? []) as { key: string; value: string }[];

export async function startLocalServer(opts: { port: number; dist?: string; secret?: string; invite?: string }): Promise<LocalServer> {
  const pg = new PGlite();
  const db = pg as unknown as mylife.Db;
  await mylife.ensureSchema(db);
  await ensureRavelocSchema(db);
  const env = { secret: opts.secret ?? 'local-secret-'.padEnd(40, 'x'), invite: opts.invite ?? 'local-invite' };
  const dist = opts.dist ?? join(process.cwd(), 'dist');

  async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    return JSON.parse(Buffer.concat(chunks).toString() || '{}') as Record<string, unknown>;
  }

  async function api(req: IncomingMessage, res: ServerResponse, path: string) {
    const send = (status: number, data: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(data));
    };
    try {
      const b = await body(req);
      if (path === '/api/auth') {
        const fn = { salt: mylife.getSalt, signup: mylife.signup, login: mylife.login }[b.action as 'salt'];
        if (!fn) throw new mylife.HttpError(400, 'Action inconnue');
        return send(200, await fn(db, env, b));
      }
      await purge(db);
      send(200, await dispatch(db, env.secret, req.headers.authorization, b));
    } catch (e) {
      const status = e instanceof mylife.HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      send(status, { error: (e as Error).message });
    }
  }

  async function file(res: ServerResponse, path: string) {
    const safe = normalize(path).replace(/^(\.\.[/\\])+/, '');
    let p = join(dist, safe);
    let data: Buffer;
    try {
      data = await readFile(p);
    } catch {
      p = join(dist, 'raveloc', 'index.html');
      data = await readFile(p);
    }
    const headers: Record<string, string> = { 'content-type': TYPES[extname(p)] ?? 'application/octet-stream' };
    for (const h of securityHeaders) headers[h.key] = h.value;
    res.writeHead(200, headers);
    res.end(data);
  }

  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]!;
    if (path === '/api/raveloc' || path === '/api/auth') {
      if (req.method !== 'POST') {
        res.writeHead(405).end();
        return;
      }
      void api(req, res, path);
    } else if (path === '/raveloc' || path.startsWith('/raveloc/')) void file(res, path === '/raveloc' || path.endsWith('/') ? `${path.replace(/\/?$/, '/')}index.html` : path).catch(() => res.writeHead(404).end());
    else {
      res.writeHead(302, { location: '/raveloc/' });
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(opts.port, '127.0.0.1', r));
  return {
    url: `http://localhost:${opts.port}`,
    db,
    server,
    invite: env.invite,
    close: () => new Promise<void>((r) => server.close(() => void pg.close().then(() => r()))),
  };
}
