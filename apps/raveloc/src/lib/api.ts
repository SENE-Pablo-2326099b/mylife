/**
 * Appels à l'API myRaveLoc (`/api/raveloc`, même origine que MyLife : la session suit).
 * Hors ligne → ApiError(0) ; session refusée → ApiError(401).
 */
import { ApiError } from '../vendor/mylife-sync';

export { ApiError };

export interface GroupSummary {
  id: string;
  name: string;
  role: 'admin' | 'member';
  wrappedKey: string;
  createdAt: number;
  expiresAt: number;
  members: number;
  sharing: 'on' | 'paused' | 'off';
  shareUntil: number | null;
}

export interface MemberView {
  uid: string;
  role: 'admin' | 'member';
  profile: string;
  joinedAt: number;
  seenAgo: number;
  sharing: 'on' | 'paused' | 'off';
  shareUntil: number | null;
  position: { payload: string; age: number } | null;
}

export interface PollResult {
  now: number;
  accepted: boolean;
  group: { id: string; name: string; expiresAt: number; createdBy: string };
  members: MemberView[];
}

export interface InviteInfo {
  id: string;
  createdAt: number;
  expiresAt: number;
  uses: number;
  maxUses: number | null;
  revoked: boolean;
}

export interface Api {
  groups(): Promise<{ uid: string; now: number; groups: GroupSummary[] }>;
  create(b: { gid: string; name: string; profile: string; wrappedKey: string; durationMs: number }): Promise<{ id: string; expiresAt: number }>;
  delete(b: { gid: string }): Promise<{ ok: true }>;
  leave(b: { gid: string }): Promise<{ ok: true }>;
  remove(b: { gid: string; uid: string }): Promise<{ ok: true }>;
  role(b: { gid: string; uid: string; role: 'admin' | 'member' }): Promise<{ ok: true }>;
  profile(b: { gid: string; profile: string }): Promise<{ ok: true }>;
  invite(b: { gid: string; ttlMs: number; maxUses?: number | null }): Promise<{ token: string; invite: InviteInfo }>;
  invites(b: { gid: string }): Promise<{ invites: InviteInfo[] }>;
  revoke(b: { gid: string; inviteId: string }): Promise<{ ok: true }>;
  peek(b: { token: string }): Promise<{ gid: string; name: string; expiresAt: number; member: boolean }>;
  join(b: { token: string; profile: string; wrappedKey: string }): Promise<{ gid: string; already: boolean }>;
  share(b: { gid: string; mode: 'on' | 'paused' | 'off'; until?: number }): Promise<{ sharing: 'on' | 'paused' | 'off'; shareUntil: number | null }>;
  poll(b: { gid: string; position?: { payload: string; clientAt: number } }): Promise<PollResult>;
}

/** Délai au-delà duquel on abandonne une requête (réseau de festival : mieux vaut réessayer). */
const TIMEOUT_MS = 12_000;

export function createApi(getToken: () => string | null, base = '', fetchImpl: typeof fetch = (...a) => fetch(...a)): Api {
  async function call<T>(action: string, body: object = {}): Promise<T> {
    const token = getToken();
    if (!token) throw new ApiError(401, 'Session expirée : reconnecte-toi.');
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT_MS) : null;
    let res: Response;
    try {
      res = await fetchImpl(`${base}/api/raveloc`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ action, ...body }),
        signal: ctrl?.signal,
        cache: 'no-store',
      });
    } catch {
      throw new ApiError(0, 'Réseau indisponible.');
    } finally {
      if (timer) clearTimeout(timer);
    }
    let data: Record<string, unknown> = {};
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      /* réponse vide ou page d'erreur */
    }
    if (!res.ok) throw new ApiError(res.status, typeof data.error === 'string' ? data.error : `Erreur du serveur (${res.status}).`);
    return data as T;
  }
  const a = <B extends object, T>(name: string) => (b: B) => call<T>(name, b);
  return {
    groups: () => call('groups'),
    create: a('create'),
    delete: a('delete'),
    leave: a('leave'),
    remove: a('remove'),
    role: a('role'),
    profile: a('profile'),
    invite: a('invite'),
    invites: a('invites'),
    revoke: a('revoke'),
    peek: a('peek'),
    join: a('join'),
    share: a('share'),
    poll: a('poll'),
  };
}
