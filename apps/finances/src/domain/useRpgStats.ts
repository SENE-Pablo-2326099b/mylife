import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect } from 'react';
import { db } from '../db/db';
import { useCategoryMap, useSettings } from '../hooks';
import { addDays, todayISO } from '../lib/dates';
import { publishStats } from '../ui/stats';
import { disciplineWeeks } from './rpgStats';
import { useBudgetContext } from './useBudget';

/**
 * Tient à jour les compteurs Discipline du Personnage MyLife : recalculés (un peu après) quand les
 * opérations ou les réglages changent, puis déposés pour l'accueil et synchronisés, chiffrés.
 * Seulement une fois l'accueil de l'app fait (avant, il n'y a pas de budget du jour).
 */
export function useRpgStats(): void {
  const settings = useSettings();
  const cats = useCategoryMap();
  const { allocations, dataStart, savingsClosed } = useBudgetContext();
  const today = todayISO();
  const from = addDays(today, -7 * 105);
  const txs = useLiveQuery(() => db.transactions.where('date').aboveOrEqual(from).toArray(), [from]);

  useEffect(() => {
    if (!txs || !settings.onboarded || cats.size === 0) return;
    const timer = setTimeout(() => {
      publishStats('finances', { weeks: disciplineWeeks({ txs, cats, settings, allocations, dataStart, savingsClosed, today }) });
    }, 1200);
    return () => clearTimeout(timer);
  }, [txs, cats, settings, allocations, dataStart, savingsClosed, today]);
}
