/**
 * Chiffrement des données d'un groupe, avec les primitives de MyLife (`vendor/mylife-sync`, AES-256-GCM).
 *
 * - Chaque groupe a une clé aléatoire de 256 bits, créée par l'appareil du créateur.
 * - Elle voyage entre amis dans le fragment `#` du lien d'invitation : le navigateur ne l'envoie jamais
 *   au serveur.
 * - Chaque membre la range sur le serveur emballée par SA clé de données MyLife (qui ne quitte pas ses
 *   appareils) : il la retrouve sur tous ses appareils connectés au même compte.
 * - Nom du groupe, pseudos et positions sont chiffrés avec elle, et liés à leur emplacement
 *   (groupe, membre) : le serveur ne peut ni les lire, ni les échanger entre membres ou entre groupes.
 */
import { decryptRow, encryptRow, fromB64, toB64 } from '../vendor/mylife-sync';

const APP = 'raveloc';
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

export const newGroupId = () => [...random(16)].map((b) => b.toString(16).padStart(2, '0')).join('');
export const newGroupKey = () => random(32);

export const wrapGroupKey = (dek: Uint8Array, gid: string, key: Uint8Array) => encryptRow(dek, APP, 'key', gid, toB64(key), random);

export function unwrapGroupKey(dek: Uint8Array, gid: string, wrapped: string): Uint8Array {
  const b64 = decryptRow(dek, APP, 'key', gid, wrapped);
  if (typeof b64 !== 'string') throw new Error('Clé de groupe illisible');
  const key = fromB64(b64);
  if (key.length !== 32) throw new Error('Clé de groupe illisible');
  return key;
}

export const sealName = (key: Uint8Array, gid: string, name: string) => encryptRow(key, APP, 'group', gid, { name }, random);

export function openName(key: Uint8Array, gid: string, sealed: string): string {
  const v = decryptRow(key, APP, 'group', gid, sealed) as { name?: unknown };
  return typeof v?.name === 'string' ? v.name : '';
}

export const sealProfile = (key: Uint8Array, gid: string, uid: string, name: string) => encryptRow(key, APP, 'member', `${gid}/${uid}`, { name }, random);

export function openProfile(key: Uint8Array, gid: string, uid: string, sealed: string): string {
  const v = decryptRow(key, APP, 'member', `${gid}/${uid}`, sealed) as { name?: unknown };
  return typeof v?.name === 'string' ? v.name : '';
}

/** Contenu chiffré d'une position : `age` = ancienneté de la mesure au moment de l'envoi (ms). */
export interface SealedFix {
  lat: number;
  lon: number;
  acc: number;
  age: number;
}

export const sealPosition = (key: Uint8Array, gid: string, uid: string, p: SealedFix) =>
  encryptRow(key, APP, 'pos', `${gid}/${uid}`, { lat: +p.lat.toFixed(6), lon: +p.lon.toFixed(6), acc: Math.round(p.acc), age: Math.max(0, Math.round(p.age)) }, random);

export function openPosition(key: Uint8Array, gid: string, uid: string, sealed: string): SealedFix | null {
  const v = decryptRow(key, APP, 'pos', `${gid}/${uid}`, sealed) as Partial<SealedFix>;
  const ok = [v?.lat, v?.lon, v?.acc, v?.age].every((x) => typeof x === 'number' && Number.isFinite(x)) && Math.abs(v.lat!) <= 90 && Math.abs(v.lon!) <= 180 && v.acc! >= 0;
  return ok ? { lat: v.lat!, lon: v.lon!, acc: v.acc!, age: v.age! } : null;
}

// ---------------------------------------------------------------- lien d'invitation

const b64url = (b: Uint8Array) => toB64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string) => fromB64(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));

/** `…/raveloc/#rejoindre=<jeton>.<clé>` : jeton (vérifié par le serveur) + clé (jamais envoyée). */
export function inviteLink(appUrl: string, token: string, key: Uint8Array): string {
  return `${appUrl}#rejoindre=${token}.${b64url(key)}`;
}

/** Jeton et clé (texte) d'un lien d'invitation, ou null s'il est incomplet. */
export function inviteParts(text: string): { token: string; key: string } | null {
  const m = /rejoindre=([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/.exec(text);
  return m ? { token: m[1]!, key: m[2]! } : null;
}

export function parseInvite(text: string): { token: string; key: Uint8Array } | null {
  const parts = inviteParts(text);
  if (!parts) return null;
  try {
    const key = fromB64url(parts.key);
    return key.length === 32 ? { token: parts.token, key } : null;
  } catch {
    return null;
  }
}
