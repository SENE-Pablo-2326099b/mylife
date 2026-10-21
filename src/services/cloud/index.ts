import { AppState, Platform } from 'react-native';
import { create } from 'zustand';

import { subscribeData } from '@/db/db';
import { useSettings } from '@/state/settingsStore';
import { useWorkoutStore } from '@/state/workoutStore';
import { ApiError, accountStatus, changePassword, createAccount, join, recoverAccount, signIn, signOut, syncNow, type JoinMode, type Session } from '@/vendor/mylife-sync';

import { currentSession, platform } from './platform';
import { pendingCount, sqliteStore } from './sqliteStore';

/**
 * Compte MyLife et synchronisation chiffrée de MyPerf (téléphone et web) : état pour l'interface et
 * déclenchement automatique (lancement, après une modification, retour sur l'app, toutes les 3 min).
 */

const store = sqliteStore();

export interface CloudState {
  session: Session | null;
  joined: boolean;
  syncing: boolean;
  error: string | null;
  lastSyncAt: number | null;
  pending: number;
}

export const useCloud = create<CloudState>(() => ({ session: null, joined: false, syncing: false, error: null, lastSyncAt: null, pending: 0 }));
const set = (patch: Partial<CloudState>) => useCloud.setState(patch);

async function refreshState() {
  const session = await currentSession();
  const s = await store.getState();
  set({ session, joined: !!session && s?.joinedAs === session.login, lastSyncAt: s?.lastSyncAt ?? null, pending: pendingCount() });
}

/** Après des données reçues : les écrans relisent la base, les stores en mémoire repartent d'elle. */
function reloadStores() {
  useSettings.getState().hydrate();
  useWorkoutStore.setState({ docs: {} });
}

let timer: ReturnType<typeof setTimeout> | null = null;
export function syncSoon(delay = 4000): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void syncCloud();
  }, delay);
}

export async function syncCloud(): Promise<boolean> {
  await refreshState();
  const { session, joined, syncing } = useCloud.getState();
  if (!session || !joined || syncing) return false;
  set({ syncing: true, error: null });
  try {
    const r = await syncNow(store, platform.api, session, platform.random);
    if (r.pulled > 0) reloadStores();
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
/** Après l'ouverture de la base : récupère ce que les autres appareils ont fait, puis surveille. */
export function cloudBoot(): void {
  if (booted) return;
  booted = true;
  // Chaque écriture en base : s'il y a des modifications à envoyer, synchro quelques secondes après.
  subscribeData(() => {
    const n = pendingCount();
    if (n !== useCloud.getState().pending) set({ pending: n });
    if (n > 0) syncSoon();
  });
  AppState.addEventListener('change', (s) => s === 'active' && syncSoon(500));
  if (Platform.OS === 'web') window.addEventListener('online', () => syncSoon(500));
  setInterval(() => AppState.currentState === 'active' && syncSoon(0), 180_000);
  void syncCloud();
}

// ---------------------------------------------------------------- actions du compte

export async function cloudSignIn(login: string, password: string) {
  await signIn(platform, { login, password });
  await refreshState();
}

export async function cloudCreate(login: string, password: string, invite: string): Promise<string> {
  const { recoveryKey } = await createAccount(platform, { login, password, invite });
  await refreshState();
  return recoveryKey;
}

export async function cloudRecover(login: string, recoveryKey: string, newPassword: string) {
  await recoverAccount(platform, { login, recoveryKey, newPassword });
  await refreshState();
}

export async function cloudChangePassword(newPassword: string) {
  const session = await currentSession();
  if (!session) throw new Error('Pas connecté.');
  await changePassword(platform, session, newPassword);
}

export async function cloudSignOut() {
  await signOut(platform);
  const s = await store.getState();
  if (s) await store.setState({ ...s, joinedAs: null, cursor: 0 });
  await refreshState();
}

export async function cloudAccountStatus() {
  const session = await currentSession();
  if (!session) throw new Error('Pas connecté.');
  return accountStatus(platform.api, session, 'perf');
}

export async function cloudJoin(mode: JoinMode = 'auto') {
  const session = await currentSession();
  if (!session) throw new Error('Pas connecté.');
  set({ syncing: true, error: null });
  try {
    const r = await join(store, platform.api, session, platform.random, mode);
    if (r.action === 'downloaded') reloadStores();
    await refreshState();
    return r;
  } finally {
    set({ syncing: false });
  }
}

/** Nombre d'éléments synchronisables sur cet appareil (pour choisir lesquels garder). */
export async function localItemCount(): Promise<number> {
  return (await store.snapshot()).length;
}

export { refreshState as refreshCloud };
