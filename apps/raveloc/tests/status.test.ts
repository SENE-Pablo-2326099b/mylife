import { describe, expect, it } from 'vitest';
import { ageOf, formatAge, freshness, friendState, guidance, heartbeatMs, pollDelay, shouldSend, THRESHOLDS, type Fix, type FriendFix } from '../src/domain/status';

const now = 1_800_000_000_000;
const me: Fix = { lat: 48.8566, lon: 2.3522, acc: 8, at: now };
/** ~130 m au nord-est (positions de test, jamais utilisées hors des tests). */
const far: FriendFix = { lat: 48.8575, lon: 2.3535, acc: 10, ageAtReceipt: 5000, receivedAt: now };

describe('fraîcheur', () => {
  it('âge = âge à la réception + temps écoulé depuis, sans comparer les horloges', () => {
    expect(ageOf({ ...far, ageAtReceipt: 4000, receivedAt: now - 6000 }, now)).toBe(10_000);
  });
  it('niveaux', () => {
    expect(freshness(10_000)).toBe('live');
    expect(freshness(2 * 60_000)).toBe('recent');
    expect(freshness(10 * 60_000)).toBe('old');
    expect(freshness(40 * 60_000)).toBe('stale');
  });
  it('libellés', () => {
    expect(formatAge(3000)).toBe('à l’instant');
    expect(formatAge(42_000)).toBe('il y a 42 s');
    expect(formatAge(12 * 60_000)).toBe('il y a 12 min');
    expect(formatAge(125 * 60_000)).toBe('il y a 2 h 05');
  });
  it('seuils réglables', () => {
    expect(freshness(10_000, { ...THRESHOLDS, liveMs: 5000 })).toBe('recent');
  });
});

describe('état d’un ami', () => {
  it('ne partage pas / en pause / en attente / à jour / silencieux', () => {
    expect(friendState({ sharing: 'off', fix: far }, now)).toBe('not-sharing');
    expect(friendState({ sharing: 'paused', fix: far }, now)).toBe('paused');
    expect(friendState({ sharing: 'on', fix: null }, now)).toBe('waiting');
    expect(friendState({ sharing: 'on', fix: far }, now)).toBe('live');
    expect(friendState({ sharing: 'on', fix: { ...far, ageAtReceipt: 5 * 60_000 } }, now)).toBe('silent');
  });
});

describe('guidage', () => {
  it('sans ma position : on le dit, avec la raison', () => {
    expect(guidance(null, 'locating', far, 'live')).toEqual({ kind: 'no-me', reason: 'locating' });
    expect(guidance(null, 'denied', far, 'live')).toEqual({ kind: 'no-me', reason: 'denied' });
    expect(guidance(me, 'unavailable', far, 'live')).toEqual({ kind: 'no-me', reason: 'unavailable' });
  });
  it('sans position de l’ami : pas de direction inventée', () => {
    expect(guidance(me, 'ok', null, 'not-sharing')).toEqual({ kind: 'no-friend', state: 'not-sharing' });
  });
  it('direction et distance quand tout est bon', () => {
    const g = guidance(me, 'ok', far, 'live');
    expect(g.kind).toBe('ok');
    if (g.kind !== 'ok') return;
    expect(g.distance).toBeGreaterThan(120);
    expect(g.distance).toBeLessThan(150);
    expect(g.bearing).toBeGreaterThan(30);
    expect(g.bearing).toBeLessThan(60);
    expect(g.spread).toBeLessThan(10);
  });
  it('positions qui se chevauchent : « tout proche », pas de flèche', () => {
    const g = guidance(me, 'ok', { ...far, lat: me.lat + 0.00005, lon: me.lon }, 'live');
    expect(g.kind).toBe('near');
  });
  it('même position exacte : tout proche (pas de division par zéro)', () => {
    expect(guidance(me, 'ok', { ...far, lat: me.lat, lon: me.lon }, 'live').kind).toBe('near');
  });
  it('positions imprécises qui se recouvrent : direction incertaine, jamais « tout proche »', () => {
    const g = guidance({ ...me, acc: 90 }, 'ok', { ...far, lat: me.lat + 0.0001, lon: me.lon, acc: 90 }, 'live');
    expect(g.kind).toBe('uncertain');
  });
  it('cône d’incertitude trop large pour la distance : direction incertaine', () => {
    // ~140 m d'écart, ± 180 m d'incertitude combinée : le cône dépasse 50°.
    expect(guidance({ ...me, acc: 130 }, 'ok', { ...far, acc: 130 }, 'live').kind).toBe('uncertain');
    // Même distance, ± 100 m : direction donnée, avec un cône d'environ 35°.
    const g = guidance({ ...me, acc: 60 }, 'ok', { ...far, acc: 80 }, 'live');
    expect(g.kind).toBe('ok');
    if (g.kind === 'ok') expect(g.spread).toBeGreaterThan(30);
  });
  it('seuil de proximité réglable', () => {
    const t = { ...THRESHOLDS, nearM: 500 };
    expect(guidance(me, 'ok', far, 'live', t).kind).toBe('near');
  });
});

describe('envoi des positions', () => {
  const o = { heartbeatMs: 30_000, minMoveM: 8 };
  const sent = { lat: me.lat, lon: me.lon, acc: 8, sentAt: now - 5000 };
  it('premier envoi', () => {
    expect(shouldSend(null, me, now, o)).toBe(true);
  });
  it('immobile : rien avant le signe de vie', () => {
    expect(shouldSend(sent, { ...me, lat: me.lat + 0.00001 }, now, o)).toBe(false);
    expect(shouldSend({ ...sent, sentAt: now - 31_000 }, me, now, o)).toBe(true);
  });
  it('vrai déplacement : envoi', () => {
    expect(shouldSend(sent, { ...me, lat: me.lat + 0.0002 }, now, o)).toBe(true);
  });
  it('bruit GPS d’une mesure imprécise : pas d’envoi', () => {
    expect(shouldSend(sent, { ...me, lat: me.lat + 0.0002, acc: 60 }, now, o)).toBe(false);
  });
  it('précision nettement meilleure : envoi', () => {
    expect(shouldSend({ ...sent, acc: 60 }, { ...me, acc: 10 }, now, o)).toBe(true);
  });
});

describe('rythme des échanges', () => {
  it('selon l’écran', () => {
    expect(pollDelay({ screen: 'navigate', visible: true, online: true, failures: 0 })).toBe(4000);
    expect(pollDelay({ screen: 'group', visible: true, online: true, failures: 0 })).toBe(10_000);
    expect(pollDelay({ screen: 'list', visible: true, online: true, failures: 0 })).toBe(30_000);
  });
  it('rien en arrière-plan ni hors ligne', () => {
    expect(pollDelay({ screen: 'navigate', visible: false, online: true, failures: 0 })).toBeNull();
    expect(pollDelay({ screen: 'navigate', visible: true, online: false, failures: 0 })).toBeNull();
  });
  it('espacement après des échecs, plafonné à une minute', () => {
    expect(pollDelay({ screen: 'navigate', visible: true, online: true, failures: 2 })).toBe(16_000);
    expect(pollDelay({ screen: 'list', visible: true, online: true, failures: 9 })).toBe(60_000);
  });
  it('signe de vie plus fréquent que le seuil « à jour »', () => {
    expect(heartbeatMs('navigate')).toBeLessThan(THRESHOLDS.liveMs);
    expect(heartbeatMs('list') + 10_000).toBeLessThan(THRESHOLDS.liveMs);
  });
});
