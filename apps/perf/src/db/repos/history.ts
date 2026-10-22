import type { SetRecord, VolumeSet } from '@/domain/analytics';
import type { HistorySet } from '@/domain/prescription';
import { RELIABLE_MAX_REPS, type RefSet } from '@/domain/reference';
import type { ProgressionType, Workout, WorkoutSet } from '@/domain/types';

import { db } from '../db';
import { bool, parseBarSpeed, parseMuscles, parseSetType } from '../parse';
import { toSet, toWorkout, type SetRow } from './workouts';

/**
 * Epley in SQL, on total mass for bodyweight loads (mirrors domain/math.estimate1RM — keep in sync;
 * covered by the repository tests). Only used to aggregate in SQL instead of loading every set.
 */
const E1RM_SQL = `((s.weight + COALESCE(w.bodyweight, 0) * (e.load_type = 'bodyweight'))
  * (CASE WHEN s.reps = 1 THEN 1.0 ELSE 1.0 + s.reps / 30.0 END)
  - COALESCE(w.bodyweight, 0) * (e.load_type = 'bodyweight'))`;

interface LastSessionRow extends SetRow {
  workout_id: string;
  date: string;
  bodyweight: number | null;
}

export interface LastSession {
  workoutId: string;
  date: string;
  bodyweight: number | null;
  sets: WorkoutSet[];
}

/**
 * The most recent other workout containing this exercise, with its completed sets (the "ghost").
 * With `progressionType`, a session done with the same progression wins: the light double-progression
 * dips of Saturday follow the previous Saturday, not Tuesday's heavy top set.
 */
export function lastSessionFor(
  exerciseId: string,
  excludeWorkoutId: string | null,
  progressionType?: ProgressionType,
): LastSession | null {
  const find = (sameProgression: boolean) =>
    db().first<{ id: string; workout_id: string }>(
      `SELECT we.id, we.workout_id FROM workout_exercises we
       JOIN workouts w ON w.id = we.workout_id
       WHERE we.exercise_id = ? AND w.id IS NOT ? AND w.status = 'completed'
         ${sameProgression ? 'AND we.progression_type = ?' : ''}
         AND EXISTS (SELECT 1 FROM sets s WHERE s.workout_exercise_id = we.id AND s.completed = 1)
       ORDER BY w.date DESC, w.started_at DESC LIMIT 1`,
      sameProgression && progressionType !== undefined ? [exerciseId, excludeWorkoutId, progressionType] : [exerciseId, excludeWorkoutId],
    );
  const we = (progressionType === undefined ? null : find(true)) ?? find(false);
  if (we === null) return null;
  const rows = db().all<LastSessionRow>(
    `SELECT s.*, w.id AS workout_id, w.date, w.bodyweight FROM sets s
     JOIN workout_exercises we ON we.id = s.workout_exercise_id JOIN workouts w ON w.id = we.workout_id
     WHERE s.workout_exercise_id = ? AND s.completed = 1 ORDER BY s.position`,
    [we.id],
  );
  const first = rows[0];
  if (first === undefined) return null;
  return { workoutId: first.workout_id, date: first.date, bodyweight: first.bodyweight, sets: rows.map(toSet) };
}

export function toHistorySets(sets: readonly WorkoutSet[]): HistorySet[] {
  return sets.flatMap((s) =>
    s.completed && s.weight !== null && s.reps !== null && s.setType !== 'warmup'
      ? [{ setType: s.setType, weight: s.weight, reps: s.reps, barSpeed: s.barSpeed }]
      : [],
  );
}

interface RecordRow {
  note: string | null;
  workout_id: string;
  date: string;
  mesocycle_id: string | null;
  week_index: number | null;
  set_type: string;
  weight: number;
  reps: number;
  bodyweight: number | null;
  bar_speed: string | null;
}

