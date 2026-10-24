import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { db } from '../db/db';
import type { Holding, InvestmentPlan, RecurringOverride, Transaction } from '../db/types';
import { useAccountsState, useCategoryMap, useSettings } from '../hooks';
import { cycleFor, todayISO, type Cycle, type ISODate } from '../lib/dates';
import { averageDailySpend, buildForecast, forecastAccounts, type Forecast } from './forecast';
import { useRecentTransactions } from './recentTransactions';
import { detectRecurring, type Recurring } from './recurring';
import { buildRecurringList, RECURRING_SKIPS_KEY, type RecurringItem, type RecurringSkips } from './recurringList';
import { getMeta } from '../db/db';

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

const NO_SKIPS: RecurringSkips = {};

/**
 * La liste unique des récurrents (réglages, plans, détectés rapprochés), avec ce qui est déjà passé et ce qui est
 * sauté pour le cycle `cycle` (par défaut le cycle nominal en cours).
 */
export function useRecurringList(cycle?: Cycle): { items: RecurringItem[]; plans: (InvestmentPlan & { label: string })[]; detected: Recurring[]; txs: Transaction[]; cycle: Cycle; loaded: boolean } {
  const settings = useSettings();
  const cats = useCategoryMap();
  const { list, txs, loaded } = useRecurring();
  const rawPlans = useLiveQuery(() => db.plans.toArray(), []) ?? NO_PLANS;
  const holdings = useLiveQuery(() => db.holdings.toArray(), []) ?? NO_H;
  const skips = useLiveQuery(() => getMeta<RecurringSkips>(RECURRING_SKIPS_KEY), []) ?? NO_SKIPS;
  const today = todayISO();
  const nominal = cycleFor(today, settings.payday);
  const start = cycle?.start ?? nominal.start;
  const end = cycle?.end ?? nominal.end;
  const plans = useMemo(() => {
    const names = new Map(holdings.map((h) => [h.id, h.name]));
    return rawPlans.map((p) => ({ ...p, label: `Investissement · ${names.get(p.holdingId) ?? ''}` }));
  }, [rawPlans, holdings]);
  const items = useMemo(
    () => buildRecurringList({ detected: list, cats, settings, plans, today, cycle: { start, end }, txs, skips }),
    [list, cats, settings, plans, today, start, end, txs, skips],
  );
  return { items, plans, detected: list, txs, cycle: { start, end }, loaded };
}

/** Prévision de trésorerie des comptes courants jusqu'à `until` (par défaut : veille de la prochaine paie). */
export function useForecast(until?: ISODate, cycle?: Cycle): { forecast: Forecast | null; recurring: Recurring[]; hasBalances: boolean; until: ISODate; loaded: boolean } {
  const settings = useSettings();
  const cats = useCategoryMap();
  const { accounts, loaded: accountsLoaded } = useAccountsState();
  const { items, plans, detected, txs, cycle: current, loaded: txsLoaded } = useRecurringList(cycle);
  const today = todayISO();
  const end = until ?? current.end;
  const accountsNow = useMemo(() => forecastAccounts(accounts), [accounts]);
  const forecast = useMemo(() => {
    if (accountsNow.length === 0) return null;
    return buildForecast({
      today,
      until: end,
      startBalance: accountsNow.reduce((s, a) => s + (a.balance ?? 0), 0),
      recurring: detected,
      cats,
      settings,
      plans,
      dailySpend: averageDailySpend(txs, cats, today),
      items,
      cycleEnd: current.end,
    });
  }, [accountsNow, detected, cats, settings, plans, txs, today, end, items, current.end]);
  return { forecast, recurring: detected, hasBalances: accountsNow.length > 0, until: end, loaded: accountsLoaded && txsLoaded };
}
