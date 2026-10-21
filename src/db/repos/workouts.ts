import type { Workout, WorkoutExercise, WorkoutSet } from '@/domain/types';

import { db } from '../db';
import { bool, int, parseBarSpeed, parseIntention, parseProgression, parseSetType, parseStatus } from '../parse';

interface WorkoutRow {
  id: string;
  name: string;
  date: string;
  template_id: string | null;
  planned_id: string | null;
  mesocycle_id: string | null;
  week_index: number | null;
  is_deload: number;
  bodyweight: number | null;
  started_at: number;
  ended_at: number | null;
  status: string;
  notes: string;
}

interface WorkoutExerciseRow {
  id: string;
  workout_id: string;
  exercise_id: string;
  position: number;
  progression_type: string;
  intention: string;
  rep_min: number;
  rep_max: number;
  backoff_percent: number;
  template_exercise_id: string | null;
  reference_e1rm: number | null;
  replaces_exercise_id: string | null;
  notes: string;
}

export interface SetRow {
  id: string;
  workout_exercise_id: string;
  position: number;
  set_type: string;
  type_manual: number;
  weight: number | null;
  reps: number | null;
  target_weight: number | null;
  target_reps: number | null;
  target_reps_max: number | null;
  bar_speed: string | null;
  is_test: number;
  note: string | null;
  completed: number;
  completed_at: number | null;
}

export const toWorkout = (r: WorkoutRow): Workout => ({
  id: r.id,
  name: r.name,
  date: r.date,
  templateId: r.template_id,
  plannedId: r.planned_id,
  mesocycleId: r.mesocycle_id,
  weekIndex: r.week_index,
  isDeload: bool(r.is_deload),
  bodyweight: r.bodyweight,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  status: parseStatus(r.status),
  notes: r.notes,
});

const toWorkoutExercise = (r: WorkoutExerciseRow): WorkoutExercise => ({
  id: r.id,
  workoutId: r.workout_id,
  exerciseId: r.exercise_id,
  position: r.position,
  progressionType: parseProgression(r.progression_type),
  intention: parseIntention(r.intention),
  repMin: r.rep_min,
  repMax: r.rep_max,
  backoffPercent: r.backoff_percent,
  templateExerciseId: r.template_exercise_id,
  referenceE1rm: r.reference_e1rm,
  replacesExerciseId: r.replaces_exercise_id,
  notes: r.notes,
});

export const toSet = (r: SetRow): WorkoutSet => ({
  id: r.id,
  workoutExerciseId: r.workout_exercise_id,
  position: r.position,
  setType: parseSetType(r.set_type),
  typeManual: bool(r.type_manual),
  weight: r.weight,
  reps: r.reps,
  targetWeight: r.target_weight,
  targetReps: r.target_reps,
  targetRepsMax: r.target_reps_max,
  barSpeed: parseBarSpeed(r.bar_speed),
  isTest: bool(r.is_test),
  note: r.note ?? '',
  completed: bool(r.completed),
  completedAt: r.completed_at,
});

// ---------- workouts ----------

export function insertWorkout(w: Workout): void {
  db().run(
    `INSERT INTO workouts (id, name, date, template_id, planned_id, mesocycle_id, week_index, is_deload, bodyweight,
       started_at, ended_at, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      w.id,
      w.name,
      w.date,
      w.templateId,
      w.plannedId,
      w.mesocycleId,
      w.weekIndex,
      int(w.isDeload),
      w.bodyweight,
      w.startedAt,
      w.endedAt,
      w.status,
      w.notes,
    ],
  );
}

export function getWorkout(id: string): Workout | null {
  const r = db().first<WorkoutRow>('SELECT * FROM workouts WHERE id = ?', [id]);
  return r === null ? null : toWorkout(r);
}

export function getActiveWorkout(): Workout | null {
  const r = db().first<WorkoutRow>("SELECT * FROM workouts WHERE status = 'active' ORDER BY started_at DESC LIMIT 1");
  return r === null ? null : toWorkout(r);
}

export function listWorkouts(from: string, to: string): Workout[] {
  return db()
    .all<WorkoutRow>('SELECT * FROM workouts WHERE date BETWEEN ? AND ? ORDER BY date, started_at', [from, to])
    .map(toWorkout);
}

export function recentWorkouts(limit: number): Workout[] {
  return db()
    .all<WorkoutRow>("SELECT * FROM workouts WHERE status = 'completed' ORDER BY date DESC, started_at DESC LIMIT ?", [limit])
    .map(toWorkout);
}

type WorkoutMetaPatch = Partial<Pick<Workout, 'name' | 'notes' | 'date' | 'status' | 'endedAt' | 'bodyweight'>>;

const META_COLUMNS: readonly (readonly [keyof WorkoutMetaPatch, string])[] = [
  ['name', 'name'],
  ['notes', 'notes'],
  ['date', 'date'],
  ['status', 'status'],
  ['endedAt', 'ended_at'],
  ['bodyweight', 'bodyweight'],
];

export function updateWorkoutMeta(id: string, patch: WorkoutMetaPatch): void {
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  for (const [key, column] of META_COLUMNS) {
    const value = patch[key];
    if (value === undefined) continue;
    fields.push(`${column} = ?`);
    values.push(value);
  }
  if (fields.length === 0) return;
  db().run(`UPDATE workouts SET ${fields.join(', ')} WHERE id = ?`, [...values, id]);
}

export function deleteWorkout(id: string): void {
  db().transaction(() => {
    db().run('UPDATE planned_sessions SET workout_id = NULL WHERE workout_id = ?', [id]);
    db().run('DELETE FROM workouts WHERE id = ?', [id]);
  });
}

// ---------- workout exercises ----------

export function insertWorkoutExercise(we: WorkoutExercise): void {
  db().run(
    `INSERT INTO workout_exercises (id, workout_id, exercise_id, position, progression_type, intention, rep_min, rep_max,
       backoff_percent, template_exercise_id, reference_e1rm, replaces_exercise_id, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      we.id,
      we.workoutId,
      we.exerciseId,
      we.position,
      we.progressionType,
      we.intention,
      we.repMin,
      we.repMax,
      we.backoffPercent,
      we.templateExerciseId,
      we.referenceE1rm,
      we.replacesExerciseId,
      we.notes,
    ],
  );
}

