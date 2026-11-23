import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import * as core from '../server/core';
import { seedUsers } from './seedUsers';
import { MAX_REST_MS, pushDispatch, type PushEnv, type PushSender, type RestRuntime } from '../server/push';

/**
 * Fin de repos (MyPerf, écran en veille) : le serveur ne reçoit qu'une heure de fin, l'annulation au retour sur l'app, et
 * envoie un signal `{ type: 'rest' }` à l'heure dite ; par tranches et relances sur une plateforme à fonctions courtes.
 * Le texte est écrit par le service worker de l'accueil.
 */
const secret = 'x'.repeat(40);
const env: PushEnv = { publicKey: 'BPub', privateKey: 'priv', subject: 'https://exemple.test' };
const token = (uid: string) => core.signToken(uid, secret);
const endpoint = 'https://push.exemple.test/abonnement-1';
const sub = { action: 'subscribe', endpoint, keys: { p256dh: 'p'.repeat(20), auth: 'a'.repeat(16) }, weekly: false };
const T0 = Date.parse('2026-11-23T18:00:00Z');

async function setup() {
  const p = new PGlite();
  await seedUsers(p as unknown as core.Db, 'u1', 'u2');
  const db = p as unknown as core.Db;
  await pushDispatch(db, secret, token('u1'), sub, env, T0);
  return db;
}

/** Une plateforme simulée : horloge et sommeil factices, tâches attendues à la demande, envois notés. */
function runtime(limitMs = Infinity) {
  let clock = T0;
  const tasks: Promise<unknown>[] = [];
  const sent: string[] = [];
  const relays: { at: number; token: string }[] = [];
  const send: PushSender = async (_s, payload) => {
    sent.push(payload);
    return { statusCode: 201 };
  };
  const rt: RestRuntime = {
    wait: (t) => void tasks.push(t),
    limitMs,
    relay: null,
    send,
    now: () => clock,
    sleep: async (ms) => {
      await new Promise((r) => setTimeout(r, 0));
      clock += ms;
    },
  };
  const settle = async () => {
    while (tasks.length) await tasks.shift();
  };
  return { rt, sent, relays, settle, at: () => clock, set: (t: number) => (clock = t) };
}

describe('fin de repos : une heure, un signal', () => {
  it('à l’heure dite, un signal vide ; seul le compte de l’appareil ; une heure bornée', async () => {
    const db = await setup();
    const r = runtime();
    const rest = (uid: string, at: unknown) => pushDispatch(db, secret, token(uid), { action: 'rest', endpoint, at }, env, T0, r.rt);
    await expect(rest('u2', T0 + 90_000)).rejects.toMatchObject({ status: 404 });
    await expect(rest('u1', T0 - 1)).rejects.toMatchObject({ status: 400 });
    await expect(rest('u1', T0 + MAX_REST_MS + 1)).rejects.toMatchObject({ status: 400 });
    await expect(rest('u1', 'bientôt')).rejects.toMatchObject({ status: 400 });
    await expect(rest('u1', T0 + 90_000)).resolves.toEqual({ ok: true });
    const cols = await db.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'push_rest' ORDER BY column_name");
    expect(cols.rows.map((c) => c.column_name)).toEqual(['at', 'endpoint', 'token']);
    await r.settle();
    expect(r.sent).toEqual(['{"type":"rest"}']);
    expect(r.at()).toBe(T0 + 90_000);
    expect((await db.query('SELECT 1 FROM push_rest')).rows).toHaveLength(0);
  }, 30_000);

  it('annulé au retour sur l’app, ou remplacé par un autre repos : un seul signal, le bon', async () => {
    const db = await setup();
    const r = runtime();
    const rest = (at: number | null) => pushDispatch(db, secret, token('u1'), { action: 'rest', endpoint, at }, env, T0, r.rt);
    await rest(T0 + 60_000);
    await rest(null);
    await r.settle();
    expect(r.sent).toEqual([]);
    r.set(T0);
    await rest(T0 + 60_000);
    await rest(T0 + 120_000);
    await r.settle();
    expect(r.sent).toEqual(['{"type":"rest"}']);
  }, 30_000);

  it('fonctions courtes : attente par tranches, relance avec le même repos ; une relance périmée ne fait rien', async () => {
    const db = await setup();
    const r = runtime(270_000);
    r.rt.relay = async (resume) => {
      r.relays.push({ at: resume.at, token: resume.token });
      await pushDispatch(db, secret, token('u1'), { action: 'rest', endpoint, at: resume.at, resume: resume.token }, env, r.at(), r.rt);
    };
    await pushDispatch(db, secret, token('u1'), { action: 'rest', endpoint, at: T0 + 330_000 }, env, T0, r.rt);
    await r.settle();
    expect(r.relays).toHaveLength(1);
    expect(r.sent).toEqual(['{"type":"rest"}']);
    expect(r.at()).toBe(T0 + 330_000);
    await expect(pushDispatch(db, secret, token('u1'), { action: 'rest', endpoint, at: T0 + 400_000, resume: 'ancien' }, env, T0 + 330_000, r.rt)).resolves.toEqual({ ok: true, stale: true });
    await r.settle();
    expect(r.sent).toHaveLength(1);
  }, 30_000);
});

