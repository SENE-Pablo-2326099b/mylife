import { addDays, diffDays, weekday } from './dates';
import type { PlannedSession, WeekPatternEntry } from './types';

export interface PlanProposal {
  date: string;
  templateId: string;
  position: number;
}

/**
 * Expands the weekly pattern into dated sessions between `from` and `to` (inclusive).
 * Days that already have planned sessions or workouts are left alone: the pattern
 * is a suggestion, it never overwrites what the user moved or added by hand.
 */
export function expandPattern(
  pattern: readonly WeekPatternEntry[],
  from: string,
  to: string,
  occupiedDates: ReadonlySet<string>,
): PlanProposal[] {
  const out: PlanProposal[] = [];
  const days = diffDays(from, to);
  for (let i = 0; i <= days; i++) {
    const date = addDays(from, i);
    if (occupiedDates.has(date)) continue;
    const wd = weekday(date);
    pattern
      .filter((p) => p.weekday === wd)
      .sort((a, b) => a.position - b.position)
      .forEach((p, position) => out.push({ date, templateId: p.templateId, position }));
  }
  return out;
}

/** The planned session to suggest on `date`: today's first not-yet-done one. */
export function nextPlanned(sessions: readonly PlannedSession[], date: string): PlannedSession | null {
  const pending = sessions
    .filter((s) => s.workoutId === null && diffDays(date, s.date) >= 0)
    .sort((a, b) => (a.date === b.date ? a.position - b.position : a.date < b.date ? -1 : 1));
  return pending[0] ?? null;
}
