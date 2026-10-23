import { startOfWeek } from './dates';

/**
 * Compteurs de MyPerf pour le Personnage MyLife (stat Force), par semaine (lundi) : séances terminées
 * (`sessions`) et records battus (`records`). Rien d'autre : ni charges, ni exercices.
 */
export function forceWeeks(sessionDates: readonly string[], recordDates: readonly string[], from: string): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  const bump = (date: string, key: string) => {
    if (date < from) return;
    const w = (out[startOfWeek(date)] ??= {});
    w[key] = (w[key] ?? 0) + 1;
  };
  for (const d of sessionDates) bump(d, 'sessions');
  for (const d of recordDates) bump(d, 'records');
  return out;
}