describe('service worker de l’accueil : le signal de fin de repos', () => {
  function worker(visible: boolean) {
    const handlers: Record<string, (e: unknown) => void> = {};
    const shown: { title: string; body: string; tag: string; url: string }[] = [];
    runInNewContext(readFileSync(new URL('../app/public/push-sw.js', import.meta.url), 'utf8'), {
      self: {
        addEventListener: (t: string, fn: (e: unknown) => void) => (handlers[t] = fn),
        registration: { showNotification: async (title: string, o: { body: string; tag: string; data: { url: string } }) => void shown.push({ title, body: o.body, tag: o.tag, url: o.data.url }) },
        clients: { matchAll: async () => (visible ? [{ visibilityState: 'visible', focused: true, url: 'https://exemple.test/sport/seance' }] : []) },
      },
      Promise,
      String,
    });
    const push = async (data: unknown) => {
      let done: Promise<unknown> = Promise.resolve();
      handlers.push!({ data: { json: () => data }, waitUntil: (p: Promise<unknown>) => (done = p) });
      await done;
    };
    return { push, shown };
  }

  it('écran en veille : « Repos terminé », qui rouvre la séance ; séance à l’écran : rien (le bip suffit)', async () => {
    const w = worker(false);
    await w.push({ type: 'rest' });
    expect(w.shown).toEqual([{ title: 'Repos terminé', body: 'À toi : la série suivante.', tag: 'mylife-rest', url: '/sport/seance' }]);
    const v = worker(true);
    await v.push({ type: 'rest' });
    expect(v.shown).toEqual([]);
  });
});

describe('appareil : l’heure de fin part à la mise en veille, annulée au retour', () => {
  it('abonné sans le rappel du dimanche ; veille pendant un repos → l’heure ; retour → annulation ; désactivé → rien', async () => {
    const { vi } = await import('vitest');
    const store = new Map<string, string>();
    const calls: Record<string, unknown>[] = [];
    const sent: { at: unknown; keepalive: unknown; auth: unknown }[] = [];
    const listeners: Record<string, () => void> = {};
    const doc = { visibilityState: 'visible', addEventListener: (t: string, fn: () => void) => (listeners[t] = fn) };
    const sub = { endpoint: 'https://push.exemple.test/abonnement-9', toJSON: () => ({ endpoint: 'https://push.exemple.test/abonnement-9', keys: { p256dh: 'p'.repeat(20), auth: 'a'.repeat(16) } }) };
    const reg = { pushManager: { getSubscription: async () => null, subscribe: async () => sub } };
    const Notif = Object.assign(class {}, { permission: 'granted', requestPermission: async () => 'granted' });
    vi.stubGlobal('window', { PushManager: class {}, Notification: Notif });
    vi.stubGlobal('navigator', { serviceWorker: { ready: Promise.resolve(reg), getRegistration: async () => reg } });
    vi.stubGlobal('Notification', Notif);
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
    vi.stubGlobal('document', doc);
    vi.stubGlobal('fetch', async (_url: string, o: { body: string; keepalive: boolean; headers: Record<string, string> }) => {
      sent.push({ at: (JSON.parse(o.body) as { at: unknown }).at, keepalive: o.keepalive, auth: o.headers.authorization });
      return new Response('{}');
    });
    vi.doMock('@mylife/core/web', () => ({
      currentSession: () => ({ token: 'jeton' }),
      webPlatform: { api: { call: async (_p: string, body: Record<string, unknown>) => (calls.push(body), body.action === 'key' ? { publicKey: 'BPub' } : { ok: true }) } },
    }));
    try {
      const push = await import('../app/src/modules/perf/session/restPush');
      const timers = await import('../app/src/modules/perf/session/timers');
      expect(push.restPushOn()).toBe(false);
      await push.enableRestPush();
      expect(push.restPushOn()).toBe(true);
      expect(calls.find((c) => c.action === 'subscribe')).toMatchObject({ endpoint: sub.endpoint, weekly: false });
      timers.watchVisibility();
      // Veille sans repos : rien.
      doc.visibilityState = 'hidden';
      listeners.visibilitychange!();
      expect(sent).toEqual([]);
      timers.startRest(180, 'série 2');
      listeners.visibilitychange!();
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ keepalive: true, auth: 'Bearer jeton' });
      expect(Math.abs((sent[0]!.at as number) - (Date.now() + 180_000))).toBeLessThan(1000);
      doc.visibilityState = 'visible';
      listeners.visibilitychange!();
      expect(sent[1]!.at).toBeNull();
      // Un second retour n'annule pas deux fois.
      listeners.visibilitychange!();
      expect(sent).toHaveLength(2);
      push.disableRestPush();
      doc.visibilityState = 'hidden';
      listeners.visibilitychange!();
      expect(sent).toHaveLength(2);
      timers.skipRest();
    } finally {
      vi.doUnmock('@mylife/core/web');
      vi.unstubAllGlobals();
    }
  });
});
