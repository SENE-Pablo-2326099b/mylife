import { useSyncExternalStore } from 'react';
import { db } from '../../db/db';
import { exportBackup } from '../../domain/backup';
import { ApiError, accountStatus, changePassword, createAccount, join, recoverAccount, signIn, signOut, syncNow, type JoinMode, type Session } from '../../vendor/mylife-sync';
import { changeTracker, dexieStore, onLocalChange, pendingCount } from './dexieStore';
import { currentSession, onSessionChange, platform } from './platform';

/**
 * Compte MyLife et synchronisation chiffrée de MyFinances : état pour l'interface et déclenchement
 * automatique (lancement, après une modification, retour sur l'app, retour du réseau, toutes les 3 min).
 */

// Suivi des modifications : installé avant la première ouverture de la base.
db.use(changeTracker);

const store = dexieStore();

export interface CloudState {
  session: Session | null;
  /** Cet appareil est relié au compte (première synchro faite). */
  joined: boolean;
  syncing: boolean;
  error: string | null;
  lastSyncAt: number | null;
  pending: number;
}

let state: CloudState = { session: currentSession(), joined: false, syncing: false, error: null, lastSyncAt: null, pending: 0 };
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

async function refreshState() {
  const session = currentSession();
  const s = await store.getState();
  set({ session, joined: !!session && s?.joinedAs === session.login, lastSyncAt: s?.lastSyncAt ?? null, pending: pendingCount() });
}

let timer: ReturnType<typeof setTimeout> | null = null;

/** Synchro dans `delay` ms (les demandes rapprochées se regroupent). */
export function syncSoon(delay = 4000): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void syncCloud();
  }, delay);
}

export async function syncCloud(): Promise<boolean> {
  await refreshState();
  if (!state.session || !state.joined || state.syncing) return false;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
  set({ syncing: true, error: null });
  try {
    await syncNow(store, platform.api, state.session, platform.random);
    await refreshState();
    set({ syncing: false });
    return true;
  } catch (e) {
    const expired = e instanceof ApiError && e.status === 401;
    set({ syncing: false, error: expired ? 'Session expirée : reconnecte-toi.' : e instanceof Error ? e.message : String(e) });
    return false;
  }
}

let booted = false;

/** Au lancement : récupère d'abord ce que les autres appareils ont fait, puis surveille. */
export async function cloudBoot(): Promise<void> {
  if (booted) return;
  booted = true;
  onLocalChange(() => {
    set({ pending: pendingCount() });
    syncSoon();
  });
  onSessionChange(() => void refreshState());
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && syncSoon(500));
  window.addEventListener('online', () => syncSoon(500));
  setInterval(() => document.visibilityState === 'visible' && syncSoon(0), 180_000);
  await syncCloud();
}

// ---------------------------------------------------------------- actions du compte

export async function cloudSignIn(login: string, password: string): Promise<void> {
  await signIn(platform, { login, password });
  await refreshState();
}

export async function cloudCreate(login: string, password: string, invite: string): Promise<string> {
  const { recoveryKey } = await createAccount(platform, { login, password, invite });
  await refreshState();
  return recoveryKey;
}

export async function cloudRecover(login: string, recoveryKey: string, newPassword: string): Promise<void> {
  await recoverAccount(platform, { login, recoveryKey, newPassword });
  await refreshState();
}

export async function cloudChangePassword(newPassword: string): Promise<void> {
  const session = currentSession();
  if (!session) throw new Error('Pas connecté.');
  await changePassword(platform, session, newPassword);
}

/** Déconnexion de cet appareil : les données restent sur l'appareil, la synchro s'arrête. */
export async function cloudSignOut(): Promise<void> {
  await signOut(platform);
  const s = await store.getState();
  if (s) await store.setState({ ...s, joinedAs: null, cursor: 0 });
  await refreshState();
}

export async function cloudAccountStatus(): Promise<{ count: number; lastUpdated: number | null }> {
  const session = currentSession();
  if (!session) throw new Error('Pas connecté.');
  return accountStatus(platform.api, session, 'finances');
}

/** Données de l'appareil téléchargées en JSON (filet de sécurité avant un remplacement). */
export async function downloadLocalCopy(): Promise<void> {
  if ((await db.transactions.count()) === 0 && (await db.portfolios.count()) === 0) return;
  const blob = new Blob([JSON.stringify(await exportBackup())], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `myfinances-avant-synchro-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Relie l'appareil au compte : envoie ses données (compte vide) ou prend celles du compte. */
export async function cloudJoin(mode: JoinMode = 'auto'): Promise<{ action: 'uploaded' | 'downloaded'; count: number }> {
  const session = currentSession();
  if (!session) throw new Error('Pas connecté.');
  set({ syncing: true, error: null });
  try {
    const r = await join(store, platform.api, session, platform.random, mode);
    await refreshState();
    return r;
  } finally {
    set({ syncing: false });
  }
}
