import { useSyncExternalStore } from 'react';
import { ApiError } from '@mylife/core/account';
import { accountStatus, autoJoin, join, syncNow, type JoinMode, type LocalStore } from '@mylife/core/engine';
import { currentSession, onSessionChange, webPlatform as platform } from '@mylife/core/web';
import { facts, factsPending, factsStore, onFactsQueued } from './facts';
import { onStateQueued, statePending, stateStore, stateTouched } from './stateStore';

/**
 * La synchro chiffrée de MyFinances entre les appareils du compte : les faits (app `finances`, partagée avec
 * l'ancienne app) et les réglages du moteur (app `finances5`). Déclenchée au lancement, après une modification, au
 * retour sur l'app, au retour du réseau, et toutes les trois minutes. Un appareil est relié tout seul quand il n'y a
 * pas d'ambiguïté ; sinon `choice` demande quoi garder (jamais de fusion de deux historiques).
 */
type Part = 'facts' | 'state';
const PARTS: Record<Part, { store: LocalStore; hasData: () => Promise<boolean>; pending: () => number }> = {
  facts: {
    store: factsStore(),
    hasData: async () => (await facts.transactions.count()) > 0 || (await facts.accounts.count()) > 0 || (await facts.table('portfolios').count()) > 0 || (await facts.connections.count()) > 0,
    pending: factsPending,
  },
  state: { store: stateStore(), hasData: stateTouched, pending: statePending },
};

export interface CloudState {
  signedIn: boolean;
  syncing: boolean;
  error: string | null;
  lastSyncAt: number | null;
  pending: number;
  /** Le compte et l'appareil ont chacun des données : l'utilisateur choisit lesquelles garder. */
  choice: { part: Part; account: number; lastUpdated: number | null } | null;
}

let state: CloudState = { signedIn: !!currentSession(), syncing: false, error: null, lastSyncAt: null, pending: 0, choice: null };
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

/**
 * Les données d'un autre compte que celui qui est connecté ne sont jamais montrées : elles sont effacées de
 * l'appareil avant toute lecture, même hors ligne. L'appareil reprendra ensuite ce que garde le compte connecté.
 */
let firstLook = true;

export async function dropForeign(): Promise<void> {
  const session = currentSession();
  if (!session) return;
  const first = firstLook;
  firstLook = false;
  for (const [part, { store, hasData }] of Object.entries(PARTS)) {
    const local = await store.getState();
    if (local?.joinedAs === session.login) continue;
    // Les faits d'avant tout compte (l'app d'avant pouvait servir sans compte) : un compte ne les reprend jamais, il
    // part de zéro. Les réglages du moteur, eux, n'ont jamais existé hors d'un compte : seuls ceux d'un autre compte partent.
    // Une seule fois, à la première lecture et avant toute synchro : pendant qu'un appareil rejoint le compte, ses
    // faits arrivent alors qu'il n'est pas encore marqué relié, et ne doivent surtout pas être effacés.
    if (!local?.joinedAs && (part !== 'facts' || !first || current || !(await hasData()))) continue;
    await store.forget?.();
    if (local) await store.setState({ ...local, cursor: 0, joinedAs: null, lastSyncAt: null });
  }
}

const offline = () => typeof navigator !== 'undefined' && !navigator.onLine;
let current: Promise<boolean> | null = null;

/** Un passage : relie ce qui ne l'est pas encore, puis envoie et reçoit. Vrai si tout est passé. Un seul à la fois. */
export function syncCloud(): Promise<boolean> {
  current ??= pass().finally(() => {
    current = null;
  });
  return current;
}

/** Les réglages du compte sont-ils encore à venir sur cet appareil (connecté, en ligne, pas encore relié) ? */
export async function stateToCome(): Promise<boolean> {
  const session = currentSession();
  if (!session || offline() || state.choice?.part === 'state') return false;
  return (await PARTS.state.store.getState())?.joinedAs !== session.login;
}

async function pass(): Promise<boolean> {
  const session = currentSession();
  set({ signedIn: !!session, pending: factsPending() + statePending(), ...(session ? {} : { choice: null, error: null }) });
  if (!session || offline()) return false;
  set({ syncing: true, error: null });
  let ok = true;
  try {
    for (const part of Object.keys(PARTS) as Part[]) {
      const { store, hasData } = PARTS[part];
      const local = await store.getState();
      if (local?.joinedAs !== session.login) {
        if (state.choice?.part === part) {
          ok = false;
          continue;
        }
        const r = await autoJoin(store, platform.api, session, platform.random, hasData);
        if (r.action === 'ask') {
          // Un compte vide n'a rien à opposer : l'appareil y met ses données.
          if (r.account === 0) await join(store, platform.api, session, platform.random, 'useDevice');
          else {
            set({ choice: { part, account: r.account, lastUpdated: r.lastUpdated } });
            ok = false;
          }
        }
        continue;
      }
      await syncNow(store, platform.api, session, platform.random);
    }
    const last = Math.max(...(await Promise.all((Object.keys(PARTS) as Part[]).map(async (p) => (await PARTS[p].store.getState())?.lastSyncAt ?? 0))));
    set({ lastSyncAt: last || null });
  } catch (e) {
    ok = false;
    set({ error: e instanceof ApiError && e.status === 401 ? 'Session expirée : reconnecte-toi.' : e instanceof Error ? e.message : String(e) });
  } finally {
    set({ syncing: false, pending: factsPending() + statePending() });
  }
  return ok;
}

/** Tranche le choix : garder les données de l'appareil, ou prendre celles du compte. */
export async function resolveChoice(mode: Exclude<JoinMode, 'auto'>): Promise<void> {
  const session = currentSession();
  const choice = state.choice;
  if (!session || !choice) return;
  set({ syncing: true, error: null });
  try {
    await join(PARTS[choice.part].store, platform.api, session, platform.random, mode);
    set({ choice: null });
  } catch (e) {
    set({ error: e instanceof Error ? e.message : String(e) });
  } finally {
    set({ syncing: false });
  }
  void syncCloud();
}

/** Ce que le compte garde pour une partie (pour éclairer le choix). */
export async function cloudStatus(part: Part): Promise<{ count: number; lastUpdated: number | null }> {
  const session = currentSession();
  if (!session) throw new Error('Pas connecté.');
  return accountStatus(platform.api, session, PARTS[part].store.app);
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

let booted = false;

/** Au premier écran de MyFinances : récupère ce que les autres appareils ont fait, puis surveille. */
export function cloudBoot(): void {
  if (booted || typeof window === 'undefined') return;
  booted = true;
  const changed = () => {
    set({ pending: factsPending() + statePending() });
    syncSoon();
  };
  onFactsQueued(changed);
  onStateQueued(changed);
  onSessionChange(() => syncSoon(0));
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && syncSoon(500));
  window.addEventListener('online', () => syncSoon(500));
  setInterval(() => document.visibilityState === 'visible' && syncSoon(0), 180_000);
  void syncCloud();
}
