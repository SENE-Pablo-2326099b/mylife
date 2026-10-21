import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getMeta, setMeta } from '../db/db';
import type { Transaction } from '../db/types';
import { useAccounts, useCategoryMap, useSettings } from '../hooks';
import { addDays, cycleFor, todayISO } from '../lib/dates';
import { computeBudget, EARLY_PAY_DAYS, type Allocations, type BudgetState, type ExceptionalAllocation } from './budgetEngine';

const NO_TX: Transaction[] = [];
const ALLOCATIONS_KEY = 'exceptionalAllocations';
const NO_ALLOCATIONS: Allocations = {};

/** Affecte un revenu exceptionnel (ou annule son affectation avec null). */
export async function allocateExceptional(txId: string, allocation: ExceptionalAllocation | null): Promise<void> {
  const current = (await getMeta<Record<string, ExceptionalAllocation>>(ALLOCATIONS_KEY)) ?? {};
  const next = { ...current };
  if (allocation) next[txId] = allocation;
  else delete next[txId];
  await setMeta(ALLOCATIONS_KEY, next);
}

/** Ce dont le moteur a besoin en plus des opérations : affectations et début des données. */
export function useBudgetContext(): { allocations: Allocations; dataStart: string | null } {
  const allocations = useLiveQuery(() => getMeta<Allocations>(ALLOCATIONS_KEY), []);
  const dataStart = useLiveQuery(async () => (await db.transactions.orderBy('date').first())?.date ?? null, []);
  return { allocations: allocations ?? NO_ALLOCATIONS, dataStart: dataStart ?? null };
}

/** État du budget du jour, à partir de la base (voir budgetEngine.ts pour le calcul). */
export function useBudget(today = todayISO()): { state: BudgetState; txs: Transaction[]; loading: boolean } {
  const settings = useSettings();
  const cats = useCategoryMap();
  const accounts = useAccounts();
  const nominal = cycleFor(today, settings.payday);
  // Fenêtre large : paie en avance (avant le début prévu) et cycle suivant déjà ouvert.
  const from = addDays(nominal.start, -EARLY_PAY_DAYS - 1);
  const to = addDays(nominal.end, 35);
  const txs = useLiveQuery(() => db.transactions.where('date').between(from, to, true, true).toArray(), [from, to]);
  const { allocations, dataStart } = useBudgetContext();
  const current = accounts.filter((a) => !a.hidden && a.balance !== null && (a.kind ?? 'current') !== 'savings');
  const balance = current.length ? current.reduce((s, a) => s + (a.balance ?? 0), 0) : null;

  const list = txs ?? NO_TX;
  const state = useMemo(
    () => computeBudget({ txs: list, cats, settings, today, allocations, dataStart, balance }),
    [list, cats, settings, today, allocations, dataStart, balance],
  );
  return { state, txs: list, loading: txs === undefined };
}
