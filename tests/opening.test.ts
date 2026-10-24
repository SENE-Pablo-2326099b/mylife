import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import * as core from '../server/core';
import { pushDispatch, sendWeekly, type PushEnv, type PushSender } from '../server/push';
import { supportDispatch } from '../server/support';

/** Ouverture au public : support (« Un problème, une idée ? ») et rappel du dimanche (Web Push). */

const secret = 'x'.repeat(40);
const db = async () => {
  const p = new PGlite();
  await core.ensureSchema(p as unknown as core.Db);
  return p as unknown as core.Db;
};
const token = (uid: string) => core.signToken(uid, secret);

describe('support', () => {
  it('message lié au compte ; type et longueur vérifiés ; 5 par jour', async () => {
    const d = await db();
    await expect(supportDispatch(d, secret, undefined, { action: 'send', kind: 'bug', message: 'Ça plante' })).rejects.toMatchObject({ status: 401 });
    await expect(supportDispatch(d, secret, token('u1'), { action: 'send', kind: 'spam', message: 'Ça plante' })).rejects.toMatchObject({ status: 400 });
    await expect(supportDispatch(d, secret, token('u1'), { action: 'send', kind: 'bug', message: ' a ' })).rejects.toMatchObject({ status: 400 });
    await expect(supportDispatch(d, secret, token('u1'), { action: 'send', kind: 'bug', message: 'x'.repeat(2001) })).rejects.toMatchObject({ status: 400 });
    for (let i = 0; i < 5; i++) await supportDispatch(d, secret, token('u1'), { action: 'send', kind: 'idee', message: `Idée ${i}`, app: 'perf' });
    await expect(supportDispatch(d, secret, token('u1'), { action: 'send', kind: 'idee', message: 'Une de trop' })).rejects.toMatchObject({ status: 429 });
    // Un autre compte n'est pas freiné par le premier.
    await supportDispatch(d, secret, token('u2'), { action: 'send', kind: 'question', message: 'Bonjour', app: 'N’IMPORTE QUOI' });
    const { rows } = await d.query<{ user_id: string; app: string }>('SELECT user_id, app FROM support_messages ORDER BY created_at');
    expect(rows).toHaveLength(6);
    expect(rows.filter((r) => r.user_id === 'u2').map((r) => r.app)).toEqual(['home']);
  }, 30_000);
});

describe('rappel du dimanche', () => {
  const env: PushEnv = { publicKey: 'BPub', privateKey: 'priv', subject: 'https://exemple.test' };
  const sub = (n: number) => ({ action: 'subscribe', endpoint: `https://push.exemple.test/abonnement-${n}`, keys: { p256dh: 'p'.repeat(20), auth: 'a'.repeat(16) } });

  it('clé publique sans compte ; s’abonner, l’état, se désabonner ; désactivé sans clés VAPID', async () => {
    const d = await db();
    expect(await pushDispatch(d, secret, undefined, { action: 'key' }, env)).toEqual({ publicKey: 'BPub' });
    expect(await pushDispatch(d, secret, undefined, { action: 'key' }, null)).toEqual({ publicKey: null });
    await expect(pushDispatch(d, secret, undefined, sub(1), env)).rejects.toMatchObject({ status: 401 });
    await expect(pushDispatch(d, secret, token('u1'), sub(1), null)).rejects.toMatchObject({ status: 503 });
    await expect(pushDispatch(d, secret, token('u1'), { ...sub(1), endpoint: 'http://pas-https.test/x' }, env)).rejects.toMatchObject({ status: 400 });
    await expect(pushDispatch(d, secret, token('u1'), { ...sub(1), keys: { p256dh: 'p'.repeat(20) } }, env)).rejects.toMatchObject({ status: 400 });
    await pushDispatch(d, secret, token('u1'), sub(1), env);
    const status = (uid: string) => pushDispatch(d, secret, token(uid), { action: 'status', endpoint: sub(1).endpoint }, env);
    expect(await status('u1')).toEqual({ subscribed: true, weekly: true, enabled: true });
    // L'abonnement d'un autre ne se lit ni ne s'efface.
    expect(await status('u2')).toMatchObject({ subscribed: false });
    await pushDispatch(d, secret, token('u2'), { action: 'unsubscribe', endpoint: sub(1).endpoint }, env);
    expect(await status('u1')).toMatchObject({ subscribed: true });
    await pushDispatch(d, secret, token('u1'), { action: 'unsubscribe', endpoint: sub(1).endpoint }, env);
    expect(await status('u1')).toMatchObject({ subscribed: false });
  }, 30_000);

  it('10 appareils au plus par compte : le plus ancien laisse sa place', async () => {
    const d = await db();
    for (let i = 0; i < 11; i++) await pushDispatch(d, secret, token('u1'), sub(i), env, Date.now() + i);
    const { rows } = await d.query<{ endpoint: string }>('SELECT endpoint FROM push_subscriptions');
    expect(rows).toHaveLength(10);
    expect(rows.map((r) => r.endpoint)).not.toContain(sub(0).endpoint);
  }, 30_000);

  it('envoi : le même message à tous, sans aucune donnée ; abonnements expirés effacés', async () => {
    const d = await db();
    for (let i = 0; i < 3; i++) await pushDispatch(d, secret, token(`u${i}`), sub(i), env);
    const payloads: string[] = [];
    const send: PushSender = async (s, payload) => {
      payloads.push(payload);
      if (s.endpoint.endsWith('-1')) throw Object.assign(new Error('Gone'), { statusCode: 410 });
      if (s.endpoint.endsWith('-2')) throw Object.assign(new Error('Boom'), { statusCode: 500 });
      return { statusCode: 201 };
    };
    expect(await sendWeekly(d, send)).toEqual({ sent: 1, removed: 1, failed: 1 });
    expect(new Set(payloads).size).toBe(1);
    expect(JSON.parse(payloads[0]!)).toEqual({ title: 'Ta semaine est bouclée', body: 'Ton bilan t’attend : séances, budget, quêtes.', url: '/bilan' });
    const { rows } = await d.query('SELECT endpoint FROM push_subscriptions');
    expect(rows).toHaveLength(2);
  }, 30_000);
});
