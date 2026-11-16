import { useSyncExternalStore } from 'react';
import { addDays, todayISO, type ISODate } from '../core/dates';
import { bankSettings, facts, factsChanged, getMeta, setMeta, type BankSettings, type FactsDB, type RawAccount } from '../data/facts';
import { mergeTransactions } from './dedup';
import type { EbTransaction } from './ebTypes';
import { mapEbTransaction, pickBalance } from './mapping';
import { canUseRelay, Relay, SourceError, type IncomingTransaction } from './relay';

/**
 * La synchro bancaire : pour chaque compte relié, les opérations depuis la dernière fois (avec un recouvrement, pour
 * rattraper celles comptabilisées en retard), fusionnées sans doublon avec ce qui est déjà là, et le solde. Le
 * classement n'est pas fait ici : c'est le moteur qui range ce qui arrive (marchands, règles, virements internes).
 */
export interface AccountSyncReport {
  accountId: string;
  accountName: string;
  added: number;
  duplicates: number;
  pending: number;
  settled: number;
  error?: string;
  expired?: boolean;
}

export const SYNC_OVERLAP_DAYS = 7;
const MAX_PAGES = 50;

export interface FetchResult {
  transactions: IncomingTransaction[];
  balance: { amount: number; date: string } | null;
}
/** Ce qui va chercher les opérations d'un compte (le relais ; un faux dans les tests). */
export type Fetcher = (account: RawAccount, since: ISODate, until: ISODate) => Promise<FetchResult>;

export function relayFetcher(relay: Relay): Fetcher {
  return async (account, since, until) => {
    if (!account.remoteUid) throw new SourceError('Compte sans accès actif : reconnecte la banque.', true);
    const raw: EbTransaction[] = [];
    let key: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await relay.transactionsPage(account.remoteUid, since, until, key);
      raw.push(...(res.transactions ?? []));
      if (!res.continuation_key) break;
      key = res.continuation_key;
    }
    let balance: FetchResult['balance'] = null;
    try {
      balance = pickBalance(await relay.balances(account.remoteUid));
    } catch (e) {
      if (e instanceof SourceError && e.sessionExpired) throw e;
    }
    return { transactions: raw.map(mapEbTransaction).filter((t): t is IncomingTransaction => t !== null), balance };
  };
}

export function computeSince(account: Pick<RawAccount, 'lastSyncAt'>, pendingDates: ISODate[], today: ISODate, initialSyncDays: number): ISODate {
  let since = account.lastSyncAt ? addDays(todayISO(new Date(account.lastSyncAt)), -SYNC_OVERLAP_DAYS) : addDays(today, -initialSyncDays);
  for (const d of pendingDates) if (d < since) since = d;
  return since;
}

export async function syncAccount(account: RawAccount, fetcher: Fetcher, settings: Pick<BankSettings, 'initialSyncDays'>, database: FactsDB = facts, now = new Date()): Promise<AccountSyncReport> {
  const today = todayISO(now);
  const report: AccountSyncReport = { accountId: account.id, accountName: account.nickname?.trim() || account.name, added: 0, duplicates: 0, pending: 0, settled: 0 };
  const existing = await database.transactions.where('accountId').equals(account.id).toArray();
  const since = computeSince(account, existing.filter((t) => t.pending).map((t) => t.date), today, settings.initialSyncDays);
  try {
    const fetched = await fetcher(account, since, today);
    const merge = mergeTransactions(account.id, existing, fetched.transactions, 'enablebanking', now.getTime());
    await database.transaction('rw', [database.transactions, database.accounts], async () => {
      if (merge.toDelete.length) await database.transactions.bulkDelete(merge.toDelete);
      if (merge.toAdd.length) await database.transactions.bulkPut(merge.toAdd);
      // Un remboursement rattaché à une dépense « en attente » suit la dépense devenue définitive.
      if (merge.renamed.length) {
        const renamed = new Map(merge.renamed);
        await database.transactions.filter((t) => !!t.refundOf && renamed.has(t.refundOf)).modify((t) => {
          t.refundOf = renamed.get(t.refundOf!) ?? t.refundOf;
        });
      }
      await database.accounts.update(account.id, { lastSyncAt: now.getTime(), lastSyncError: null, ...(fetched.balance ? { balance: fetched.balance.amount, balanceDate: fetched.balance.date } : {}) });
    });
    report.added = merge.newBooked;
    report.pending = merge.toAdd.filter((t) => t.pending).length;
    report.settled = merge.settled;
    report.duplicates = merge.duplicates;
  } catch (e) {
    const err = e instanceof SourceError ? e : new SourceError(e instanceof Error ? e.message : String(e));
    report.error = err.message;
    report.expired = err.sessionExpired;
    await database.accounts.update(account.id, { lastSyncError: err.message });
    if (err.sessionExpired && account.connectionId) await database.connections.update(account.connectionId, { status: 'expired' });
  }
  return report;
}

