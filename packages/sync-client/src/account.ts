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

  async call<T>(path: '/api/auth' | '/api/sync', body: Record<string, unknown>, token?: string): Promise<T> {
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

const normalize = (login: string) => login.trim().toLowerCase();

/** Création du compte : renvoie la clé de secours, à montrer UNE fois à l'utilisateur. */
export async function createAccount(p: Platform, input: { login: string; password: string; invite: string }): Promise<{ session: Session; recoveryKey: string }> {
  if (input.password.length < 8) throw new ApiError(400, 'Mot de passe trop court : 8 caractères au moins.');
  const login = normalize(input.login);
  const salt = bytesToHex(p.random(16));
  const keys = await passwordKeys(input.password, salt, KDF_ITERATIONS);
  const dek = p.random(32);
  const recoveryKey = newRecoveryKey(p.random);
  const rec = recoveryKeys(recoveryKey);
  const r = await p.api.call<{ token: string; login: string }>('/api/auth', {
    action: 'signup',
    login,
    invite: input.invite,
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
  if (input.newPassword.length < 8) throw new ApiError(400, 'Mot de passe trop court : 8 caractères au moins.');
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
  if (newPassword.length < 8) throw new ApiError(400, 'Mot de passe trop court : 8 caractères au moins.');
  const salt = bytesToHex(p.random(16));
  const keys = await passwordKeys(newPassword, salt, KDF_ITERATIONS);
  await p.api.call('/api/auth', { action: 'password', newSalt: salt, newAuthKey: keys.authKey, newWrappedKey: wrapKey(keys.kek, fromB64(session.dek), p.random) }, session.token);
}

export const signOut = (p: Platform) => p.sessions.set(null);
