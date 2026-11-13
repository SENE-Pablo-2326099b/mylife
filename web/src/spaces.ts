import { useSyncExternalStore } from 'react';
import { SpaceClient, type Space } from './vendor/mylife-sync';
import { currentSession, onSessionChange, webPlatform } from './vendor/mylife-sync/web';

/**
 * Les espaces partagés de l'accueil (chiffrés de bout en bout, serveur : server/space.ts) : depuis la V5, seulement
 * les Sorties (espaces de type « sortie »). Les autres types (Crew, liste du foyer) ne sont plus montrés ; ils restent
 * sur le serveur tant que leurs membres ne les quittent pas.
 */

/** Lien d'invitation commun à tous les espaces : la page de jonction lit le type. */
export const SPACE_URL = () => `${location.origin}/rejoindre`;
const PENDING_INVITE = 'mylife:crew-invite';

export function client(): SpaceClient | null {
  const s = currentSession();
  return s ? new SpaceClient(webPlatform.api, s, webPlatform.random) : null;
}

interface SpacesState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  uid: string | null;
  /** Les Sorties (espaces de type « sortie »). */
  sorties: Space[];
  error: string | null;
}

let state: SpacesState = { status: 'idle', uid: null, sorties: [], error: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<SpacesState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

onSessionChange(() => set({ status: 'idle', uid: null, sorties: [], error: null }));

export function useSpaces(): SpacesState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export async function loadSpaces(): Promise<SpacesState> {
  const c = client();
  if (!c) return state;
  if (state.status !== 'ready') set({ status: 'loading', error: null });
  try {
    const r = await c.list();
    set({ status: 'ready', uid: r.uid, sorties: r.spaces.filter((s) => s.kind === 'sortie'), error: null });
  } catch (e) {
    set({ status: state.sorties.length ? 'ready' : 'error', error: e instanceof Error ? e.message : String(e) });
  }
  return state;
}

// ---------------------------------------------------------------- invitation reçue avant la connexion

/** Lien d'invitation ouvert sans être connecté : gardé le temps de créer son compte ou de se connecter. */
export function stashInvite(hash: string): void {
  try {
    if (hash.includes('espace=')) sessionStorage.setItem(PENDING_INVITE, hash);
  } catch {
    /* rien */
  }
}

export function takeStashedInvite(): string | null {
  try {
    const v = sessionStorage.getItem(PENDING_INVITE);
    if (v) sessionStorage.removeItem(PENDING_INVITE);
    return v;
  } catch {
    return null;
  }
}
