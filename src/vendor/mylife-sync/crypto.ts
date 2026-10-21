// GÉNÉRÉ depuis MyLife/packages/sync-client — ne pas modifier ici (MyLife : npm run vendor).
/**
 * Chiffrement de bout en bout MyLife (même code sur le web et dans l'app React Native).
 *
 * mot de passe ──PBKDF2-SHA256──► clé maîtresse ──HKDF──► clé d'authentification (envoyée au serveur)
 *                                                  └─HKDF──► clé d'emballage ──AES-GCM──► clé de données
 * clé de secours (aléatoire) ────────────────────HKDF──► preuve de secours + 2e emballage de la clé de données
 * Chaque ligne synchronisée est chiffrée en AES-256-GCM avec la clé de données, liée à son
 * emplacement (app/table/identifiant) : le serveur ne peut ni la lire ni la déplacer.
 */
import { gcm } from '@noble/ciphers/aes.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

/** Aléa cryptographique fourni par la plateforme (WebCrypto, expo-crypto). */
export type RandomBytes = (n: number) => Uint8Array;

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const info = (label: string) => utf8ToBytes(`mylife/${label}/v1`);
const derive = (ikm: Uint8Array, label: string) => hkdf(sha256, ikm, undefined, info(label), 32);

export interface PasswordKeys {
  /** Envoyée au serveur (il n'en garde qu'une empreinte). */
  authKey: string;
  /** Emballe la clé de données ; ne quitte jamais l'appareil. */
  kek: Uint8Array;
}

/** Dérivation lente (PBKDF2) : quelques secondes sur un téléphone, une fois par connexion. */
export async function passwordKeys(password: string, saltHex: string, iterations: number): Promise<PasswordKeys> {
  const master = await pbkdf2Async(sha256, enc.encode(password.normalize('NFKC')), hexToBytes(saltHex), { c: iterations, dkLen: 32, asyncTick: 20 });
  return { authKey: bytesToHex(derive(master, 'auth')), kek: derive(master, 'kek') };
}

export interface RecoveryKeys {
  recAuth: string;
  recKek: Uint8Array;
}

export function recoveryKeys(recoveryKey: string): RecoveryKeys {
  const raw = parseRecoveryKey(recoveryKey);
  return { recAuth: bytesToHex(derive(raw, 'rec-auth')), recKek: derive(raw, 'rec-kek') };
}

function seal(key: Uint8Array, data: Uint8Array, aad: Uint8Array | undefined, random: RandomBytes): string {
  const iv = random(12);
  const ct = gcm(key, iv, aad).encrypt(data);
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return toB64(out);
}

function open(key: Uint8Array, b64: string, aad?: Uint8Array): Uint8Array {
  const all = fromB64(b64);
  return gcm(key, all.subarray(0, 12), aad).decrypt(all.subarray(12));
}

export const wrapKey = (kek: Uint8Array, dek: Uint8Array, random: RandomBytes) => seal(kek, dek, info('wrap'), random);
export const unwrapKey = (kek: Uint8Array, wrapped: string) => open(kek, wrapped, info('wrap'));

const place = (app: string, tbl: string, rid: string) => enc.encode(`${app}/${tbl}/${rid}`);

export function encryptRow(dek: Uint8Array, app: string, tbl: string, rid: string, row: unknown, random: RandomBytes): string {
  return seal(dek, enc.encode(JSON.stringify(row)), place(app, tbl, rid), random);
}

export function decryptRow(dek: Uint8Array, app: string, tbl: string, rid: string, payload: string): unknown {
  return JSON.parse(dec.decode(open(dek, payload, place(app, tbl, rid))));
}

// ---------------------------------------------------------------- clé de secours

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // base32 de Crockford : pas de I, L, O, U

/** 20 octets aléatoires → « XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX » (160 bits). */
export function newRecoveryKey(random: RandomBytes): string {
  const bytes = random(20);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  return out.match(/.{4}/g)!.join('-');
}

/** Tolère minuscules, espaces, tirets et les confusions O/0, I/L/1. */
export function parseRecoveryKey(text: string): Uint8Array {
  const clean = text.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (clean.length !== 32 || [...clean].some((c) => !ALPHABET.includes(c))) throw new Error('Clé de secours invalide : 32 caractères attendus.');
  const out = new Uint8Array(20);
  let bits = 0;
  let value = 0;
  let i = 0;
  for (const c of clean) {
    value = (value << 5) | ALPHABET.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out[i++] = (value >>> (bits - 8)) & 255;
      bits -= 8;
    }
    value &= (1 << bits) - 1;
  }
  return out;
}

export { bytesToHex, hexToBytes };
