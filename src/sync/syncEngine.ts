import { db, setMeta, type BudgetDB } from '../db/db';
import type { Account, Settings } from '../db/types';
import { addDays, todayISO, type ISODate } from '../lib/dates';
import { mergeTransactions } from '../domain/dedup';
import { classifyTransactions } from '../domain/classifyDb';
import { SourceError, type DataSource } from './source';

export interface AccountSyncReport {
  accountId: string;
  accountName: string;
  added: number;
  duplicates: number;
  pending: number;
  settled: number;
  toClassify: number;
  error?: string;
  expired?: boolean;
}

/** Overlap re-téléchargé à chaque synchro pour rattraper les opérations comptabilisées en retard. */
export const SYNC_OVERLAP_DAYS = 7;

export function computeSince(account: Account, pendingDates: ISODate[], today: ISODate, settings: Pick<Settings, 'initialSyncDays'>): ISODate {
  let since = account.lastSyncAt ? addDays(todayISO(new Date(account.lastSyncAt)), -SYNC_OVERLAP_DAYS) : addDays(today, -settings.initialSyncDays);
  for (const d of pendingDates) if (d < since) since = d;
  return since;
}

export async function syncAccount(
  account: Account,
  source: DataSource,
  settings: Settings,
  database: BudgetDB = db,
  now = new Date(),
): Promise<AccountSyncReport> {
  const today = todayISO(now);
  const report: AccountSyncReport = { accountId: account.id, accountName: account.name, added: 0, duplicates: 0, pending: 0, settled: 0, toClassify: 0 };
  const existing = await database.transactions.where('accountId').equals(account.id).toArray();
  const since = computeSince(account, existing.filter((t) => t.pending).map((t) => t.date), today, settings);

  try {
    const fetched = await source.fetchAccount(account, since, today);
    const merge = mergeTransactions(account.id, existing, fetched.transactions, source.id, now.getTime());
    await database.transaction('rw', [database.transactions, database.accounts], async () => {
      if (merge.toDelete.length) await database.transactions.bulkDelete(merge.toDelete);
      if (merge.toAdd.length) await database.transactions.bulkPut(merge.toAdd);
      await database.accounts.update(account.id, {
        lastSyncAt: now.getTime(),
        lastSyncError: null,
        ...(fetched.balance ? { balance: fetched.balance.amount, balanceDate: fetched.balance.date } : {}),
      });
    });
    const classified = await classifyTransactions(database, merge.toAdd.map((t) => t.id));
    report.added = merge.newBooked;
    report.pending = merge.toAdd.filter((t) => t.pending).length;
    report.settled = merge.settled;
    report.duplicates = merge.duplicates;
    report.toClassify = classified.unclassified;
  } catch (e) {
    const err = e instanceof SourceError ? e : new SourceError(e instanceof Error ? e.message : String(e));
    report.error = err.message;
    report.expired = err.sessionExpired;
    await database.accounts.update(account.id, { lastSyncError: err.message });
    if (err.sessionExpired && account.connectionId) {
      await database.connections.update(account.connectionId, { status: 'expired' });
    }
  }
  return report;
}

/** Synchronise tous les comptes d'une source (comptes masqués exclus). */
export async function syncAll(source: DataSource, settings: Settings, database: BudgetDB = db, now = new Date()): Promise<AccountSyncReport[]> {
  const accounts = (await database.accounts.where('source').equals(source.id).toArray()).filter((a) => !a.hidden);
  const connections = new Map((await database.connections.toArray()).map((c) => [c.id, c]));
  const reports: AccountSyncReport[] = [];
  for (const account of accounts) {
    const conn = account.connectionId ? connections.get(account.connectionId) : undefined;
    if (source.id === 'enablebanking') {
      if (!conn) continue;
      if (conn.status === 'active' && new Date(conn.validUntil).getTime() < now.getTime()) {
        await database.connections.update(conn.id, { status: 'expired' });
        conn.status = 'expired';
      }
      if (conn.status !== 'active') {
        reports.push({ accountId: account.id, accountName: account.name, added: 0, duplicates: 0, pending: 0, settled: 0, toClassify: 0, error: 'Accès expiré : reconnecte la banque.', expired: true });
        continue;
      }
    }
    reports.push(await syncAccount(account, source, settings, database, now));
  }
  await setMeta('lastSyncAt', now.getTime(), database);
  return reports;
}
