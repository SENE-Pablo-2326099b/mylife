import { useSyncExternalStore } from 'react';
import { ApiError } from '@mylife/core/account';
import { autoJoin, join, syncNow, type JoinMode } from '@mylife/core/engine';
import { currentSession, onSessionChange, webPlatform as platform } from '@mylife/core/web';
import { call, perfStore } from './client';

/**
 * La synchro chiffrée de MyPerf (app `perf`, la même que l'app d'avant) pour le module : au lancement, au retour sur
 * l'app, au retour du réseau, toutes les trois minutes, et à la fin de chaque séance (étape P2). Un appareil est
 * relié tout seul quand il n'y a pas d'ambiguïté ; sinon `choice` demande quoi garder (jamais de fusion).
 */
const store = perfStore();

export interface CloudState {
  signedIn: boolean;
  syncing: boolean;
  error: string | null;
  lastSyncAt: number | null;
  /** Une passe est allée au bout au moins une fois depuis l'ouverture. */
  synced: boolean;
  choice: { account: number; lastUpdated: number | null } | null;
}

let state: CloudState = { signedIn: !!currentSession(), syncing: false, error: null, lastSyncAt: null, synced: false, choice: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<CloudState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

export function useCloud(): CloudState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

/** Les données d'un autre compte ne sont jamais montrées : effacées de l'appareil avant toute lecture. */
export async function dropForeign(): Promise<void> {
  const session = currentSession();
  if (!session) return;
  const local = await store.getState();
  if (!local?.joinedAs || local.joinedAs === session.login) return;
  await store.forget?.();
  await store.setState({ ...local, cursor: 0, joinedAs: null, lastSyncAt: null });
}

const offline = () => typeof navigator !== 'undefined' && !navigator.onLine;
let current: Promise<boolean> | null = null;

/** Un passage : relie l'appareil s'il ne l'est pas, puis envoie et reçoit. Un seul à la fois. */
export function syncCloud(): Promise<boolean> {
  current ??= pass().finally(() => {
    current = null;
  });
  return current;
}

async function pass(): Promise<boolean> {
  const session = currentSession();
  set({ signedIn: !!session, ...(session ? {} : { choice: null, error: null }) });
  if (!session || offline()) return false;
  set({ syncing: true, error: null });
  let ok = true;
  try {
    await dropForeign();
    const local = await store.getState();
    if (local?.joinedAs !== session.login) {
      if (state.choice) return false;
      const r = await autoJoin(store, platform.api, session, platform.random, () => call('hasData'));
      if (r.action === 'ask') {
        if (r.account === 0) await join(store, platform.api, session, platform.random, 'useDevice');
        else {
          set({ choice: { account: r.account, lastUpdated: r.lastUpdated } });
          ok = false;
        }
      }
    } else {
      await syncNow(store, platform.api, session, platform.random);
    }
    set({ lastSyncAt: (await store.getState())?.lastSyncAt ?? null, synced: ok });
  } catch (e) {
    ok = false;
    set({ error: e instanceof ApiError && e.status === 401 ? 'Session expirée : reconnecte-toi.' : e instanceof Error ? e.message : String(e) });
  } finally {
    set({ syncing: false });
  }
  return ok;
}

/** Tranche le choix : garder les données de l'appareil, ou prendre celles du compte. */
export async function resolveChoice(mode: Exclude<JoinMode, 'auto'>): Promise<void> {
  const session = currentSession();
  if (!session || !state.choice) return;
  set({ syncing: true, error: null });
  try {
    await join(store, platform.api, session, platform.random, mode);
    set({ choice: null });
  } catch (e) {
    set({ error: e instanceof Error ? e.message : String(e) });
  } finally {
    set({ syncing: false });
  }
  void syncCloud();
}

let timer: ReturnType<typeof setTimeout> | null = null;
export function syncSoon(delay = 4000): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void syncCloud();
  }, delay);
}

let booted = false;
/** Au premier écran du module : récupère ce que les autres appareils ont fait, puis surveille. */
export function cloudBoot(): void {
  if (booted || typeof window === 'undefined') return;
  booted = true;
  onSessionChange(() => syncSoon(0));
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && syncSoon(500));
  window.addEventListener('online', () => syncSoon(500));
  setInterval(() => document.visibilityState === 'visible' && syncSoon(0), 180_000);
  void syncCloud();
}
