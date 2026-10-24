import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getMeta, setMeta } from '../db/db';
import type { Transaction } from '../db/types';
import { useAccounts, useCategoryMap, useSettings } from '../hooks';
import { addDays, cycleFor, todayISO } from '../lib/dates';
import { computeBudget, currentCycle, EARLY_PAY_DAYS, type Allocations, type BudgetState, type ExceptionalAllocation, type SavingsClosed, type UpcomingOutflow } from './budgetEngine';
import { CAT } from './defaults';
import { forecastAccounts } from './forecast';
import { useForecast } from './useInsights';
import { useRecentTransactions } from './recentTransactions';

const NO_TX: Transaction[] = [];
const ALLOCATIONS_KEY = 'exceptionalAllocations';
const NO_ALLOCATIONS: Allocations = {};
/** Cycles (date de début) où l'épargne est déclarée complète : « c'est tout pour ce cycle ». Synchronisé. */
export const SAVINGS_CLOSED_KEY = 'savingsClosed';
const NO_CLOSED: SavingsClosed = {};

/** « C'est tout pour ce cycle » (ou annuler) : seul ce qui a été versé compte comme épargne du cycle. */
export async function setSavingsClosed(cycleStart: string, closed: boolean): Promise<void> {
  const current = (await getMeta<Record<string, true>>(SAVINGS_CLOSED_KEY)) ?? {};
  const next = { ...current };
  if (closed) next[cycleStart] = true;
  else delete next[cycleStart];
  await setMeta(SAVINGS_CLOSED_KEY, next);
}

/** Affecte un revenu exceptionnel (ou annule son affectation avec null). */
export async function allocateExceptional(txId: string, allocation: ExceptionalAllocation | null): Promise<void> {
  const current = (await getMeta<Record<string, ExceptionalAllocation>>(ALLOCATIONS_KEY)) ?? {};
  const next = { ...current };
  if (allocation) next[txId] = allocation;
  else delete next[txId];
  await setMeta(ALLOCATIONS_KEY, next);
}

/** Ce dont le moteur a besoin en plus des opérations : affectations, début des données, épargne déclarée complète. */
export function useBudgetContext(): { allocations: Allocations; dataStart: string | null; savingsClosed: SavingsClosed } {
  const allocations = useLiveQuery(() => getMeta<Allocations>(ALLOCATIONS_KEY), []);
  const dataStart = useLiveQuery(async () => (await db.transactions.orderBy('date').first())?.date ?? null, []);
  const savingsClosed = useLiveQuery(() => getMeta<SavingsClosed>(SAVINGS_CLOSED_KEY), []);
  return { allocations: allocations ?? NO_ALLOCATIONS, dataStart: dataStart ?? null, savingsClosed: savingsClosed ?? NO_CLOSED };
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
  // Opérations du cycle, prises dans la lecture partagée des opérations récentes.
  const recent = useRecentTransactions();
  const txs = useMemo(() => recent?.filter((t) => t.date >= from && t.date <= to), [recent, from, to]);
  const { allocations, dataStart, savingsClosed } = useBudgetContext();
  const list = txs ?? NO_TX;
  // Comptes « du quotidien » (pas l'épargne) : leur solde réel est le plafond du budget.
  const current = forecastAccounts(accounts);
  const balance = current.length ? current.reduce((s, a) => s + (a.balance ?? 0), 0) : null;
  const cashKey = current.map((a) => a.id).join(',');
  const cashAccounts = useMemo(() => (cashKey ? new Set(cashKey.split(',')) : null), [cashKey]);
  // Sorties déjà engagées d'ici la paie, détectées dans l'historique réel (prévision de trésorerie).
  const cycleEnd = useMemo(() => currentCycle({ txs: list, cats, settings, today }).end, [list, cats, settings, today]);
  const { forecast } = useForecast(cycleEnd);
  const upcoming = useMemo<UpcomingOutflow[] | null>(
    () =>
      forecast
        ? forecast.events
            .filter((e) => e.amount < 0)
            .map((e) => ({ date: e.date, label: e.label, amount: -e.amount, savings: e.source === 'plan' || e.categoryId === CAT.epargne }))
        : null,
    [forecast],
  );

  const state = useMemo(
    () => computeBudget({ txs: list, cats, settings, today, allocations, dataStart, balance, upcoming, savingsClosed, cashAccounts }),
    [list, cats, settings, today, allocations, dataStart, balance, upcoming, savingsClosed, cashAccounts],
  );
  return { state, txs: list, loading: txs === undefined };
}
