import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Transaction } from '../db/types';
import { useCategoryMap, useSettings } from '../hooks';
import { addDays, todayISO } from '../lib/dates';
import { computeAlerts, type Alert } from './alerts';

const NO_TX: Transaction[] = [];

export function useAlerts(): Alert[] {
  const settings = useSettings();
  const cats = useCategoryMap();
  const today = todayISO();
  const from = addDays(today, -400);
  const txs = useLiveQuery(() => db.transactions.where('date').aboveOrEqual(from).toArray(), [from]) ?? NO_TX;
  return useMemo(() => computeAlerts({ txs, cats, settings, today }), [txs, cats, settings, today]);
}
