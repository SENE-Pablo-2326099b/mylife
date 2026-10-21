import { MyLifeApi, type Platform, type Session } from '../../vendor/mylife-sync';

/**
 * Compte MyLife sur le web : la session (jeton + clé de données) est gardée dans le navigateur et
 * partagée par toutes les apps de la même adresse (MyFinances, MyPerf) — une seule connexion.
 */
const SESSION_KEY = 'mylife-session';
const listeners = new Set<() => void>();

function read(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

/** Session courante (lecture synchrone : en-têtes du relais, rendu). */
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
