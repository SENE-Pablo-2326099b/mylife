// GÉNÉRÉ depuis MyLife/packages/sync-client — ne pas modifier ici (MyLife : npm run vendor).
/**
 * Compte MyLife côté appareil : appels au serveur, création / connexion / secours, session gardée
 * sur l'appareil (jeton + clé de données). Une seule session pour toutes les apps d'une même origine.
 */
import { bytesToHex, fromB64, newRecoveryKey, passwordKeys, recoveryKeys, toB64, unwrapKey, wrapKey, type RandomBytes } from './crypto';

export const KDF_ITERATIONS = 200_000;

export interface Session {
  login: string;
  token: string;
  /** Clé de données (base64). Ne quitte jamais l'appareil. */
  dek: string;
}

/** Où la session est gardée : localStorage sur le web, stockage sécurisé dans l'app. */
export interface SessionStore {
  get(): Promise<Session | null>;
  set(session: Session | null): Promise<void>;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Appels au serveur MyLife (`base` vide sur le web : même origine ; URL complète dans l'app). */
export class MyLifeApi {
  constructor(
    private base: string,
    private fetchImpl: typeof fetch = (...a) => fetch(...a),
  ) {}

  async call<T>(path: '/api/auth' | '/api/sync' | '/api/raveloc' | '/api/space', body: Record<string, unknown>, token?: string): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, 'Serveur MyLife injoignable (hors ligne ?).');
    }
    let data: Record<string, unknown> = {};
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      /* réponse vide */
    }
    if (!res.ok) throw new ApiError(res.status, typeof data.error === 'string' ? data.error : `Erreur ${res.status}`);
    return data as T;
  }
}

export interface Platform {
  api: MyLifeApi;
  sessions: SessionStore;
  random: RandomBytes;
}

export const normalizeLogin = (login: string) => login.trim().toLowerCase();
const normalize = normalizeLogin;

/** Identifiant accepté par le serveur : 3 à 64 caractères, lettres, chiffres, . _ - @. */
export function loginIssue(login: string): string | null {
  const l = normalize(login);
  if (l.length < 3) return '3 caractères au moins.';
  if (l.length > 64) return '64 caractères au plus.';
  if (!/^[a-z0-9]/.test(l)) return 'Commence par une lettre ou un chiffre.';
  if (!/^[a-z0-9._@-]+$/.test(l)) return 'Lettres, chiffres et . _ - @ seulement (pas d’espace ni d’accent).';
  return null;
}

/** Mots de passe trop connus : refusés même s'ils font 8 caractères. */
const COMMON = new Set(['12345678', '123456789', '1234567890', 'password', 'motdepasse', 'azertyuiop', 'azerty123', 'qwertyuiop', 'qwerty123', '11111111', '00000000', 'iloveyou', 'password1', 'abcd1234', 'aaaaaaaa', '12341234', 'soleil123', 'doudou123', 'marseille', 'loulou123']);

/** Ce qui ne va pas dans un nouveau mot de passe, ou null. Le chiffrement en dépend : il doit tenir. */
export function passwordIssue(password: string, login = ''): string | null {
  if (password.length < 8) return '8 caractères au moins.';
  const lower = password.toLowerCase();
  if (COMMON.has(lower) || /^(.)\1+$/.test(password)) return 'Trop courant : choisis-en un moins prévisible.';
  if (login && lower.includes(normalize(login)) && normalize(login).length >= 3) return 'Évite d’y mettre ton identifiant.';
  return null;
}

/** Robustesse indicative (0 à 4) : longueur et variété. */
export function passwordStrength(password: string): 0 | 1 | 2 | 3 | 4 {
  if (password.length < 8) return 0;
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;
  const score = (password.length >= 12 ? 2 : 1) + (password.length >= 16 ? 1 : 0) + (kinds >= 3 ? 1 : 0);
  return Math.min(4, score) as 1 | 2 | 3 | 4;
}

/** L'identifiant est-il libre ? */
export async function checkLogin(api: MyLifeApi, login: string): Promise<boolean> {
  const r = await api.call<{ available: boolean }>('/api/auth', { action: 'available', login: normalize(login) });
  return r.available;
}

