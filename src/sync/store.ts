import { useSyncExternalStore } from 'react';
import { db, getMeta } from '../db/db';
import { getSettings } from '../db/seed';
import { EbClient } from './ebClient';
import { syncBankBuys } from '../domain/wealthDb';
import { EnableBankingSource } from './enableBankingSource';
import { syncAll, type AccountSyncReport } from './syncEngine';

interface SyncState {
  syncing: boolean;
  reports: AccountSyncReport[] | null;
  error: string | null;
  finishedAt: number | null;
}

let state: SyncState = { syncing: false, reports: null, error: null, finishedAt: null };
const listeners = new Set<() => void>();

function set(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export async function getClient(): Promise<EbClient | null> {
  const s = await getSettings();
  return s.bridgePassword ? new EbClient(s.bridgePassword) : null;
}

export async function hasBankAccounts(): Promise<boolean> {
  return (await db.accounts.where('source').equals('enablebanking').count()) > 0;
}

export async function runSync(): Promise<AccountSyncReport[] | null> {
  if (state.syncing) return null;
  set({ syncing: true, error: null });
  try {
    const settings = await getSettings();
    if (!settings.bridgePassword) throw new Error('Saisis le mot de passe du relais dans Synchro.');
    const reports = await syncAll(new EnableBankingSource(new EbClient(settings.bridgePassword)), settings);
    // Nouveaux prélèvements Bitstack (ou autre ligne reliée à la banque) → achats.
    await syncBankBuys().catch(() => 0);
    set({ syncing: false, reports, finishedAt: Date.now() });
    return reports;
  } catch (e) {
    set({ syncing: false, error: e instanceof Error ? e.message : String(e), finishedAt: Date.now() });
    return null;
  }
}

/** Synchro automatique à l'ouverture si la dernière date de plus de `autoSyncHours`. */
export async function maybeAutoSync(): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  const settings = await getSettings();
  if (!settings.autoSyncHours || !settings.bridgePassword || !(await hasBankAccounts())) return;
  const last = (await getMeta<number>('lastSyncAt')) ?? 0;
  if (Date.now() - last < settings.autoSyncHours * 3600_000) return;
  await runSync();
}