/** Every completed set of an exercise, oldest first. Bodyweight only applies to bodyweight-loaded exercises. */
export function setRecordsFor(exerciseId: string): (SetRecord & { barSpeed: ReturnType<typeof parseBarSpeed>; note: string })[] {
  return db()
    .all<RecordRow>(
      `SELECT w.id AS workout_id, w.date, w.mesocycle_id, w.week_index, s.set_type, s.weight, s.reps, s.bar_speed, s.note,
         CASE WHEN e.load_type = 'bodyweight' THEN w.bodyweight ELSE NULL END AS bodyweight
       FROM sets s
       JOIN workout_exercises we ON we.id = s.workout_exercise_id
       JOIN workouts w ON w.id = we.workout_id
       JOIN exercises e ON e.id = we.exercise_id
       WHERE we.exercise_id = ? AND s.completed = 1 AND s.weight IS NOT NULL AND s.reps IS NOT NULL
       ORDER BY w.date, w.started_at, we.position, s.position`,
      [exerciseId],
    )
    .map((r) => ({
      workoutId: r.workout_id,
      date: r.date,
      mesocycleId: r.mesocycle_id,
      weekIndex: r.week_index,
      setType: parseSetType(r.set_type),
      weight: r.weight,
      reps: r.reps,
      bodyweight: r.bodyweight,
      barSpeed: parseBarSpeed(r.bar_speed),
      note: r.note ?? '',
    }));
}

/** Best e1RM of an exercise per mesocycle (all exercises at once), for stagnation detection. Main lifts: sets ≤ 6 reps only. */
export function cycleBestsAll(): { exerciseId: string; mesocycleId: string; best: number }[] {
  return db()
    .all<{ exercise_id: string; mesocycle_id: string; best: number }>(
      `SELECT we.exercise_id, w.mesocycle_id, MAX(${E1RM_SQL}) AS best
       FROM sets s
       JOIN workout_exercises we ON we.id = s.workout_exercise_id
       JOIN workouts w ON w.id = we.workout_id
       JOIN exercises e ON e.id = we.exercise_id
       WHERE s.completed = 1 AND s.set_type != 'warmup' AND s.reps > 0 AND s.weight IS NOT NULL
         AND w.mesocycle_id IS NOT NULL AND w.status = 'completed'
         AND (e.progression_type != 'top_set_backoff' OR s.reps <= ${RELIABLE_MAX_REPS})
       GROUP BY we.exercise_id, w.mesocycle_id`,
    )
    .map((r) => ({ exerciseId: r.exercise_id, mesocycleId: r.mesocycle_id, best: r.best }));
}

/** Best e1RM of one exercise over the workouts matching the filter. */
export function bestE1rm(
  exerciseId: string,
  where: { mesocycleId?: string; sinceDate?: string; beforeDate?: string; excludeWorkoutId?: string; maxReps?: number },
): number | null {
  const clauses = ['we.exercise_id = ?', 's.completed = 1', "s.set_type != 'warmup'", 's.reps > 0', 's.weight IS NOT NULL'];
  const params: (string | number)[] = [exerciseId];
  const add = (clause: string, value: string | undefined) => {
    if (value === undefined) return;
    clauses.push(clause);
    params.push(value);
  };
  add('w.mesocycle_id = ?', where.mesocycleId);
  add('w.date >= ?', where.sinceDate);
  add('w.date < ?', where.beforeDate);
  add('w.id != ?', where.excludeWorkoutId);
  if (where.maxReps !== undefined) {
    clauses.push('s.reps <= ?');
    params.push(where.maxReps);
  }
  return (
    db().first<{ best: number | null }>(
      `SELECT MAX(${E1RM_SQL}) AS best FROM sets s
       JOIN workout_exercises we ON we.id = s.workout_exercise_id
       JOIN workouts w ON w.id = we.workout_id
       JOIN exercises e ON e.id = we.exercise_id
       WHERE ${clauses.join(' AND ')}`,
      params,
    )?.best ?? null
  );
}

interface RefRow {
  workout_id: string;
  date: string;
  started_at: number;
  week_index: number | null;
  is_deload: number;
  set_type: string;
  weight: number;
  reps: number;
  target_weight: number | null;
  target_reps: number | null;
  reference_e1rm: number | null;
  is_test: number;
  bodyweight: number;
}

/**
 * Completed non-warmup sets of a lift for the reference engine, loads on total mass for weighted
 * exercises (each workout's bodyweight snapshot).
 */
