import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handle } from '../server/http';
import { BODY_LIMITS, bodyLimit } from '../server/limits';
import { startLocalServer, type LocalServer } from '../server/local';

/** Une requête Vercel factice : lire `body` alors qu'il fallait refuser avant fait échouer le test. */
function call(url: string, headers: Record<string, string>, body: unknown, { trap = false } = {}) {
  let status = 0;
  let out: unknown = null;
  let read = false;
  const req = { method: 'POST', url, headers } as unknown as IncomingMessage & { body?: unknown };
  Object.defineProperty(req, 'body', {
    get: () => {
      read = true;
      if (trap) throw new Error('corps lu alors qu’il fallait le refuser avant');
      return body;
    },
  });
  const res = {
    statusCode: 0,
    setHeader: () => undefined,
    end: (s: string) => {
      status = res.statusCode;
      out = JSON.parse(s);
    },
  } as unknown as ServerResponse & { statusCode: number };
  return handle(req, res, async (b) => ({ echo: Object.keys(b) })).then(() => ({ status, out, read }));
}
const json = (n: number) => ({ 'content-type': 'application/json', 'content-length': String(n) });

describe('taille et type du corps des requêtes', () => {
  it('limites par point d’entrée : petites pour le compte, les notifications et le support ; celle de l’hébergeur ailleurs', () => {
    expect(bodyLimit('/api/auth')).toBe(BODY_LIMITS.small);
    expect(bodyLimit('/api/push?x=1')).toBe(BODY_LIMITS.small);
    expect(bodyLimit('/api/support/')).toBe(BODY_LIMITS.small);
    expect(bodyLimit('/api/sync')).toBe(BODY_LIMITS.large);
    expect(bodyLimit('/api/space')).toBe(BODY_LIMITS.large);
    expect(bodyLimit('/api/raveloc')).toBe(BODY_LIMITS.large);
  });

  it('en ligne (Vercel) : trop gros ou pas du JSON, refusé sans même lire le corps ; un corps normal passe', async () => {
    expect(await call('/api/auth', json(BODY_LIMITS.small + 1), {}, { trap: true })).toMatchObject({ status: 413, read: false });
    expect(await call('/api/sync', json(BODY_LIMITS.large + 1), {}, { trap: true })).toMatchObject({ status: 413, read: false });
    expect(await call('/api/auth', { 'content-type': 'text/plain', 'content-length': '2' }, {}, { trap: true })).toMatchObject({ status: 415, read: false });
    expect(await call('/api/auth', { 'content-length': '2' }, {}, { trap: true })).toMatchObject({ status: 415, read: false });
    // Sans taille annoncée, un corps resté en texte est mesuré avant d'être analysé.
    expect(await call('/api/auth', { 'content-type': 'application/json' }, `{"a":"${'x'.repeat(BODY_LIMITS.small)}"}`)).toMatchObject({ status: 413 });
    expect(await call('/api/sync', json(60_000), { action: 'status', app: 'finances' })).toMatchObject({ status: 200, out: { echo: ['action', 'app'] } });
    expect(await call('/api/auth', { 'content-type': 'application/json; charset=utf-8' }, '{"action":"salt"}')).toMatchObject({ status: 200 });
  });

  describe('serveur local (auto-hébergement) : mêmes règles, lecture arrêtée dès la limite', () => {
    let srv: LocalServer;
    beforeAll(async () => {
      srv = await startLocalServer({ port: 4391 });
    });
    afterAll(() => srv.close());
    const post = (path: string, body: BodyInit, headers: Record<string, string> = { 'content-type': 'application/json' }, init: RequestInit = {}) =>
      fetch(`${srv.url}${path}`, { method: 'POST', headers, body, ...init });

    it('JSON normal accepté ; trop gros, pas du JSON, mal formé : refusés avec un statut clair', async () => {
      expect((await post('/api/auth', JSON.stringify({ action: 'salt', login: 'personne' }))).status).toBe(200);
      expect((await post('/api/auth', JSON.stringify({ action: 'salt', login: 'x'.repeat(BODY_LIMITS.small) }))).status).toBe(413);
      expect((await post('/api/auth', 'action=salt', { 'content-type': 'application/x-www-form-urlencoded' })).status).toBe(415);
      expect((await post('/api/auth', '{pas du json')).status).toBe(400);
      expect((await post('/api/auth', '[1,2]')).status).toBe(400);
    });

    it('envoi en flux, sans taille annoncée : la lecture s’arrête à la limite', async () => {
      const chunk = new TextEncoder().encode('x'.repeat(16 * 1024));
      let sent = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(c) {
          if (sent > BODY_LIMITS.small * 4) return c.close();
          sent += chunk.length;
          c.enqueue(chunk);
        },
      });
      const res = await post('/api/auth', stream, { 'content-type': 'application/json' }, { duplex: 'half' } as RequestInit);
      expect(res.status).toBe(413);
    });
  });
});
