import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import * as core from '../server/core';
import { pushDispatch, sendWakeups, sendWeekly, type PushEnv, type PushSender } from '../server/push';
import { addEntry, emptyMiniApp, MINI_TEMPLATES, setMiniReminder } from '../packages/lumen/src/miniapp';
import { miniAppReminders, wakeupMinutes, type PlannedReminder } from '../web/src/reminders';

/** Rappels écrits par l'appareil (V4, F2) : le serveur ne connaît que des heures de réveil et envoie un signal vide. */
const secret = 'x'.repeat(40);
const env: PushEnv = { publicKey: 'BPub', privateKey: 'priv', subject: 'https://exemple.test' };
const token = (uid: string) => core.signToken(uid, secret);
const sub = (n: number, weekly?: boolean) => ({ action: 'subscribe', endpoint: `https://push.exemple.test/abonnement-${n}`, keys: { p256dh: 'p'.repeat(20), auth: 'a'.repeat(16) }, ...(weekly === undefined ? {} : { weekly }) });
const db = async () => {
  const p = new PGlite();
  await core.ensureSchema(p as unknown as core.Db);
  return p as unknown as core.Db;
};
const at = (hhmm: string) => Date.parse(`2026-10-24T${hhmm}:00Z`);

describe('serveur : heures de réveil et signal vide', () => {
  it('l’appareil donne ses heures (pas de texte) ; seul son compte peut les changer ; 48 au plus', async () => {
    const d = await db();
    await pushDispatch(d, secret, token('u1'), sub(1, false), env);
    const set = (uid: string, minutes: unknown) => pushDispatch(d, secret, token(uid), { action: 'wakeups', endpoint: sub(1).endpoint, minutes }, env);
    await expect(set('u1', [1140, 1140, 420])).resolves.toEqual({ ok: true, count: 2 });
    await expect(set('u2', [600])).rejects.toMatchObject({ status: 404 });
    await expect(set('u1', [1440])).resolves.toEqual({ ok: true, count: 0 });
    await expect(set('u1', Array.from({ length: 49 }, (_, i) => i))).rejects.toMatchObject({ status: 400 });
    await expect(set('u1', 'tous les soirs')).rejects.toMatchObject({ status: 400 });
    const cols = await d.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'push_wakeups' ORDER BY column_name");
    expect(cols.rows.map((r) => r.column_name)).toEqual(['endpoint', 'minute']);
  }, 30_000);

  it('au réveil : un signal vide aux seuls appareils concernés, minuit compris ; un abonné « rappels seulement » n’a pas le dimanche', async () => {
    const d = await db();
    await pushDispatch(d, secret, token('u1'), sub(1, false), env);
    await pushDispatch(d, secret, token('u2'), sub(2), env);
    await pushDispatch(d, secret, token('u1'), { action: 'wakeups', endpoint: sub(1).endpoint, minutes: [19 * 60, 0] }, env);
    await pushDispatch(d, secret, token('u2'), { action: 'wakeups', endpoint: sub(2).endpoint, minutes: [7 * 60] }, env);
    const got: [string, string][] = [];
    const send: PushSender = async (s, payload) => {
      got.push([s.endpoint.slice(-1), payload]);
      return { statusCode: 201 };
    };
    await sendWakeups(d, send, at('18:50'));
    expect(await sendWakeups(d, send, at('19:05'))).toEqual({ sent: 1, removed: 0, failed: 0 });
    expect(got).toEqual([['1', '{"type":"wake"}']]);
    got.length = 0;
    // Passage suivant juste après minuit : la minute 0 est prise.
    await sendWakeups(d, send, at('23:50'));
    await sendWakeups(d, send, Date.parse('2026-10-25T00:04:00Z'));
    expect(got.map((g) => g[0])).toEqual(['1']);
    // Le dimanche ne part qu'à l'abonné qui l'a voulu.
    got.length = 0;
    await sendWeekly(d, send);
    expect(got.map((g) => g[0])).toEqual(['2']);
    // Désabonné : ses heures disparaissent avec lui.
    await pushDispatch(d, secret, token('u1'), { action: 'unsubscribe', endpoint: sub(1).endpoint }, env);
    expect((await d.query('SELECT 1 FROM push_wakeups')).rows).toHaveLength(1);
  }, 30_000);
});