export function refSetsFor(exerciseId: string, excludeWorkoutId: string | null): RefSet[] {
  return db()
    .all<RefRow>(
      `SELECT w.id AS workout_id, w.date, w.started_at, w.week_index, w.is_deload, s.set_type, s.weight, s.reps,
         s.target_weight, s.target_reps, we.reference_e1rm, s.is_test,
         CASE WHEN e.load_type = 'bodyweight' THEN COALESCE(w.bodyweight, 0) ELSE 0 END AS bodyweight
       FROM sets s
       JOIN workout_exercises we ON we.id = s.workout_exercise_id
       JOIN workouts w ON w.id = we.workout_id
       JOIN exercises e ON e.id = we.exercise_id
       WHERE we.exercise_id = ? AND w.id IS NOT ? AND s.completed = 1 AND s.set_type != 'warmup'
         AND s.weight IS NOT NULL AND s.reps > 0
       ORDER BY w.date, w.started_at, we.position, s.position`,
      [exerciseId, excludeWorkoutId],
    )
    .map((r) => ({
      workoutId: r.workout_id,
      date: r.date,
      order: r.started_at,
      weekIndex: r.week_index,
      isDeload: bool(r.is_deload),
      setType: parseSetType(r.set_type),
      load: r.weight + r.bodyweight,
      reps: r.reps,
      targetLoad: r.target_weight === null ? null : r.target_weight + r.bodyweight,
      targetReps: r.target_reps,
      plannedRef: r.reference_e1rm,
      isTest: bool(r.is_test),
      bodyweight: r.bodyweight,
    }));
}

interface VolumeRow {
  date: string;
  set_type: string;
  primary_muscles: string;
  secondary_muscles: string;
  category: string;
}

export function volumeSets(from: string, to: string): VolumeSet[] {
  return db()
    .all<VolumeRow>(
      `SELECT w.date, s.set_type, e.primary_muscles, e.secondary_muscles, e.category FROM sets s
       JOIN workout_exercises we ON we.id = s.workout_exercise_id
       JOIN workouts w ON w.id = we.workout_id
       JOIN exercises e ON e.id = we.exercise_id
       WHERE s.completed = 1 AND w.date BETWEEN ? AND ?`,
      [from, to],
    )
    .map((r) => ({
      date: r.date,
      setType: parseSetType(r.set_type),
      primaryMuscles: parseMuscles(r.primary_muscles),
      secondaryMuscles: parseMuscles(r.secondary_muscles),
      category: r.category === 'isolation' || r.category === 'main' ? r.category : 'compound',
    }));
}

export interface ExerciseActivity {
  exerciseId: string;
  sessions: number;
  lastDate: string;
}

export function exerciseActivity(): ExerciseActivity[] {
  return db()
    .all<{ exercise_id: string; sessions: number; last_date: string }>(
      `SELECT we.exercise_id, COUNT(DISTINCT w.id) AS sessions, MAX(w.date) AS last_date
       FROM workout_exercises we JOIN workouts w ON w.id = we.workout_id
       WHERE EXISTS (SELECT 1 FROM sets s WHERE s.workout_exercise_id = we.id AND s.completed = 1)
       GROUP BY we.exercise_id ORDER BY last_date DESC`,
    )
    .map((r) => ({ exerciseId: r.exercise_id, sessions: r.sessions, lastDate: r.last_date }));
}

export interface WorkoutSummary extends Workout {
  exerciseCount: number;
  setCount: number;
}

export function workoutSummaries(from: string, to: string): WorkoutSummary[] {
  return db()
    .all<Parameters<typeof toWorkout>[0] & { exercise_count: number; set_count: number }>(
      `SELECT w.*,
         (SELECT COUNT(*) FROM workout_exercises we WHERE we.workout_id = w.id) AS exercise_count,
         (SELECT COUNT(*) FROM sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id
            WHERE we.workout_id = w.id AND s.completed = 1) AS set_count
       FROM workouts w WHERE w.date BETWEEN ? AND ? ORDER BY w.date DESC, w.started_at DESC`,
      [from, to],
    )
    .map((r) => ({ ...toWorkout(r), exerciseCount: r.exercise_count, setCount: r.set_count }));
}

/** Sessions where this exercise was planned but another one was done instead (swaps), newest first. */
export function replacementsOf(exerciseId: string, limit = 10): { date: string; byExerciseId: string }[] {
  return db()
    .all<{ date: string; by: string }>(
      `SELECT w.date, we.exercise_id AS by FROM workout_exercises we JOIN workouts w ON w.id = we.workout_id
       WHERE we.replaces_exercise_id = ? ORDER BY w.date DESC, w.started_at DESC LIMIT ?`,
      [exerciseId, limit],
    )
    .map((r) => ({ date: r.date, byExerciseId: r.by }));
}
