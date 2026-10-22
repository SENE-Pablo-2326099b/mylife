import { useMemo } from 'react';
import type { Transaction } from '../db/types';
import { useCategoryMap, useSettings } from '../hooks';
import { todayISO } from '../lib/dates';
import { useRecentTransactions } from './recentTransactions';
import { computeAlerts, type Alert } from './alerts';
import { useBudgetContext } from './useBudget';

const NO_TX: Transaction[] = [];

/** Alertes et état de lecture (pas de « rien à signaler » avant d'avoir lu les opérations). */
export function useAlertsState(): { alerts: Alert[]; loaded: boolean } {
  const settings = useSettings();
  const cats = useCategoryMap();
  const today = todayISO();
  const raw = useRecentTransactions();
  const txs = raw ?? NO_TX;
  const { allocations, dataStart } = useBudgetContext();
  const alerts = useMemo(() => computeAlerts({ txs, cats, settings, today, allocations, dataStart }), [txs, cats, settings, today, allocations, dataStart]);
  return { alerts, loaded: raw !== undefined };
}

export function useAlerts(): Alert[] {
  return useAlertsState().alerts;
}