describe('appareil : le plan des rappels', () => {
  const lecture = MINI_TEMPLATES[0]!;
  it('une app avec un rappel ; pas le jour où elle a déjà une saisie ; heures de réveil en UTC', () => {
    const a = setMiniReminder(emptyMiniApp('lect01', lecture), { minute: 21 * 60, days: 0b0011111 });
    const b = addEntry(setMiniReminder(emptyMiniApp('lect02', lecture), { minute: 7 * 60 + 30, days: 0b1111111 }), { id: 'x', day: '2026-10-24', values: { pages: 3 } });
    const plan = miniAppReminders([a, b, emptyMiniApp('lect03', lecture)], '2026-10-24');
    expect(plan.map((r) => [r.id, r.minute, r.days, r.skip])).toEqual([
      ['miniapp:lect01', 1260, 31, []],
      ['miniapp:lect02', 450, 127, ['2026-10-24']],
    ]);
    expect(plan[0]!.title).toBe(lecture.name);
    // Paris en été (UTC+2 : décalage −120) : 21 h → 19 h UTC, 7 h 30 → 5 h 30 UTC ; et l'autre sens autour de minuit.
    expect(wakeupMinutes(plan, -120)).toEqual([330, 1140]);
    expect(wakeupMinutes([{ ...plan[0]!, minute: 30 }], -120)).toEqual([1350]);
  });
});

describe('service worker : il écrit lui-même le rappel du moment', () => {
  /** Exécute push-sw.js avec un faux navigateur : une base locale en mémoire, des notifications notées. */
  function worker(plan: PlannedReminder[], now: string) {
    const store = new Map<string, unknown>([['plan', plan]]);
    const shown: { title: string; body: string; tag: string }[] = [];
    const handlers: Record<string, (e: unknown) => void> = {};
    const request = (result: unknown) => {
      const r: Record<string, unknown> = { result };
      queueMicrotask(() => (r.onsuccess as () => void)?.());
      return r;
    };
    const db = {
      transaction: () => {
        const tx: Record<string, unknown> = {
          objectStore: () => ({ get: (k: string) => request(store.get(k)), put: (v: unknown, k: string) => (store.set(k, v), queueMicrotask(() => (tx.oncomplete as () => void)?.())) }),
        };
        return tx;
      },
      close: () => {},
    };
    const RealDate = Date;
    const FakeDate = class extends RealDate {
      // Sans argument : l'heure figée du test ; sinon comme Date.
      constructor(value?: string | number) {
        super(value ?? now);
      }
    };
    runInNewContext(readFileSync(new URL('../web/public/push-sw.js', import.meta.url), 'utf8'), {
      self: { addEventListener: (t: string, fn: (e: unknown) => void) => (handlers[t] = fn), registration: { showNotification: async (title: string, o: { body: string; tag: string }) => void shown.push({ title, body: o.body, tag: o.tag }) } },
      indexedDB: { open: () => request(db) },
      Date: FakeDate,
      queueMicrotask,
      Promise,
      String,
    });
    const push = async (data: unknown) => {
      let done: Promise<unknown> = Promise.resolve();
      handlers.push!({ data: { json: () => data }, waitUntil: (p: Promise<unknown>) => (done = p) });
      await done;
    };
    return { push, shown, store };
  }
  const plan: PlannedReminder[] = [
    { id: 'miniapp:a', title: 'Lecture', body: 'Pense à noter ta saisie du jour.', url: '/mes-apps/a', minute: 21 * 60, days: 0b1111111, skip: [] },
    { id: 'miniapp:b', title: 'Eau', body: 'Pense à noter ta saisie du jour.', url: '/mes-apps/b', minute: 21 * 60, days: 0b1111111, skip: ['2026-10-24'] },
    { id: 'miniapp:c', title: 'Sport', body: 'x', url: '/', minute: 21 * 60, days: 0b0011111, skip: [] },
    { id: 'miniapp:d', title: 'Méditation', body: 'x', url: '/', minute: 8 * 60, days: 0b1111111, skip: [] },
  ];

  it('signal vide : seulement les rappels du moment, du bon jour, pas déjà faits, une seule fois par jour', async () => {
    // Samedi 24 octobre, 21 h 03 (heure de la machine de test).
    const w = worker(plan, '2026-10-24T21:03:00');
    await w.push({ type: 'wake' });
    expect(w.shown.map((n) => n.title)).toEqual(['Lecture']);
    await w.push({ type: 'wake' });
    expect(w.shown).toHaveLength(1);
  });

  it('le message du dimanche reste générique', async () => {
    const w = worker([], '2026-10-25T17:00:00');
    await w.push({ title: 'Ta semaine est bouclée', body: 'Ton bilan t’attend', url: '/bilan' });
    expect(w.shown).toEqual([{ title: 'Ta semaine est bouclée', body: 'Ton bilan t’attend', tag: 'mylife-weekly' }]);
  });
});
