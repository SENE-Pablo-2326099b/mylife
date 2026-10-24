// GÉNÉRÉ depuis MyLife/packages/sync-client — ne pas modifier ici (MyLife : npm run vendor).
import { MyLifeApi, type Platform, type Session } from './account';
import { adoptDevice, claimDevice } from './device';

/**
 * Compte MyLife sur le web : la session (jeton + clé de données) est gardée dans le stockage de
 * l'adresse MyLife, partagé par toutes les apps (accueil, MyFinances, MyPerf, MyRave) : une seule
 * connexion pour toutes, et se déconnecter dans l'une déconnecte les autres, onglets ouverts compris.
 */
const SESSION_KEY = 'mylife-session';
/** Clé de secours pas encore mise de côté (« plus tard » à la création) : gardée jusqu'à confirmation. */
const RECOVERY_KEY = 'mylife:recovery-pending';

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function readJson<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* stockage indisponible (navigation privée stricte) : valable pour cette page seulement */
  }
}

let session: Session | null = read();
if (session) adoptDevice(session.login);

function read(): Session | null {
  const s = readJson<Partial<Session>>(SESSION_KEY);
  return s && typeof s.token === 'string' && typeof s.login === 'string' && typeof s.dek === 'string' ? (s as Session) : null;
}

if (typeof window !== 'undefined') {
  // Connexion, déconnexion ou clé mise de côté depuis une autre app ou un autre onglet.
  window.addEventListener('storage', (e) => {
    if (e.key !== SESSION_KEY && e.key !== RECOVERY_KEY && e.key !== null) return;
    session = read();
    emit();
  });
}

/** Session courante (lecture synchrone : rendu, en-têtes). */
export function currentSession(): Session | null {
  return session;
}

export function onSessionChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Identifiant du compte, lu dans le jeton (sa partie publique : `{ uid, exp }`). */
export function uidOf(s: Session | null): string | null {
  try {
    const payload = s?.token.split('.')[0];
    if (!payload) return null;
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { uid?: unknown };
    return typeof json.uid === 'string' ? json.uid : null;
  } catch {
    return null;
  }
}

export const webPlatform: Platform = {
  api: new MyLifeApi(''),
  random: (n) => crypto.getRandomValues(new Uint8Array(n)),
  sessions: {
    get: async () => session,
    set: async (s) => {
      // Un autre compte que le précédent : rien de lui (clé d'IA, aperçus…) ne reste visible ni utilisable.
      if (s) claimDevice(s.login);
      session = s;
      writeJson(SESSION_KEY, s);
      // Déconnexion : une clé de secours en attente ne doit pas rester sur un appareil partagé.
      if (!s) writeJson(RECOVERY_KEY, null);
      emit();
    },
  },
};

export interface PendingRecovery {
  login: string;
  key: string;
  at: number;
}

/** Clé de secours créée mais pas encore confirmée « mise de côté » par l'utilisateur. */
export function pendingRecovery(): PendingRecovery | null {
  const p = readJson<PendingRecovery>(RECOVERY_KEY);
  return p && typeof p.key === 'string' && typeof p.login === 'string' && p.login === session?.login ? p : null;
}

export function setPendingRecovery(p: { login: string; key: string } | null): void {
  writeJson(RECOVERY_KEY, p ? { ...p, at: Date.now() } : null);
  emit();
}
