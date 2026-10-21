import { getRandomBytes } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform as RN } from 'react-native';

import { MyLifeApi, type Platform, type Session } from '@/vendor/mylife-sync';

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
  if (web || cached === undefined) cached = await read();
  return cached;
}

export const platform: Platform = {
  api: new MyLifeApi(web ? '' : MYLIFE_URL),
  random: (n) => getRandomBytes(n),
  sessions: {
    get: currentSession,
    set: async (s) => {
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