/** Synchronise tous les comptes reliés à une banque (comptes masqués exclus). */
export async function syncAll(fetcher: Fetcher, settings: Pick<BankSettings, 'initialSyncDays'>, database: FactsDB = facts, now = new Date()): Promise<AccountSyncReport[]> {
  const accounts = (await database.accounts.where('source').equals('enablebanking').toArray()).filter((a) => !a.hidden);
  const connections = new Map((await database.connections.toArray()).map((c) => [c.id, c]));
  const reports: AccountSyncReport[] = [];
  for (const account of accounts) {
    const conn = account.connectionId ? connections.get(account.connectionId) : undefined;
    if (!conn) continue;
    if (conn.status === 'active' && new Date(conn.validUntil).getTime() < now.getTime()) {
      await database.connections.update(conn.id, { status: 'expired' });
      conn.status = 'expired';
    }
    if (conn.status !== 'active') {
      reports.push({ accountId: account.id, accountName: account.nickname?.trim() || account.name, added: 0, duplicates: 0, pending: 0, settled: 0, error: 'Accès expiré : reconnecte la banque.', expired: true });
      continue;
    }
    reports.push(await syncAccount(account, fetcher, settings, database, now));
  }
  await setMeta('lastSyncAt', now.getTime(), database);
  return reports;
}

// ---------------------------------------------------------------- l'état, pour les écrans

export interface BankState {
  syncing: boolean;
  reports: AccountSyncReport[] | null;
  error: string | null;
  finishedAt: number | null;
}

let state: BankState = { syncing: false, reports: null, error: null, finishedAt: null };
const listeners = new Set<() => void>();
function set(patch: Partial<BankState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useBankState(): BankState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

/** Ce qui suit une synchro réussie (cours des placements, photo du patrimoine) : branché par `upkeep.ts`. */
let afterSync: (() => Promise<void>) | null = null;
export function setAfterSync(fn: () => Promise<void>): void {
  afterSync = fn;
}

export async function runBankSync(): Promise<AccountSyncReport[] | null> {
  if (state.syncing) return null;
  set({ syncing: true, error: null });
  try {
    const settings = await bankSettings();
    if (!canUseRelay(settings)) throw new Error('Connecte-toi à ton compte MyLife pour synchroniser tes banques.');
    const reports = await syncAll(relayFetcher(new Relay(settings)), settings);
    await afterSync?.().catch(() => undefined);
    set({ syncing: false, reports, finishedAt: Date.now() });
    factsChanged();
    return reports;
  } catch (e) {
    set({ syncing: false, error: e instanceof Error ? e.message : String(e), finishedAt: Date.now() });
    return null;
  }
}

/**
 * Synchro automatique à l'ouverture, si la dernière date de plus de `autoSyncHours` (sur cet appareil ou un autre :
 * la DSP2 limite les accès automatiques à quatre par jour et par compte).
 */
export async function maybeAutoSync(): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  const settings = await bankSettings();
  if (!settings.autoSyncHours || !canUseRelay(settings)) return;
  const accounts = await facts.accounts.where('source').equals('enablebanking').toArray();
  if (!accounts.some((a) => a.remoteUid && !a.hidden)) return;
  const last = Math.max((await getMeta<number>('lastSyncAt')) ?? 0, ...accounts.map((a) => a.lastSyncAt ?? 0));
  if (Date.now() - last < settings.autoSyncHours * 3600_000) return;
  await runBankSync();
}
