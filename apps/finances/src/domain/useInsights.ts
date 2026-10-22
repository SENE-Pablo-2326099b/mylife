import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { db } from '../db/db';
import type { Holding, InvestmentPlan, RecurringOverride, Transaction } from '../db/types';
import { useAccountsState, useCategoryMap, useSettings } from '../hooks';
import { cycleFor, todayISO, type ISODate } from '../lib/dates';
import { averageDailySpend, buildForecast, forecastAccounts, type Forecast } from './forecast';
import { useRecentTransactions } from './recentTransactions';
import { detectRecurring, type Recurring } from './recurring';

const NO_TX: Transaction[] = [];
const NO_OV: RecurringOverride[] = [];
const NO_PLANS: InvestmentPlan[] = [];
const NO_H: Holding[] = [];

/** Dernier calcul de récurrences : plusieurs composants affichés en même temps le partagent. */
let lastRecurring: { txs: unknown; cats: unknown; today: string; overrides: unknown; list: Recurring[] } | null = null;
function recurringFor(txs: Transaction[], cats: ReturnType<typeof useCategoryMap>, today: string, overrides: RecurringOverride[]): Recurring[] {
  const l = lastRecurring;
  if (l && l.txs === txs && l.cats === cats && l.today === today && l.overrides === overrides) return l.list;
  const list = detectRecurring(txs, cats, today, overrides);
  lastRecurring = { txs, cats, today, overrides, list };
  return list;
}

/** Récurrences détectées sur les 15 derniers mois (recalculées en direct). */
export function useRecurring(): { list: Recurring[]; loaded: boolean; txs: Transaction[] } {
  const today = todayISO();
  const txs = useRecentTransactions();
  const overrides = useLiveQuery(() => db.recurring.toArray(), []) ?? NO_OV;
  const cats = useCategoryMap();
  const list = useMemo(() => recurringFor(txs ?? NO_TX, cats, today, overrides), [txs, cats, today, overrides]);
  return { list, loaded: txs !== undefined, txs: txs ?? NO_TX };
}

/** Prévision de trésorerie des comptes courants jusqu'à `until` (par défaut : veille de la prochaine paie). */
export function useForecast(until?: ISODate): { forecast: Forecast | null; recurring: Recurring[]; hasBalances: boolean; until: ISODate; loaded: boolean } {
  const settings = useSettings();
  const cats = useCategoryMap();
  const { accounts, loaded: accountsLoaded } = useAccountsState();
  const { list, txs, loaded: txsLoaded } = useRecurring();
  const plans = useLiveQuery(() => db.plans.toArray(), []) ?? NO_PLANS;
  const holdings = useLiveQuery(() => db.holdings.toArray(), []) ?? NO_H;
  const today = todayISO();
  const end = until ?? cycleFor(today, settings.payday).end;
  const current = useMemo(() => forecastAccounts(accounts), [accounts]);
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
  return { forecast, recurring: list, hasBalances: current.length > 0, until: end, loaded: accountsLoaded && txsLoaded };
}
