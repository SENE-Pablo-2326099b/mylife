import { startOfWeek } from './dates';

/**
 * Compteurs de MyPerf pour le Personnage MyLife (stat Force), par semaine (lundi) : séances terminées
 * (`sessions`), records battus (`records`) et minutes d'entraînement (`minutes`, pour « Où va ton temps ? »).
 * Rien d'autre : ni charges, ni exercices.
 */
export function forceWeeks(sessionDates: readonly string[], recordDates: readonly string[], from: string, sessionMinutes: readonly { date: string; minutes: number }[] = []): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  const bump = (date: string, key: string) => {
    if (date < from) return;
    const w = (out[startOfWeek(date)] ??= {});
    w[key] = (w[key] ?? 0) + 1;
  };
  for (const d of sessionDates) bump(d, 'sessions');
  for (const d of recordDates) bump(d, 'records');
  for (const s of sessionMinutes) {
    if (s.date < from || !(s.minutes > 0)) continue;
    const w = (out[startOfWeek(s.date)] ??= {});
    w.minutes = (w.minutes ?? 0) + Math.round(s.minutes);
  }
  return out;
}
