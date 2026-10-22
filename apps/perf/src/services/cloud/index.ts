import { AppState, Platform } from 'react-native';
import { create } from 'zustand';

import { db, subscribeData } from '@/db/db';
import { useSettings } from '@/state/settingsStore';
import { useWorkoutStore } from '@/state/workoutStore';
import { ApiError, accountStatus, autoJoin, changePassword, createAccount, deleteAccount, join, recoverAccount, renewRecoveryKey, signIn, signOut, syncNow, type JoinMode, type Session } from '@/vendor/mylife-sync';

import { personalHistoryEnd } from '@/import/importer';

import { currentSession, platform, readPendingRecovery, writePendingRecovery, type PendingRecovery } from './platform';
import { syncPrefs, syncPrefsSoon, watchAppearance } from './prefs';
import { pendingCount, sqliteStore } from './sqliteStore';

/**
 * Compte MyLife et synchronisation chiffrée de MyPerf (téléphone et web) : état pour l'interface et
 * déclenchement automatique (lancement, après une modification, retour sur l'app, toutes les 3 min).
 * Comme dans les apps web : dès qu'une session apparaît, l'appareil est relié sans question quand
 * c'est sans ambiguïté ; sinon `choice` demande lesquelles garder.
 */

const store = sqliteStore();

export interface CloudState {
  session: Session | null;
  joined: boolean;
  syncing: boolean;
  error: string | null;
  lastSyncAt: number | null;
  pending: number;
  /** Compte et appareil ont chacun des données : l'utilisateur choisit lesquelles garder. */
  choice: { account: number; lastUpdated: number | null } | null;
  /** Clé de secours pas encore mise de côté. */
  recovery: PendingRecovery | null;
}

export const useCloud = create<CloudState>(() => ({ session: null, joined: false, syncing: false, error: null, lastSyncAt: null, pending: 0, choice: null, recovery: null }));
const set = (patch: Partial<CloudState>) => useCloud.setState(patch);

async function refreshState() {
  const session = await currentSession();
  if (session && session.login !== useCloud.getState().session?.login) void syncPrefs();
  const s = await store.getState();
  const recovery = session ? await readPendingRecovery() : null;
  const joined = !!session && s?.joinedAs === session.login;
  set({ session, joined, lastSyncAt: s?.lastSyncAt ?? null, pending: pendingCount(), recovery: recovery?.login === session?.login ? recovery : null, ...(session ? {} : { choice: null, error: null }) });
  // L'accueil MyLife (même adresse sur le web) affiche l'état de la synchro de chaque app.
  if (Platform.OS === 'web') {
    try {
      localStorage.setItem('mylife-sync-perf', JSON.stringify({ joinedAs: joined ? session!.login : null, lastSyncAt: s?.lastSyncAt ?? null }));
    } catch {
      /* stockage indisponible */
    }
  }
}

/** Des séances saisies sur cet appareil (au-delà de l'historique personnel importé à l'installation) ? */
async function deviceHasData(): Promise<boolean> {
  return (db().first<{ n: number }>('SELECT COUNT(*) AS n FROM workouts WHERE date > ?', [personalHistoryEnd()])?.n ?? 0) > 0;
}

let joining = false;

/** Session présente, appareil pas encore relié : on le relie sans rien demander quand c'est sans ambiguïté. */
async function ensureJoined(): Promise<void> {
  await refreshState();
  const { session, joined, choice } = useCloud.getState();
  if (!session || joined || joining || choice) return;
  joining = true;
  set({ syncing: true, error: null });
  try {
    const r = await autoJoin(store, platform.api, session, platform.random, deviceHasData);
    if (r.action === 'ask') set({ choice: { account: r.account, lastUpdated: r.lastUpdated } });
    if (r.action === 'downloaded') reloadStores();
    await refreshState();
  } catch (e) {
    set({ error: e instanceof Error ? e.message : String(e) });
  } finally {
    joining = false;
    set({ syncing: false });
  }
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
  if (useCloud.getState().session && !useCloud.getState().joined) {
    await ensureJoined();
    return useCloud.getState().joined;
  }
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
  AppState.addEventListener('change', (s) => {
    if (s !== 'active') return;
    syncSoon(500);
    syncPrefsSoon(500);
  });
  // L'apparence de MyLife suit d'un appareil à l'autre (réglage commun à toutes les apps).
  watchAppearance();
  syncPrefsSoon(800);
  if (Platform.OS === 'web') {
    window.addEventListener('online', () => syncSoon(500));
    // Connexion ou déconnexion dans une autre app MyLife du même navigateur.
    window.addEventListener('storage', (e) => (e.key === 'mylife-session' || e.key === 'mylife:recovery-pending') && void ensureJoined());
  }
  setInterval(() => AppState.currentState === 'active' && syncSoon(0), 180_000);
  void syncCloud();
}

// ---------------------------------------------------------------- actions du compte (les mêmes que dans les apps web)

/** Création en un écran ; la session n'est ouverte qu'une fois la clé de secours rangée sur l'appareil. */
export async function cloudCreate(login: string, password: string): Promise<string> {
  const held = { ...platform, sessions: { get: platform.sessions.get, set: async () => undefined } };
  const { session, recoveryKey } = await createAccount(held, { login, password });
  await writePendingRecovery({ login: session.login, key: recoveryKey });
  await platform.sessions.set(session);
  await ensureJoined();
  return recoveryKey;
}

export async function cloudSignIn(login: string, password: string) {
  await signIn(platform, { login, password });
  await ensureJoined();
}

export async function cloudRecover(login: string, recoveryKey: string, newPassword: string) {
  await recoverAccount(platform, { login, recoveryKey, newPassword });
  await ensureJoined();
}

export async function cloudChangePassword(newPassword: string) {
  const session = await currentSession();
  if (!session) throw new Error('Pas connecté.');
  await changePassword(platform, session, newPassword);
}

/** Nouvelle clé de secours (l'ancienne ne marche plus), gardée en attente jusqu'à « C'est fait ». */
export async function cloudRenewRecovery(): Promise<string> {
  const session = await currentSession();
  if (!session) throw new Error('Pas connecté.');
  const key = await renewRecoveryKey(platform, session);
  await writePendingRecovery({ login: session.login, key });
  await refreshState();
  return key;
}

export async function cloudRecoverySaved() {
  await writePendingRecovery(null);
  await refreshState();
}

/** Déconnexion de cet appareil (et des autres apps MyLife du navigateur) : les données restent ici. */
export async function cloudSignOut() {
  await signOut(platform);
  await writePendingRecovery(null);
  await refreshState();
}

/** Supprime le compte et ses données du serveur (mot de passe redemandé) ; l'appareil garde les siennes. */
export async function cloudDeleteAccount(password: string) {
  const session = await currentSession();
  if (!session) throw new Error('Pas connecté.');
  await deleteAccount(platform, session, password);
  await writePendingRecovery(null);
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
    set({ choice: null });
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