export function listWorkoutExercises(workoutId: string): WorkoutExercise[] {
  return db()
    .all<WorkoutExerciseRow>('SELECT * FROM workout_exercises WHERE workout_id = ? ORDER BY position', [workoutId])
    .map(toWorkoutExercise);
}

export function updateWorkoutExercise(we: WorkoutExercise): void {
  db().run(
    `UPDATE workout_exercises SET exercise_id = ?, position = ?, progression_type = ?, intention = ?, rep_min = ?, rep_max = ?,
       backoff_percent = ?, reference_e1rm = ?, replaces_exercise_id = ?, notes = ? WHERE id = ?`,
    [
      we.exerciseId,
      we.position,
      we.progressionType,
      we.intention,
      we.repMin,
      we.repMax,
      we.backoffPercent,
      we.referenceE1rm,
      we.replacesExerciseId,
      we.notes,
      we.id,
    ],
  );
}

export function deleteWorkoutExercise(id: string): void {
  db().run('DELETE FROM workout_exercises WHERE id = ?', [id]);
}

// ---------- sets ----------

export function insertSet(s: WorkoutSet): void {
  db().run(
    `INSERT INTO sets (id, workout_exercise_id, position, set_type, type_manual, weight, reps, target_weight, target_reps,
       target_reps_max, bar_speed, is_test, note, completed, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      s.id,
      s.workoutExerciseId,
      s.position,
      s.setType,
      int(s.typeManual),
      s.weight,
      s.reps,
      s.targetWeight,
      s.targetReps,
      s.targetRepsMax,
      s.barSpeed,
      int(s.isTest),
      s.note,
      int(s.completed),
      s.completedAt,
    ],
  );
}

export function updateSet(s: WorkoutSet): void {
  db().run(
    `UPDATE sets SET position = ?, set_type = ?, type_manual = ?, weight = ?, reps = ?, target_weight = ?, target_reps = ?,
       target_reps_max = ?, bar_speed = ?, is_test = ?, note = ?, completed = ?, completed_at = ? WHERE id = ?`,
    [
      s.position,
      s.setType,
      int(s.typeManual),
      s.weight,
      s.reps,
      s.targetWeight,
      s.targetReps,
      s.targetRepsMax,
      s.barSpeed,
      int(s.isTest),
      s.note,
      int(s.completed),
      s.completedAt,
      s.id,
    ],
  );
}

export function deleteSet(id: string): void {
  db().run('DELETE FROM sets WHERE id = ?', [id]);
}

export function listSetsForWorkout(workoutId: string): WorkoutSet[] {
  return db()
    .all<SetRow>(
      `SELECT s.* FROM sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id
       WHERE we.workout_id = ? ORDER BY we.position, s.position`,
      [workoutId],
    )
    .map(toSet);
}

/**
 * Closing a workout: sets with both values typed count as done (the user just forgot the tick);
 * prescribed sets never touched are dropped, as are exercises left empty without notes.
 */
export function settleSetsOnFinish(workoutId: string, now: number): void {
  const inWorkout = 'workout_exercise_id IN (SELECT id FROM workout_exercises WHERE workout_id = ?)';
  db().run(
    `UPDATE sets SET completed = 1, completed_at = ? WHERE completed = 0 AND weight IS NOT NULL AND reps IS NOT NULL AND ${inWorkout}`,
    [now, workoutId],
  );
  db().run(`DELETE FROM sets WHERE completed = 0 AND ${inWorkout}`, [workoutId]);
  db().run(
    `DELETE FROM workout_exercises WHERE workout_id = ? AND notes = ''
       AND id NOT IN (SELECT DISTINCT workout_exercise_id FROM sets)`,
    [workoutId],
  );
}
