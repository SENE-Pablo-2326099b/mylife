import type { Settings, Transaction } from '../db/types';
import { addDays, type ISODate } from '../lib/dates';
import { weekStart, type AppStats } from '../vendor/lumen';
import { cycleEnvelope, daySeries, payDates, resolveCycle, type Allocations, type CatMap } from './budgetEngine';
import { CAT, plannedSavings } from './defaults';

/**
 * Compteurs de MyFinances pour le Personnage (stat Discipline), par semaine : jours sous le budget du
 * jour (`under`), jours suivis (`tracked`, à partir de la première opération), cycles terminés avec
 * l'épargne prévue tenue (`saved`, comptés la semaine où le cycle se termine). Même règle que le
 * budget du jour, cycle par cycle. Jamais de montant : seulement des nombres de jours.
 * La journée en cours n'est pas comptée (elle n'est pas finie).
 */
export function disciplineWeeks(input: {
  txs: readonly Transaction[];
  cats: CatMap;
  settings: Settings;
  allocations: Allocations;
  dataStart: ISODate | null;
  today: ISODate;
  weeks?: number;
}): AppStats['weeks'] {
  const { txs, cats, settings, allocations, dataStart, today } = input;
  const out: AppStats['weeks'] = {};
  if (!dataStart) return out;
  const horizon = addDays(weekStart(today), -7 * ((input.weeks ?? 104) - 1));
  const from = dataStart > horizon ? dataStart : horizon;
  const yesterday = addDays(today, -1);
  const pays = payDates(txs, cats, settings);
  const planned = plannedSavings(settings);
  const bump = (week: string, key: string) => {
    const w = (out[week] ??= {});
    w[key] = (w[key] ?? 0) + 1;
  };

  let cycle = resolveCycle(today, settings.payday, pays);
  for (let guard = 0; guard < 40 && cycle.end >= from; guard++) {
    const envelope = cycleEnvelope({ txs, cats, settings, allocations, dataStart }, cycle).total;
    if (envelope > 0 && yesterday >= cycle.start) {
      for (const p of daySeries(txs, cats, cycle, envelope, yesterday < cycle.end ? yesterday : cycle.end)) {
        if (p.date < from) continue;
        const week = weekStart(p.date);
        bump(week, 'tracked');
        if (p.spent <= p.budget) bump(week, 'under');
      }
    }
    // Cycle terminé : l'épargne prévue a-t-elle été mise de côté ?
    if (planned > 0 && cycle.end < today && cycle.end >= from) {
      const saved = txs.filter((t) => t.date >= cycle.start && t.date <= cycle.end && t.amount < 0 && t.categoryId === CAT.epargne).reduce((s, t) => s - t.amount, 0);
      if (saved >= planned) bump(weekStart(cycle.end), 'saved');
    }
    cycle = resolveCycle(addDays(cycle.start, -1), settings.payday, pays);
  }
  return out;
}
