import { getRandomBytes } from 'expo-crypto';

import { MyLifeApi, adoptDevice, claimDevice, type Platform, type Session } from '@/vendor/mylife-sync';
import { writeAiKey } from '@/vendor/mylife-sync/aiKey';

/**
 * Compte MyLife dans MyPerf (PWA MyLife, même adresse que les autres apps) : la session est partagée (une seule
 * connexion), dans le stockage du navigateur. MyPerf n'existe plus qu'en web : l'app Android a été retirée.
 */
const SESSION_KEY = 'mylife-session';

let cached: Session | null | undefined;

function read(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

/** Session courante (relue à chaque fois : le web suit les autres onglets et apps). */
export async function currentSession(): Promise<Session | null> {
  const first = cached === undefined;
  cached = read();
  if (first && cached) adoptDevice(cached.login);
  return cached;
}

/** Clé de secours d'un compte neuf pas encore mise de côté (« plus tard ») : gardée jusqu'à confirmation. */
const RECOVERY_KEY = 'mylife:recovery-pending';

export interface PendingRecovery {
  login: string;
  key: string;
  at: number;
}

export async function readPendingRecovery(): Promise<PendingRecovery | null> {
  try {
    const raw = localStorage.getItem(RECOVERY_KEY);
    return raw ? (JSON.parse(raw) as PendingRecovery) : null;
  } catch {
    return null;
  }
}

export async function writePendingRecovery(p: { login: string; key: string } | null): Promise<void> {
  try {
    if (p) localStorage.setItem(RECOVERY_KEY, JSON.stringify({ ...p, at: Date.now() }));
    else localStorage.removeItem(RECOVERY_KEY);
  } catch {
    /* stockage indisponible */
  }
}

/** Appareil déjà connecté avant la règle « un autre compte efface le précédent » : la session en cours en est la propriétaire. */
export async function adoptThisDevice(login: string): Promise<void> {
  adoptDevice(login);
}

export const platform: Platform = {
  api: new MyLifeApi(''),
  random: (n) => getRandomBytes(n),
  sessions: {
    get: currentSession,
    set: async (s) => {
      // Un autre compte que le précédent : la clé d'IA et les traces du précédent sont effacées (commun à toutes les apps).
      if (s) claimDevice(s.login);
      cached = s;
      try {
        if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
        else localStorage.removeItem(SESSION_KEY);
      } catch {
        /* stockage indisponible */
      }
      // Déconnexion : la clé d'API Anthropic ne reste pas sur l'appareil.
      if (!s) writeAiKey(null);
    },
  },
};
