/**
 * MyLife en local, pour le développement et les tests de bout en bout — jamais déployé.
 *
 * Une seule adresse, comme en production : l'accueil (`/`), les apps construites (`/finances/`,
 * `/perf/`, `/raveloc/`) et les vraies API de MyLife (`/api/auth`, `/api/sync`, `/api/raveloc`) sur
 * un Postgres en mémoire (PGlite) : aucune donnée réelle. Une app pas encore construite répond 404.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { authDispatch } from './auth.js';
import { ensureSchema, HttpError, type Db, type Env } from './core.js';
import { dispatch as ravelocDispatch, ensureRavelocSchema, purge } from './raveloc.js';
import { ensureSpaceSchema, spaceDispatch } from './space.js';
import { gamesDispatch } from './games.js';
import { calendarDispatch } from './calendar.js';
import { supportDispatch } from './support.js';
import { pushDispatch } from './push.js';
import { syncDispatch } from './sync.js';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

const here = (p: string) => new URL(p, import.meta.url).pathname;

/** Où trouver chaque partie construite (dossier qui contient le chemin public). */
export const BUILDS = {
  home: here('../web/dist'),
  finances: here('../apps/finances/dist'),
  perf: here('../apps/perf/web'),
  raveloc: here('../apps/raveloc/dist'),
};

export interface LocalServer {
  url: string;
  db: Db;
  server: Server;
  env: Env;
  close(): Promise<void>;
}

export async function startLocalServer(opts: { port: number; env?: Partial<Env>; builds?: Partial<typeof BUILDS> }): Promise<LocalServer> {
  const pg = new PGlite();
  const db = pg as unknown as Db;
  await ensureSchema(db);
  await ensureRavelocSchema(db);
  await ensureSpaceSchema(db);
  const env: Env = { secret: 'local-secret-'.padEnd(40, 'x'), invite: 'local-invite', signup: 'open', ...opts.env };
  const builds = { ...BUILDS, ...opts.builds };

  async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
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
      const body = await readBody(req);
      const auth = req.headers.authorization;
      if (path === '/api/auth') return send(200, await authDispatch(db, env, body, auth, { ip: req.socket.remoteAddress ?? '' }));
      if (path === '/api/sync') return send(200, await syncDispatch(db, env, body, auth));
      if (path === '/api/space') return send(200, await spaceDispatch(db, env.secret, auth, body));
      if (path === '/api/push') return send(200, await pushDispatch(db, env.secret, auth, body));
      if (path === '/api/support') return send(200, await supportDispatch(db, env.secret, auth, body));
      if (path === '/api/games') return send(200, await gamesDispatch(db, { secret: env.secret, steamKey: process.env.STEAM_API_KEY ?? '' }, auth, body));
      if (path === '/api/calendar') return send(200, await calendarDispatch(db, { secret: env.secret }, auth, body));
      await purge(db);
      send(200, await ravelocDispatch(db, env.secret, auth, body));
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      send(status, { error: (e as Error).message });
    }
  }

  /**
   * Les en-têtes de sécurité de la production (Content-Security-Policy…), lus dans les vercel.json : les
   * parcours de bout en bout voient ce que verra le navigateur en ligne (une API appelée sans être autorisée
   * par la CSP casse ici aussi).
   */
  const securityHeaders = await loadSecurityHeaders();

  /** Fichier d'une partie, ou sa page d'entrée (navigation dans une app à une page). */
  async function file(res: ServerResponse, root: string, path: string, entry: string, part: 'home' | 'finances' | 'perf' | 'raveloc' = 'home') {
    const safe = normalize(decodeURIComponent(path)).replace(/^(\.\.[/\\])+/, '');
    let p = join(root, safe.endsWith('/') ? `${safe}index.html` : safe);
    let data: Buffer;
    try {
      data = await readFile(p);
    } catch {
      if (extname(safe) && extname(safe) !== '.html') {
        res.writeHead(404).end();
        return;
      }
      p = join(root, entry);
      data = await readFile(p);
    }
    const extra = Object.fromEntries((securityHeaders[part] ?? []).filter((h) => h.re.test(path)).flatMap((h) => h.headers.filter((x) => x.key !== 'Cache-Control').map((x) => [x.key, x.value])));
    res.writeHead(200, { ...extra, 'content-type': TYPES[extname(p)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  }

  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]!;
    const fail = () => res.headersSent || res.writeHead(404).end();
    if (path.startsWith('/api/')) {
      if (req.method !== 'POST') return void res.writeHead(405).end();
      return void api(req, res, path);
    }
    for (const app of ['finances', 'perf', 'raveloc'] as const) {
      if (path === `/${app}`) return void res.writeHead(301, { location: `/${app}/` }).end();
      if (path.startsWith(`/${app}/`)) return void file(res, builds[app], path, `${app}/index.html`, app).catch(fail);
    }
    void file(res, builds.home, path, 'index.html').catch(fail);
  });
  await new Promise<void>((r) => server.listen(opts.port, '127.0.0.1', r));
  return {
    url: `http://localhost:${opts.port}`,
    db,
    server,
    env,
    close: () => new Promise<void>((r) => server.close(() => void pg.close().then(() => r()))),
  };
}

type HeaderRule = { re: RegExp; headers: { key: string; value: string }[] };

/** Règles d'en-têtes de chaque partie (vercel.json de l'accueil et des apps). Motifs Vercel simples → expressions régulières. */
async function loadSecurityHeaders(): Promise<Partial<Record<'home' | 'finances' | 'perf' | 'raveloc', HeaderRule[]>>> {
  const files = { home: here('../vercel.json'), finances: here('../apps/finances/vercel.json'), perf: here('../apps/perf/vercel.json'), raveloc: here('../apps/raveloc/vercel.json') };
  const out: Partial<Record<keyof typeof files, HeaderRule[]>> = {};
  for (const [part, f] of Object.entries(files) as [keyof typeof files, string][]) {
    try {
      const conf = JSON.parse(await readFile(f, 'utf8')) as { headers?: { source: string; headers: { key: string; value: string }[] }[] };
      out[part] = (conf.headers ?? []).map((h) => ({ re: new RegExp(`^${h.source.replace(/:path\*/g, '.*')}$`), headers: h.headers }));
    } catch {
      /* pas de vercel.json pour cette partie */
    }
  }
  return out;
}