/** Création du compte : renvoie la clé de secours, à proposer à l'utilisateur de garder. */
export async function createAccount(p: Platform, input: { login: string; password: string; invite?: string }): Promise<{ session: Session; recoveryKey: string }> {
  const issue = passwordIssue(input.password, input.login);
  if (issue) throw new ApiError(400, `Mot de passe : ${issue}`);
  const login = normalize(input.login);
  const salt = bytesToHex(p.random(16));
  const keys = await passwordKeys(input.password, salt, KDF_ITERATIONS);
  const dek = p.random(32);
  const recoveryKey = newRecoveryKey(p.random);
  const rec = recoveryKeys(recoveryKey);
  const r = await p.api.call<{ token: string; login: string }>('/api/auth', {
    action: 'signup',
    login,
    ...(input.invite ? { invite: input.invite } : {}),
    salt,
    iterations: KDF_ITERATIONS,
    authKey: keys.authKey,
    recAuth: rec.recAuth,
    wrappedKey: wrapKey(keys.kek, dek, p.random),
    recWrappedKey: wrapKey(rec.recKek, dek, p.random),
  });
  const session = { login: r.login, token: r.token, dek: toB64(dek) };
  await p.sessions.set(session);
  return { session, recoveryKey };
}

export async function signIn(p: Platform, input: { login: string; password: string }): Promise<Session> {
  const login = normalize(input.login);
  const { salt, iterations } = await p.api.call<{ salt: string; iterations: number }>('/api/auth', { action: 'salt', login });
  const keys = await passwordKeys(input.password, salt, iterations);
  const r = await p.api.call<{ token: string; login: string; wrappedKey: string }>('/api/auth', { action: 'login', login, authKey: keys.authKey });
  let dek: Uint8Array;
  try {
    dek = unwrapKey(keys.kek, r.wrappedKey);
  } catch {
    throw new ApiError(401, 'Identifiant ou mot de passe incorrect.');
  }
  const session = { login: r.login, token: r.token, dek: toB64(dek) };
  await p.sessions.set(session);
  return session;
}

/** Mot de passe oublié : la clé de secours redonne accès aux données, avec un nouveau mot de passe. */
export async function recoverAccount(p: Platform, input: { login: string; recoveryKey: string; newPassword: string }): Promise<Session> {
  const issue = passwordIssue(input.newPassword, input.login);
  if (issue) throw new ApiError(400, `Mot de passe : ${issue}`);
  const login = normalize(input.login);
  let rec: ReturnType<typeof recoveryKeys>;
  try {
    rec = recoveryKeys(input.recoveryKey);
  } catch (e) {
    throw new ApiError(400, (e as Error).message);
  }
  const { recWrappedKey } = await p.api.call<{ recWrappedKey: string }>('/api/auth', { action: 'recoverStart', login, recAuth: rec.recAuth });
  const dek = unwrapKey(rec.recKek, recWrappedKey);
  const salt = bytesToHex(p.random(16));
  const keys = await passwordKeys(input.newPassword, salt, KDF_ITERATIONS);
  const r = await p.api.call<{ token: string; login: string }>('/api/auth', {
    action: 'recoverFinish',
    login,
    recAuth: rec.recAuth,
    newSalt: salt,
    newAuthKey: keys.authKey,
    newWrappedKey: wrapKey(keys.kek, dek, p.random),
  });
  const session = { login: r.login, token: r.token, dek: toB64(dek) };
  await p.sessions.set(session);
  return session;
}

export async function changePassword(p: Platform, session: Session, newPassword: string): Promise<void> {
  const issue = passwordIssue(newPassword, session.login);
  if (issue) throw new ApiError(400, `Mot de passe : ${issue}`);
  const salt = bytesToHex(p.random(16));
  const keys = await passwordKeys(newPassword, salt, KDF_ITERATIONS);
  await p.api.call('/api/auth', { action: 'password', newSalt: salt, newAuthKey: keys.authKey, newWrappedKey: wrapKey(keys.kek, fromB64(session.dek), p.random) }, session.token);
}

/** Nouvelle clé de secours : l'ancienne cesse de fonctionner. Renvoie la nouvelle, à garder. */
export async function renewRecoveryKey(p: Platform, session: Session): Promise<string> {
  const recoveryKey = newRecoveryKey(p.random);
  const rec = recoveryKeys(recoveryKey);
  await p.api.call('/api/auth', { action: 'renewRecovery', recAuth: rec.recAuth, recWrappedKey: wrapKey(rec.recKek, fromB64(session.dek), p.random) }, session.token);
  return recoveryKey;
}

/** Supprime le compte et ses données du serveur (mot de passe redemandé) ; les appareils gardent les leurs. */
export async function deleteAccount(p: Platform, session: Session, password: string): Promise<void> {
  const { salt, iterations } = await p.api.call<{ salt: string; iterations: number }>('/api/auth', { action: 'salt', login: session.login });
  const keys = await passwordKeys(password, salt, iterations);
  await p.api.call('/api/auth', { action: 'deleteAccount', authKey: keys.authKey }, session.token);
  await p.sessions.set(null);
}

export const signOut = (p: Platform) => p.sessions.set(null);
