import { useSyncExternalStore } from 'react';
import { db } from '../../db/db';
import { exportBackup } from '../../domain/backup';
import { ApiError, accountStatus, autoJoin, join, syncNow, type JoinMode, type Session } from '../../vendor/mylife-sync';
import { currentSession, onSessionChange, webPlatform as platform } from '../../vendor/mylife-sync/web';
import { changeTracker, dexieStore, onLocalChange, pendingCount } from './dexieStore';

/**
 * Compte MyLife et synchronisation chiffrée de MyFinances : état pour l'interface et déclenchement
 * automatique (lancement, après une modification, retour sur l'app, retour du réseau, toutes les 3 min).
 * Le compte lui-même (création, connexion, gestion) est commun à toutes les apps : src/ui/account.tsx.
 * Dès qu'une session apparaît (connexion ici ou dans une autre app), l'appareil est relié tout seul
 * quand il n'y a pas d'ambiguïté ; sinon `choice` demande lequel garder.
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
  /** Compte et appareil ont chacun des données : l'utilisateur choisit lesquelles garder. */
  choice: { account: number; lastUpdated: number | null } | null;
}

let state: CloudState = { session: currentSession(), joined: false, syncing: false, error: null, lastSyncAt: null, pending: 0, choice: null };
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
  const joined = !!session && s?.joinedAs === session.login;
  set({ session, joined, lastSyncAt: s?.lastSyncAt ?? null, pending: pendingCount(), ...(session ? {} : { choice: null, error: null }) });
}

/** Des données saisies sur cet appareil (pas seulement les réglages par défaut d'une app neuve) ? */
async function deviceHasData(): Promise<boolean> {
  const settings = await db.settings.get('main');
  return !!settings?.onboarded || (await db.transactions.count()) > 0 || (await db.portfolios.count()) > 0 || (await db.connections.count()) > 0;
}

let joining = false;

/** Session présente, appareil pas encore relié : on le relie sans rien demander quand c'est sans ambiguïté. */
async function ensureJoined(): Promise<void> {
  await refreshState();
  if (!state.session || state.joined || joining || state.choice) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  joining = true;
  set({ syncing: true, error: null });
  try {
    const r = await autoJoin(store, platform.api, state.session, platform.random, deviceHasData);
    if (r.action === 'ask') set({ choice: { account: r.account, lastUpdated: r.lastUpdated } });
    await refreshState();
  } catch (e) {
    set({ error: e instanceof Error ? e.message : String(e) });
  } finally {
    joining = false;
    set({ syncing: false });
  }
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
  if (state.session && !state.joined) {
    await ensureJoined();
    return state.joined;
  }
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
  onSessionChange(() => void ensureJoined());
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && syncSoon(500));
  window.addEventListener('online', () => syncSoon(500));
  setInterval(() => document.visibilityState === 'visible' && syncSoon(0), 180_000);
  await syncCloud();
}

// ---------------------------------------------------------------- relier l'appareil

export async function cloudAccountStatus(): Promise<{ count: number; lastUpdated: number | null }> {
  const session = currentSession();
  if (!session) throw new Error('Pas connecté.');
  return accountStatus(platform.api, session, 'finances');
}

/** Nombre d'éléments synchronisables sur cet appareil (pour choisir lesquels garder). */
export async function localItemCount(): Promise<number> {
  return (await store.snapshot()).length;
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
    set({ choice: null });
    await refreshState();
    return r;
  } finally {
    set({ syncing: false });
  }
}
