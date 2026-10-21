import { estimate1RM } from '@/domain/math';
import { isReliable } from '@/domain/reference';
import { summarizeSession, type SessionSummary, type SummarySet } from '@/domain/summary';
import { db } from '@/db/db';
import { listExercises } from '@/db/repos/exercises';
import { setRecordsFor } from '@/db/repos/history';
import { getWorkout, listSetsForWorkout, listWorkoutExercises } from '@/db/repos/workouts';

/** Tonnage (total mass for weighted work) of one finished workout. */
function tonnageOf(workoutId: string): number {
  return (
    db().first<{ t: number | null }>(
      `SELECT SUM((s.weight + CASE WHEN e.load_type = 'bodyweight' THEN COALESCE(w.bodyweight, 0) ELSE 0 END) * s.reps) AS t
       FROM sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id
       JOIN workouts w ON w.id = we.workout_id JOIN exercises e ON e.id = we.exercise_id
       WHERE w.id = ? AND s.completed = 1 AND s.set_type != 'warmup' AND s.weight IS NOT NULL AND s.reps > 0`,
      [workoutId],
    )?.t ?? 0
  );
}

/** Report of a workout: what was done, records broken, and the trend vs the previous same session. */
export function sessionSummary(workoutId: string): SessionSummary | null {
  const workout = getWorkout(workoutId);
  if (workout === null) return null;
  const exercises = new Map(listExercises(true).map((e) => [e.id, e]));
  const wes = new Map(listWorkoutExercises(workoutId).map((we) => [we.id, we]));
  const sets: SummarySet[] = [];
  for (const s of listSetsForWorkout(workoutId)) {
    const we = wes.get(s.workoutExerciseId);
    const ex = we === undefined ? undefined : exercises.get(we.exerciseId);
    if (we === undefined || ex === undefined || !s.completed || s.weight === null || s.reps === null) continue;
    sets.push({
      exerciseId: ex.id,
      exerciseName: ex.name,
      setType: s.setType,
      weight: s.weight,
      reps: s.reps,
      bodyweight: ex.loadType === 'bodyweight' ? workout.bodyweight : null,
      strength: we.progressionType === 'top_set_backoff',
    });
  }

  const bestBefore = new Map<string, number>();
  for (const exerciseId of new Set(sets.map((s) => s.exerciseId))) {
    const strength = sets.some((s) => s.exerciseId === exerciseId && s.strength);
    let best = 0;
    let any = false;
    for (const r of setRecordsFor(exerciseId)) {
      if (r.workoutId === workoutId || r.date > workout.date || r.setType === 'warmup') continue;
      if (strength && !isReliable(r.reps)) continue;
      any = true;
      best = Math.max(best, estimate1RM(r.weight, r.reps, r.bodyweight));
    }
    if (any) bestBefore.set(exerciseId, best);
  }

  const previous =
    workout.templateId === null
      ? null
      : db().first<{ id: string }>(
          // Same template and same kind of week: a deload is only compared with a deload.
          `SELECT id FROM workouts WHERE template_id = ? AND id != ? AND status = 'completed' AND date <= ? AND is_deload = ?
           ORDER BY date DESC, started_at DESC LIMIT 1`,
          [workout.templateId, workout.id, workout.date, workout.isDeload ? 1 : 0],
        );

  const summary = summarizeSession({
    startedAt: workout.startedAt,
    endedAt: workout.endedAt,
    sets,
    bestBefore,
    previousTonnage: previous === null ? null : tonnageOf(previous.id),
  });
  return { ...summary, deload: workout.isDeload };
}
