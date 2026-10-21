/**
 * Relais Enable Banking (sans état).
 *
 * - Garde la clé privée de l'application (variable d'environnement) et signe les JWT RS256.
 * - N'expose qu'une liste fermée d'opérations en lecture (AIS), avec validation stricte des paramètres.
 * - Ne stocke rien et ne journalise aucune donnée bancaire : chaque réponse est relayée telle quelle au navigateur.
 * - Protégé par un mot de passe partagé (en-tête x-bridge-password).
 *
 * Utilisé par : api/eb.ts (Vercel), netlify/functions/eb.ts (Netlify), server/vitePlugin.ts (dev / preview).
 */
import { createSign, timingSafeEqual, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fetchHistory, fetchQuotes, MarketInputError, searchAssets } from './market.js';

export const EB_API_BASE = 'https://api.enablebanking.com';

export interface BridgeEnv {
  appId?: string;
  privateKey?: string;
  password?: string;
  apiBase?: string;
  /** Liste d'URL de retour autorisées, séparées par des virgules (facultatif). */
  allowedRedirects?: string;
}

export interface BridgeRequest {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

export interface BridgeResponse {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{
  status: number;
  ok: boolean;
  text(): Promise<string>;
}>;

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

/** Lit la configuration depuis les variables d'environnement. */
export function loadBridgeEnv(source: Record<string, string | undefined> = process.env): BridgeEnv {
  let privateKey = source.EB_PRIVATE_KEY;
  if (!privateKey && source.EB_PRIVATE_KEY_PATH) {
    try {
      privateKey = readFileSync(source.EB_PRIVATE_KEY_PATH, 'utf8');
    } catch {
      privateKey = undefined;
    }
  }
  return {
    appId: source.EB_APP_ID?.trim() || undefined,
    privateKey: privateKey ? normalizePem(privateKey) : undefined,
    password: source.BRIDGE_PASSWORD || undefined,
    apiBase: source.EB_API_BASE || EB_API_BASE,
    allowedRedirects: source.EB_REDIRECT_URLS || undefined,
  };
}

/** Accepte une clé PEM brute, avec "\n" échappés, ou encodée en base64. */
export function normalizePem(raw: string): string {
  let key = raw.trim();
  if (!key.includes('-----BEGIN')) {
    try {
      const decoded = Buffer.from(key, 'base64').toString('utf8');
      if (decoded.includes('-----BEGIN')) key = decoded.trim();
    } catch {
      /* ignore */
    }
  }
  return key.replace(/\\n/g, '\n').trim();
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/** JWT exigé par Enable Banking : RS256, kid = application id, durée de vie 1 h. */
export function signJwt(appId: string, privateKeyPem: string, nowMs = Date.now(), ttlSeconds = 3600): string {
  const iat = Math.floor(nowMs / 1000);
  const header = { typ: 'JWT', alg: 'RS256', kid: appId };
  const payload = { iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat, exp: iat + ttlSeconds };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKeyPem);
  return `${signingInput}.${base64url(signature)}`;
}

function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

class BridgeInputError extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const COUNTRY = /^[A-Z]{2}$/;

function str(body: Record<string, unknown>, key: string, re?: RegExp, max = 512): string {
  const v = body[key];
  if (typeof v !== 'string' || v.length === 0 || v.length > max || (re && !re.test(v))) {
    throw new BridgeInputError(`Paramètre invalide : ${key}`);
  }
  return v;
}

function optStr(body: Record<string, unknown>, key: string, re?: RegExp, max = 2048): string | undefined {
  if (body[key] === undefined || body[key] === null || body[key] === '') return undefined;
  return str(body, key, re, max);
}

function isAllowedRedirect(url: string, env: BridgeEnv): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (env.allowedRedirects) {
    return env.allowedRedirects
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .includes(url);
  }
  const local = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  return parsed.protocol === 'https:' || (parsed.protocol === 'http:' && local);
}

interface Upstream {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  body?: unknown;
}

/** Traduit une opération du client en appel Enable Banking (liste fermée). */
export function buildUpstream(op: string, body: Record<string, unknown>, env: BridgeEnv): Upstream {
  switch (op) {
    case 'aspsps': {
      const country = optStr(body, 'country', COUNTRY) ?? 'FR';
      return { method: 'GET', path: `/aspsps?country=${country}&psu_type=personal&service=AIS` };
    }
    case 'startAuth': {
      const aspsp = body.aspsp as Record<string, unknown> | undefined;
      if (!aspsp || typeof aspsp !== 'object') throw new BridgeInputError('Paramètre invalide : aspsp');
      const name = str(aspsp, 'name', undefined, 200);
      const country = str(aspsp, 'country', COUNTRY);
      const redirectUrl = str(body, 'redirectUrl', undefined, 500);
      if (!isAllowedRedirect(redirectUrl, env)) throw new BridgeInputError('URL de retour non autorisée');
      const state = str(body, 'state', /^[A-Za-z0-9_-]{8,128}$/);
      const validUntil = str(body, 'validUntil', /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/);
      return {
        method: 'POST',
        path: '/auth',
        body: {
          access: { valid_until: validUntil, balances: true, transactions: true },
          aspsp: { name, country },
          state,
          redirect_url: redirectUrl,
          psu_type: 'personal',
          language: 'fr',
        },
      };
    }
    case 'createSession':
      return { method: 'POST', path: '/sessions', body: { code: str(body, 'code', /^[A-Za-z0-9._~-]{4,512}$/) } };
    case 'getSession':
      return { method: 'GET', path: `/sessions/${str(body, 'sessionId', UUID)}` };
    case 'deleteSession':
      return { method: 'DELETE', path: `/sessions/${str(body, 'sessionId', UUID)}` };
    case 'details':
      return { method: 'GET', path: `/accounts/${str(body, 'accountUid', UUID)}/details` };
    case 'balances':
      return { method: 'GET', path: `/accounts/${str(body, 'accountUid', UUID)}/balances` };
    case 'transactions': {
      const uid = str(body, 'accountUid', UUID);
      const params = new URLSearchParams();
      const from = optStr(body, 'dateFrom', DATE);
      const to = optStr(body, 'dateTo', DATE);
      const key = optStr(body, 'continuationKey', /^[\x21-\x7e]{1,2048}$/);
      if (from) params.set('date_from', from);
      if (to) params.set('date_to', to);
      if (key) params.set('continuation_key', key);
      const qs = params.toString();
      return { method: 'GET', path: `/accounts/${uid}/transactions${qs ? '?' + qs : ''}` };
    }
    default:
      throw new BridgeInputError(`Opération inconnue : ${op}`);
  }
}

function header(req: BridgeRequest, name: string): string | undefined {
  const v = req.headers[name] ?? req.headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

function reply(status: number, body: unknown): BridgeResponse {
  return { status, body, headers: { ...JSON_HEADERS } };
}

function parseBody(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      throw new BridgeInputError('Corps JSON invalide');
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BridgeInputError('Corps JSON invalide');
  return raw as Record<string, unknown>;
}

export async function handleBridge(req: BridgeRequest, env: BridgeEnv, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<BridgeResponse> {
  if (req.method !== 'POST') return reply(405, { error: 'Méthode non autorisée' });

  let body: Record<string, unknown>;
  try {
    body = parseBody(req.body);
  } catch (e) {
    return reply(400, { error: (e as Error).message });
  }
  const op = typeof body.op === 'string' ? body.op : '';
  const configured = !!(env.appId && env.privateKey && env.password);

  if (!env.password) {
    return reply(503, { error: 'Relais non configuré : variable BRIDGE_PASSWORD manquante.', configured: false });
  }
  const given = header(req, 'x-bridge-password') ?? '';
  const authenticated = given.length > 0 && safeEqual(given, env.password);

  if (op === 'status') {
    return reply(200, { configured, authenticated, appIdSet: !!env.appId, privateKeySet: !!env.privateKey });
  }
  if (!authenticated) {
    await new Promise((r) => setTimeout(r, 400));
    return reply(401, { error: 'Mot de passe du relais incorrect.' });
  }
  // Cours des placements : n'a besoin que du mot de passe, pas de la configuration Enable Banking.
  if (op === 'quotes' || op === 'searchAsset' || op === 'priceHistory') {
    try {
      return reply(200, op === 'quotes' ? await fetchQuotes(body, fetchImpl) : op === 'priceHistory' ? await fetchHistory(body, fetchImpl) : await searchAssets(body, fetchImpl));
    } catch (e) {
      if (e instanceof MarketInputError) return reply(400, { error: e.message });
      return reply(502, { error: 'Service de cours injoignable.' });
    }
  }
  if (!env.appId || !env.privateKey) {
    return reply(503, { error: 'Relais non configuré : EB_APP_ID ou EB_PRIVATE_KEY manquant.', configured: false });
  }

  let upstream: Upstream;
  try {
    upstream = buildUpstream(op, body, env);
  } catch (e) {
    if (e instanceof BridgeInputError) return reply(400, { error: e.message });
    throw e;
  }

  let jwt: string;
  try {
    jwt = signJwt(env.appId, env.privateKey);
  } catch {
    return reply(500, { error: 'Clé privée invalide : impossible de signer le JWT.' });
  }

  const headers: Record<string, string> = { authorization: `Bearer ${jwt}`, accept: 'application/json' };
  if (upstream.body !== undefined) headers['content-type'] = 'application/json';
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(`${env.apiBase ?? EB_API_BASE}${upstream.path}`, {
      method: upstream.method,
      headers,
      body: upstream.body !== undefined ? JSON.stringify(upstream.body) : undefined,
    });
  } catch {
    return reply(502, { error: 'Enable Banking injoignable.' });
  }
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: 'Réponse non JSON d’Enable Banking.' };
    }
  }
  if (!res.ok) {
    const d = (data ?? {}) as Record<string, unknown>;
    const message = typeof d.message === 'string' ? d.message : `Erreur Enable Banking (${res.status})`;
    return reply(res.status, {
      error: /application is not active/i.test(message)
        ? 'Application Enable Banking pas encore activée : sur enablebanking.com → Applications → ton application → « Link accounts », puis lie ta banque.'
        : message,
      code: typeof d.error === 'string' ? d.error : undefined,
      detail: d.detail,
    });
  }
  return reply(200, data ?? {});
}

/** Lit un corps JSON depuis un flux Node (IncomingMessage). Limité à 64 Ko. */
export async function readRawBody(stream: AsyncIterable<Buffer | string>, limit = 64 * 1024): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    size += buf.length;
    if (size > limit) throw new BridgeInputError('Requête trop volumineuse');
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}
