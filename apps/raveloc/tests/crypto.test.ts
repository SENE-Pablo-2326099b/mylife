import { describe, expect, it } from 'vitest';
import { inviteLink, inviteParts, newGroupId, newGroupKey, openName, openPosition, openProfile, parseInvite, sealName, sealPosition, sealProfile, unwrapGroupKey, wrapGroupKey } from '../src/lib/groupCrypto';

const dek = crypto.getRandomValues(new Uint8Array(32));

describe('clé de groupe', () => {
  it('emballée par la clé de données MyLife, liée au groupe', () => {
    const gid = newGroupId();
    const key = newGroupKey();
    const w = wrapGroupKey(dek, gid, key);
    expect(unwrapGroupKey(dek, gid, w)).toEqual(key);
    // Le serveur ne peut pas la faire passer pour la clé d'un autre groupe.
    expect(() => unwrapGroupKey(dek, newGroupId(), w)).toThrow();
    // Ni la faire ouvrir par un autre compte.
    expect(() => unwrapGroupKey(crypto.getRandomValues(new Uint8Array(32)), gid, w)).toThrow();
  });
  it('identifiants et clés aléatoires (128 et 256 bits)', () => {
    expect(newGroupId()).toMatch(/^[0-9a-f]{32}$/);
    expect(newGroupId()).not.toBe(newGroupId());
    expect(newGroupKey()).toHaveLength(32);
  });
});

describe('données chiffrées', () => {
  const gid = newGroupId();
  const key = newGroupKey();
  it('nom du groupe et pseudo (émojis compris)', () => {
    expect(openName(key, gid, sealName(key, gid, 'Rave de ce soir 🎧'))).toBe('Rave de ce soir 🎧');
    expect(openProfile(key, gid, 'u_1', sealProfile(key, gid, 'u_1', 'Zoé'))).toBe('Zoé');
  });
  it('une position ne peut pas être attribuée à un autre membre', () => {
    const sealed = sealPosition(key, gid, 'u_1', { lat: 48.85661234, lon: 2.35221234, acc: 7.6, age: 1234.4 });
    expect(openPosition(key, gid, 'u_1', sealed)).toEqual({ lat: 48.856612, lon: 2.352212, acc: 8, age: 1234 });
    expect(() => openPosition(key, gid, 'u_2', sealed)).toThrow();
    expect(() => openPosition(newGroupKey(), gid, 'u_1', sealed)).toThrow();
  });
  it('chaque chiffrement est différent (vecteur aléatoire)', () => {
    expect(sealName(key, gid, 'x')).not.toBe(sealName(key, gid, 'x'));
  });
  it('tailles compatibles avec les limites du serveur', () => {
    expect(sealName(key, gid, 'x'.repeat(40)).length).toBeLessThanOrEqual(400);
    expect(sealProfile(key, gid, 'u_'.padEnd(64, 'a'), 'é'.repeat(24)).length).toBeLessThanOrEqual(300);
    expect(sealPosition(key, gid, 'u_1', { lat: -89.123456, lon: -179.123456, acc: 99999, age: 86_400_000 }).length).toBeLessThanOrEqual(600);
    expect(wrapGroupKey(dek, gid, key).length).toBeLessThanOrEqual(120);
  });
});

describe('lien d’invitation', () => {
  it('jeton pour le serveur, clé dans le fragment (jamais envoyé)', () => {
    const key = newGroupKey();
    const token = 'AbCdEfGhIjKlMnOpQrStUv';
    const link = inviteLink('https://mylife-liart.vercel.app/raveloc/', token, key);
    const url = new URL(link);
    expect(url.pathname).toBe('/raveloc/');
    expect(url.search).toBe('');
    expect(url.hash.startsWith('#rejoindre=')).toBe(true);
    expect(parseInvite(link)).toEqual({ token, key });
    expect(inviteParts(link)?.token).toBe(token);
  });
  it('lien tronqué ou abîmé : refusé', () => {
    const link = inviteLink('https://x/raveloc/', 'AbCdEfGhIjKlMnOpQrStUv', newGroupKey());
    expect(parseInvite(link.slice(0, -3))).toBeNull();
    expect(parseInvite('https://x/raveloc/')).toBeNull();
    expect(parseInvite('rejoindre=court.cle')).toBeNull();
  });
});
