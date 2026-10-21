import { createHmac } from 'node:crypto';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { buildUpstream, handleBridge, loadBridgeEnv, normalizePem, openCredentials, sealCredentials, signJwt, type BridgeEnv } from '../server/bridge';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const APP = 'cf589be3-3755-465b-a8df-a90a16a31403';
const UID = '07cc67f4-45d6-494b-adac-09b5cbc7e2b5';

const env: BridgeEnv = { appId: APP, privateKey: pem, password: 'secret-123', apiBase: 'https://eb.test' };

function decode(part: string) {
  return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
}

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () => ({ status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body) }));
}

const req = (body: unknown, password = 'secret-123') => ({ method: 'POST', headers: { 'x-bridge-password': password }, body });

describe('signJwt', () => {
  it('produit un JWT RS256 conforme à Enable Banking', () => {
    const now = Date.UTC(2026, 9, 17, 12);
    const jwt = signJwt(APP, pem, now);
    const [h, p, s] = jwt.split('.');
    expect(decode(h)).toEqual({ typ: 'JWT', alg: 'RS256', kid: APP });
    const payload = decode(p);
    expect(payload).toMatchObject({ iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: now / 1000 });
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(86400);
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${h}.${p}`);
    expect(verifier.verify(publicKey, Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'))).toBe(true);
  });
});

describe('configuration', () => {
  it('accepte une clé avec \\n échappés ou en base64', () => {
    const escaped = pem.replace(/\n/g, '\\n');
    expect(normalizePem(escaped)).toBe(pem.trim());
    expect(normalizePem(Buffer.from(pem).toString('base64'))).toBe(pem.trim());
  });
  it('lit les variables d’environnement', () => {
    const e = loadBridgeEnv({ EB_APP_ID: APP, EB_PRIVATE_KEY: pem, BRIDGE_PASSWORD: 'x' });
    expect(e.appId).toBe(APP);
    expect(e.apiBase).toBe('https://api.enablebanking.com');
  });
});

describe('handleBridge', () => {
  it('refuse sans mot de passe configuré', async () => {
    const out = await handleBridge(req({ op: 'aspsps' }), { ...env, password: undefined });
    expect(out.status).toBe(503);
  });

  it('refuse un mauvais mot de passe', async () => {
    const f = mockFetch(200, {});
    const out = await handleBridge(req({ op: 'aspsps' }, 'nope'), env, f);
    expect(out.status).toBe(401);
    expect(f).not.toHaveBeenCalled();
  });

  it('status indique la configuration sans rien révéler', async () => {
    const out = await handleBridge(req({ op: 'status' }, 'nope'), env);
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ configured: true, authenticated: false, appIdSet: true, privateKeySet: true, ownCredentials: false });
    expect(JSON.stringify(out.body)).not.toContain('BEGIN');
  });

  it('refuse les autres méthodes que POST', async () => {
    const out = await handleBridge({ method: 'GET', headers: {}, body: null }, env);
    expect(out.status).toBe(405);
  });

  it('relaie les transactions avec le JWT', async () => {
    const f = mockFetch(200, { transactions: [], continuation_key: null });
    const out = await handleBridge(req(JSON.stringify({ op: 'transactions', accountUid: UID, dateFrom: '2026-09-01' })), env, f);
    expect(out.status).toBe(200);
    expect(out.headers['cache-control']).toBe('no-store');
    const [url, init] = f.mock.calls[0] as unknown as [string, { method: string; headers: Record<string, string> }];
    expect(url).toBe(`https://eb.test/accounts/${UID}/transactions?date_from=2026-09-01`);
    expect(init.method).toBe('GET');
    expect(init.headers.authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  });

  it('traduit les erreurs Enable Banking', async () => {
    const f = mockFetch(422, { message: 'Session expired', error: 'EXPIRED_SESSION' });
    const out = await handleBridge(req({ op: 'balances', accountUid: UID }), env, f);
    expect(out.status).toBe(422);
    expect(out.body).toMatchObject({ error: 'Session expired', code: 'EXPIRED_SESSION' });
  });

  it('adresse de retour inconnue d’Enable Banking : dit laquelle ajouter', async () => {
    const f = mockFetch(422, { message: 'Redirect URI not allowed', error: 'REDIRECT_URI_NOT_ALLOWED' });
    const out = await handleBridge(
      req({ op: 'startAuth', aspsp: { name: 'Revolut', country: 'FR' }, redirectUrl: 'https://budget.example/finances/connexion/retour', state: 's_abcdef123', validUntil: '2026-12-01T00:00:00Z' }),
      env,
      f,
    );
    expect((out.body as { error: string }).error).toContain('Redirect URLs », ajoute https://budget.example/finances/connexion/retour');
  });

  it('explique quoi faire quand l’application Enable Banking n’est pas activée', async () => {
    const f = mockFetch(403, { message: 'Application is not active' });
    const out = await handleBridge(req({ op: 'aspsps', country: 'FR' }), env, f);
    expect((out.body as { error: string }).error).toMatch(/Link accounts/);
  });

  it('rejette les paramètres invalides (injection de chemin)', async () => {
    const f = mockFetch(200, {});
    const out = await handleBridge(req({ op: 'balances', accountUid: '../../application' }), env, f);
    expect(out.status).toBe(400);
    const out2 = await handleBridge(req({ op: 'whatever' }), env, f);
    expect(out2.status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });
});

describe('buildUpstream', () => {
  it('startAuth demande soldes + transactions en mode particulier', () => {
    const u = buildUpstream(
      'startAuth',
      {
        aspsp: { name: 'BNP Paribas', country: 'FR' },
        redirectUrl: 'https://budget.example/connexion/retour',
        state: 'abcdef1234567890',
        validUntil: '2027-04-15T10:00:00.000Z',
      },
      env,
    );
    expect(u).toMatchObject({ method: 'POST', path: '/auth' });
    expect(u.body).toMatchObject({ psu_type: 'personal', access: { balances: true, transactions: true }, aspsp: { name: 'BNP Paribas', country: 'FR' } });
  });

  it('refuse une URL de retour non HTTPS', () => {
    const body = { aspsp: { name: 'Revolut', country: 'FR' }, redirectUrl: 'http://evil.example/', state: 'abcdef1234567890', validUntil: '2027-04-15T10:00:00Z' };
    expect(() => buildUpstream('startAuth', body, env)).toThrow();
    expect(() => buildUpstream('startAuth', { ...body, redirectUrl: 'http://localhost:5173/connexion/retour' }, env)).not.toThrow();
  });

  it('respecte la liste blanche EB_REDIRECT_URLS', () => {
    const e = { ...env, allowedRedirects: 'https://a.example/connexion/retour' };
    const body = { aspsp: { name: 'Revolut', country: 'FR' }, state: 'abcdef1234567890', validUntil: '2027-04-15T10:00:00Z' };
    expect(() => buildUpstream('startAuth', { ...body, redirectUrl: 'https://b.example/connexion/retour' }, e)).toThrow();
    expect(() => buildUpstream('startAuth', { ...body, redirectUrl: 'https://a.example/connexion/retour' }, e)).not.toThrow();
  });

  it('pagination', () => {
    const u = buildUpstream('transactions', { accountUid: UID, continuationKey: 'abc==' }, env);
    expect(u.path).toBe(`/accounts/${UID}/transactions?continuation_key=abc%3D%3D`);
  });
});

describe('accès au relais avec un compte MyLife', () => {
  const secret = 's'.repeat(40);
  const token = (uid: string, exp: number, key = secret) => {
    const payload = Buffer.from(JSON.stringify({ uid, exp })).toString('base64url');
    return `${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}`;
  };
  const withSession = { ...env, sessionSecret: secret };
  const reqToken = (body: unknown, t: string) => ({ method: 'POST', headers: { authorization: `Bearer ${t}` }, body });

  it('une session valide remplace le mot de passe', async () => {
    const out = await handleBridge(reqToken({ op: 'status' }, token('u1', Date.now() + 60_000)), withSession);
    expect(out.body).toMatchObject({ authenticated: true });
  });

  it('session expirée, falsifiée ou d’un autre serveur : refusée', async () => {
    for (const t of [token('u1', Date.now() - 1), token('u1', Date.now() + 60_000, 'x'.repeat(40)), 'abc.def', '']) {
      const out = await handleBridge(reqToken({ op: 'status' }, t), withSession);
      expect(out.body).toMatchObject({ authenticated: false });
    }
  });

  it('relais sans mot de passe mais avec sessions : configuré', async () => {
    const out = await handleBridge(reqToken({ op: 'status' }, token('u1', Date.now() + 60_000)), { ...withSession, password: undefined });
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ configured: true, authenticated: true });
  });

  describe('application Enable Banking propre au compte', () => {
    const OWN_APP = '11111111-2222-4333-8444-555555555555';
    const own = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const reqOwn = (body: unknown, t: string, sealed: string) => ({ method: 'POST', headers: { authorization: `Bearer ${t}`, 'x-eb-credentials': sealed }, body });

    it('scellé pour un compte, illisible pour un autre ou avec un autre secret', () => {
      const sealed = sealCredentials('u1', { appId: OWN_APP, privateKey: own }, secret);
      expect(sealed).not.toContain('PRIVATE');
      expect(openCredentials(sealed, 'u1', secret)).toEqual({ appId: OWN_APP, privateKey: own });
      expect(openCredentials(sealed, 'u2', secret)).toBeNull();
      expect(openCredentials(sealed, 'u1', 'y'.repeat(40))).toBeNull();
      expect(openCredentials(sealed.slice(0, -4) + 'AAAA', 'u1', secret)).toBeNull();
    });

    it('sealCredentials vérifie le couple auprès d’Enable Banking puis le scelle', async () => {
      const f = mockFetch(200, { name: 'Appli de Léa' });
      const out = await handleBridge(reqToken({ op: 'sealCredentials', appId: OWN_APP, privateKey: own }, token('u1', Date.now() + 60_000)), withSession, f);
      expect(out.status).toBe(200);
      const { sealed, name } = out.body as { sealed: string; name: string };
      expect(name).toBe('Appli de Léa');
      expect(openCredentials(sealed, 'u1', secret)?.appId).toBe(OWN_APP);
      const [url, init] = f.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
      expect(url).toBe('https://eb.test/application');
      expect(decode(init.headers.authorization!.split(' ')[1]!.split('.')[0]!).kid).toBe(OWN_APP);
    });

    it('refuse sans session, avec une clé illisible ou un couple refusé', async () => {
      expect((await handleBridge(req({ op: 'sealCredentials', appId: OWN_APP, privateKey: own }), withSession)).status).toBe(401);
      expect((await handleBridge(reqToken({ op: 'sealCredentials', appId: OWN_APP, privateKey: 'pas une clé' }, token('u1', Date.now() + 60_000)), withSession)).status).toBe(400);
      expect((await handleBridge(reqToken({ op: 'sealCredentials', appId: OWN_APP, privateKey: own }, token('u1', Date.now() + 60_000)), withSession, mockFetch(401, {}))).status).toBe(400);
    });

    it('les appels bancaires signent avec l’application du compte', async () => {
      const sealed = sealCredentials('u1', { appId: OWN_APP, privateKey: own }, secret);
      const f = mockFetch(200, { aspsps: [] });
      await handleBridge(reqOwn({ op: 'aspsps', country: 'FR' }, token('u1', Date.now() + 60_000), sealed), withSession, f);
      const [, init] = f.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
      expect(decode(init.headers.authorization!.split(' ')[1]!.split('.')[0]!).kid).toBe(OWN_APP);
      const status = await handleBridge(reqOwn({ op: 'status' }, token('u1', Date.now() + 60_000), sealed), withSession);
      expect(status.body).toMatchObject({ ownCredentials: true });
    });

    it('un bloc d’un autre compte est refusé', async () => {
      const sealed = sealCredentials('u2', { appId: OWN_APP, privateKey: own }, secret);
      const out = await handleBridge(reqOwn({ op: 'aspsps', country: 'FR' }, token('u1', Date.now() + 60_000), sealed), withSession, mockFetch(200, {}));
      expect(out.status).toBe(400);
      expect(out.body).toMatchObject({ code: 'CREDENTIALS' });
    });
  });
});
