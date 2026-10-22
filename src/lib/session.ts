import { MyLifeApi, type Platform, type Session } from '../vendor/mylife-sync';

/**
 * Compte MyLife sur le web : la session (jeton + clé de données) est gardée dans le navigateur et
 * partagée par toutes les apps de la même adresse (MyFinances, MyPerf, myRaveLoc) — une seule connexion.
 * Même clé et même format que `Budget/src/sync/cloud/platform.ts`.
 */
const SESSION_KEY = 'mylife-session';
const listeners = new Set<() => void>();

function read(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    const s = raw ? (JSON.parse(raw) as Partial<Session>) : null;
    return s && typeof s.token === 'string' && typeof s.login === 'string' && typeof s.dek === 'string' ? (s as Session) : null;
  } catch {
    return null;
  }
}

export function currentSession(): Session | null {
  return read();
}

export function onSessionChange(fn: () => void): () => void {
  listeners.add(fn);
  // Connexion / déconnexion depuis une autre app ou un autre onglet.
  const storage = (e: StorageEvent) => e.key === SESSION_KEY && fn();
  window.addEventListener('storage', storage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener('storage', storage);
  };
}

/** Identifiant du compte, lu dans le jeton (sa partie publique : `{ uid, exp }`). */
export function uidOf(session: Session | null): string | null {
  try {
    const payload = session?.token.split('.')[0];
    if (!payload) return null;
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { uid?: unknown };
    return typeof json.uid === 'string' ? json.uid : null;
  } catch {
    return null;
  }
}

export const platform: Platform = {
  api: new MyLifeApi(''),
  random: (n) => crypto.getRandomValues(new Uint8Array(n)),
  sessions: {
    get: async () => read(),
    set: async (s) => {
      try {
        if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
        else localStorage.removeItem(SESSION_KEY);
      } catch {
        /* stockage indisponible : session limitée à cet onglet */
      }
      listeners.forEach((l) => l());
    },
  },
};
