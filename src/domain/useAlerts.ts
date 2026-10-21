import { useMemo } from 'react';
import type { Transaction } from '../db/types';
import { useCategoryMap, useSettings } from '../hooks';
import { todayISO } from '../lib/dates';
import { useRecentTransactions } from './recentTransactions';
import { computeAlerts, type Alert } from './alerts';
import { useBudgetContext } from './useBudget';

const NO_TX: Transaction[] = [];

export function useAlerts(): Alert[] {
  const settings = useSettings();
  const cats = useCategoryMap();
  const today = todayISO();
  const txs = useRecentTransactions() ?? NO_TX;
  const { allocations, dataStart } = useBudgetContext();
  return useMemo(() => computeAlerts({ txs, cats, settings, today, allocations, dataStart }), [txs, cats, settings, today, allocations, dataStart]);
}
