import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { db } from '../db/db';
import type { Holding, InvestmentPlan, RecurringOverride, Transaction } from '../db/types';
import { useAccounts, useCategoryMap, useSettings } from '../hooks';
import { addDays, cycleFor, todayISO, type ISODate } from '../lib/dates';
import { averageDailySpend, buildForecast, forecastAccounts, type Forecast } from './forecast';
import { detectRecurring, type Recurring } from './recurring';

const NO_TX: Transaction[] = [];
const NO_OV: RecurringOverride[] = [];
const NO_PLANS: InvestmentPlan[] = [];
const NO_H: Holding[] = [];

/** Récurrences détectées sur les 15 derniers mois (recalculées en direct). */
export function useRecurring(): { list: Recurring[]; loaded: boolean; txs: Transaction[] } {
  const today = todayISO();
  const txs = useLiveQuery(() => db.transactions.where('date').aboveOrEqual(addDays(today, -460)).toArray(), [today]);
  const overrides = useLiveQuery(() => db.recurring.toArray(), []) ?? NO_OV;
  const cats = useCategoryMap();
  const list = useMemo(() => detectRecurring(txs ?? NO_TX, cats, today, overrides), [txs, cats, today, overrides]);
  return { list, loaded: txs !== undefined, txs: txs ?? NO_TX };
}

/** Prévision de trésorerie des comptes courants jusqu'à `until` (par défaut : veille de la prochaine paie). */
export function useForecast(until?: ISODate): { forecast: Forecast | null; recurring: Recurring[]; hasBalances: boolean; until: ISODate } {
  const settings = useSettings();
  const cats = useCategoryMap();
  const accounts = useAccounts();
  const { list, txs } = useRecurring();
  const plans = useLiveQuery(() => db.plans.toArray(), []) ?? NO_PLANS;
  const holdings = useLiveQuery(() => db.holdings.toArray(), []) ?? NO_H;
  const today = todayISO();
  const end = until ?? cycleFor(today, settings.payday).end;
  const current = forecastAccounts(accounts);
  const forecast = useMemo(() => {
    if (current.length === 0) return null;
    const names = new Map(holdings.map((h) => [h.id, h.name]));
    return buildForecast({
      today,
      until: end,
      startBalance: current.reduce((s, a) => s + (a.balance ?? 0), 0),
      recurring: list,
      cats,
      settings,
      plans: plans.map((p) => ({ ...p, label: `Investissement · ${names.get(p.holdingId) ?? ''}` })),
      dailySpend: averageDailySpend(txs, cats, today),
    });
  }, [current, list, cats, settings, plans, holdings, txs, today, end]);
  return { forecast, recurring: list, hasBalances: current.length > 0, until: end };
}
