import type { WeekOverride } from '@/domain/types';

import { db, newId } from '../db';

/**
 * `intensity` column = top set % of the reference 1RM (`topPercent`); `backoff_percent` = backoffs, same base.
 * `top_weight` (an old fixed top set load) is no longer used: loads are always a % of the 1RM.
 */
interface OverrideRow {
  week_index: number;
  top_sets: number | null;
  top_reps_min: number | null;
  top_reps_max: number | null;
  backoff_sets: number | null;
  backoff_reps: number | null;
  backoff_percent: number | null;
  intensity: number | null;
}

const toOverride = (r: OverrideRow): WeekOverride => ({
  weekIndex: r.week_index,
  topSets: r.top_sets,
  topRepsMin: r.top_reps_min,
  topRepsMax: r.top_reps_max,
  backoffSets: r.backoff_sets,
  backoffReps: r.backoff_reps,
  backoffPercent: r.backoff_percent,
  topPercent: r.intensity,
});

/** Per-week tweaks of one exercise in one mesocycle, keyed by week index. */
export function weekOverrides(mesocycleId: string, exerciseId: string): Map<number, WeekOverride> {
  const rows = db().all<OverrideRow>(
    'SELECT * FROM cycle_week_overrides WHERE mesocycle_id = ? AND exercise_id = ? ORDER BY week_index',
    [mesocycleId, exerciseId],
  );
  return new Map(rows.map((r) => [r.week_index, toOverride(r)]));
}

export function emptyOverride(weekIndex: number): WeekOverride {
  return {
    weekIndex,
    topSets: null,
    topRepsMin: null,
    topRepsMax: null,
    backoffSets: null,
    backoffReps: null,
    backoffPercent: null,
    topPercent: null,
  };
}

/** Saves a week tweak; an override with every field null is deleted (back to the cycle default). */
export function saveWeekOverride(mesocycleId: string, exerciseId: string, o: WeekOverride): void {
  const values = [o.topSets, o.topRepsMin, o.topRepsMax, o.backoffSets, o.backoffReps, o.backoffPercent, o.topPercent];
  if (values.every((v) => v === null)) {
    db().run('DELETE FROM cycle_week_overrides WHERE mesocycle_id = ? AND exercise_id = ? AND week_index = ?', [
      mesocycleId,
      exerciseId,
      o.weekIndex,
    ]);
    return;
  }
  db().run(
    `INSERT INTO cycle_week_overrides (id, mesocycle_id, exercise_id, week_index, top_sets, top_reps_min, top_reps_max,
       backoff_sets, backoff_reps, backoff_percent, intensity)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(mesocycle_id, exercise_id, week_index) DO UPDATE SET top_sets = excluded.top_sets,
       top_reps_min = excluded.top_reps_min, top_reps_max = excluded.top_reps_max, backoff_sets = excluded.backoff_sets,
       backoff_reps = excluded.backoff_reps, backoff_percent = excluded.backoff_percent, intensity = excluded.intensity`,
    [newId(), mesocycleId, exerciseId, o.weekIndex, ...values],
  );
}

/** Exercises with at least one tweak in a cycle (for the editor list). */
export function exercisesWithOverrides(mesocycleId: string): Set<string> {
  return new Set(
    db()
      .all<{ exercise_id: string }>('SELECT DISTINCT exercise_id FROM cycle_week_overrides WHERE mesocycle_id = ?', [mesocycleId])
      .map((r) => r.exercise_id),
  );
}
