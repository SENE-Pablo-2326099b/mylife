import { getRandomBytes } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform as RN } from 'react-native';

import { MyLifeApi, adoptDevice, claimDevice, type Platform, type Session } from '@/vendor/mylife-sync';

/**
 * Compte MyLife dans MyPerf. Sur le web (PWA MyLife), même adresse que MyFinances : la session est
 * partagée (une seule connexion). Dans l'app Android, elle est gardée dans le stockage sécurisé.
 */
export const MYLIFE_URL = 'https://mylife-liart.vercel.app';
const SESSION_KEY = 'mylife-session';
const web = RN.OS === 'web';

let cached: Session | null | undefined;

async function read(): Promise<Session | null> {
  try {
    const raw = web ? localStorage.getItem(SESSION_KEY) : await SecureStore.getItemAsync(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

/** Session courante (relue une fois, puis gardée en mémoire ; le web suit les autres onglets/apps). */
export async function currentSession(): Promise<Session | null> {
  if (web || cached === undefined) {
    const first = cached === undefined;
    cached = await read();
    if (first && cached) await adoptThisDevice(cached.login);
  }
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
    const raw = web ? localStorage.getItem(RECOVERY_KEY) : await SecureStore.getItemAsync(RECOVERY_KEY.replace(':', '.'));
    return raw ? (JSON.parse(raw) as PendingRecovery) : null;
  } catch {
    return null;
  }
}

export async function writePendingRecovery(p: { login: string; key: string } | null): Promise<void> {
  const raw = p ? JSON.stringify({ ...p, at: Date.now() }) : null;
  try {
    if (web) {
      if (raw) localStorage.setItem(RECOVERY_KEY, raw);
      else localStorage.removeItem(RECOVERY_KEY);
    } else if (raw) await SecureStore.setItemAsync(RECOVERY_KEY.replace(':', '.'), raw);
    else await SecureStore.deleteItemAsync(RECOVERY_KEY.replace(':', '.'));
  } catch {
    /* stockage indisponible */
  }
}

/**
 * Un autre compte que le précédent se connecte : la clé d'IA et les traces du précédent sont effacées
 * (sur le web, `claimDevice` : commun à toutes les apps ; sur le téléphone, le trousseau de MyPerf).
 */
const OWNER_KEY = 'mylife.device-owner';
async function claimThisDevice(login: string): Promise<void> {
  if (web) return claimDevice(login);
  try {
    if ((await SecureStore.getItemAsync(OWNER_KEY)) === login) return;
    await SecureStore.deleteItemAsync('anthropic_api_key');
    await SecureStore.setItemAsync(OWNER_KEY, login);
  } catch {
    /* trousseau indisponible */
  }
}

/** Appareil déjà connecté avant cette règle : la session en cours en est la propriétaire. */
export async function adoptThisDevice(login: string): Promise<void> {
  if (web) return adoptDevice(login);
  try {
    if ((await SecureStore.getItemAsync(OWNER_KEY)) === null) await SecureStore.setItemAsync(OWNER_KEY, login);
  } catch {
    /* trousseau indisponible */
  }
}

export const platform: Platform = {
  api: new MyLifeApi(web ? '' : MYLIFE_URL),
  random: (n) => getRandomBytes(n),
  sessions: {
    get: currentSession,
    set: async (s) => {
      if (s) await claimThisDevice(s.login);
      cached = s;
      const raw = s ? JSON.stringify(s) : null;
      if (web) {
        try {
          if (raw) localStorage.setItem(SESSION_KEY, raw);
          else localStorage.removeItem(SESSION_KEY);
        } catch {
          /* stockage indisponible */
        }
      } else if (raw) await SecureStore.setItemAsync(SESSION_KEY, raw);
      else await SecureStore.deleteItemAsync(SESSION_KEY);
    },
  },
};
