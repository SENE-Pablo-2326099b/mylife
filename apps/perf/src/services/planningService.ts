import { addDays, diffDays } from '@/domain/dates';
import { mesocycleEndOffsetDays, mesocycleForDate } from '@/domain/mesocycle';
import { expandPattern } from '@/domain/planning';
import { listMesocycles } from '@/db/repos/cycles';
import { addPlannedBulk, datesWithPlansOrWorkouts } from '@/db/repos/planning';
import { getWeekPattern, listTemplates } from '@/db/repos/templates';

/**
 * Fills the calendar from the weekly pattern, from `from` to the end of the running
 * mesocycle (or 4 weeks when there is none). Days already holding something are skipped.
 */
export function applyPatternFrom(from: string): number {
  const meso = mesocycleForDate(listMesocycles(), from);
  let to = addDays(from, 27);
  if (meso !== null) {
    const end = addDays(meso.startDate, mesocycleEndOffsetDays(meso));
    if (diffDays(from, end) >= 0) to = end;
  }
  const names = new Map(listTemplates().map((t) => [t.id, t.name]));
  const proposals = expandPattern(getWeekPattern(), from, to, datesWithPlansOrWorkouts(from, to)).filter((p) =>
    names.has(p.templateId),
  );
  addPlannedBulk(proposals.map((p) => ({ ...p, title: names.get(p.templateId) ?? 'Séance' })));
  return proposals.length;
}
