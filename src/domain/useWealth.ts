import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { db } from '../db/db';
import type { Account, Goal, GoalMove, Holding, InvestmentOp, InvestmentPlan, ManualAsset, Portfolio, Snapshot } from '../db/types';
import { todayISO } from '../lib/dates';
import { goalProgress, goalSaved, netWorth, summarizePortfolio, type GoalProgress, type NetWorth, type PortfolioSummary } from './wealth';

const NONE: never[] = [];

export interface WealthData {
  loaded: boolean;
  accounts: Account[];
  portfolios: Portfolio[];
  holdings: Holding[];
  ops: InvestmentOp[];
  plans: InvestmentPlan[];
  goals: Goal[];
  moves: GoalMove[];
  assets: ManualAsset[];
  snapshots: Snapshot[];
  summaries: PortfolioSummary[];
  worth: NetWorth;
  goalsProgress: GoalProgress[];
}

/** Tout le patrimoine, recalculé en direct à chaque changement de la base. */
export function useWealth(): WealthData {
  const data = useLiveQuery(async () => {
    const [accounts, portfolios, holdings, ops, plans, goals, moves, assets, snapshots] = await Promise.all([
      db.accounts.toArray(),
      db.portfolios.orderBy('order').toArray(),
      db.holdings.toArray(),
      db.investmentOps.toArray(),
      db.plans.toArray(),
      db.goals.orderBy('order').toArray(),
      db.goalMoves.toArray(),
      db.manualAssets.toArray(),
      db.snapshots.orderBy('date').toArray(),
    ]);
    return { accounts, portfolios, holdings, ops, plans, goals, moves, assets, snapshots };
  }, []);
  return useMemo(() => {
    const d = data ?? { accounts: NONE, portfolios: NONE, holdings: NONE, ops: NONE, plans: NONE, goals: NONE, moves: NONE, assets: NONE, snapshots: NONE };
    const summaries = d.portfolios.map((p) => summarizePortfolio(p, d.holdings, d.ops));
    const today = todayISO();
    return {
      loaded: !!data,
      ...d,
      summaries,
      worth: netWorth(d.accounts, summaries, d.assets),
      goalsProgress: d.goals.map((g) => goalProgress(g, goalSaved(g, d.moves, d.accounts, summaries), today)),
    };
  }, [data]);
}
