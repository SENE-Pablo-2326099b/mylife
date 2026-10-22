import type { Exercise } from '@/domain/types';

import { db, newId } from '../db';
import {
  bool,
  int,
  parseCategory,
  parseEquipment,
  parseLoadType,
  parseMuscles,
  parseProgression,
} from '../parse';

interface ExerciseRow {
  id: string;
  name: string;
  primary_muscles: string;
  secondary_muscles: string;
  equipment: string;
  unilateral: number;
  load_type: string;
  category: string;
  progression_type: string;
  backoff_percent: number;
  rep_range_min: number;
  rep_range_max: number;
  weight_increment: number | null;
  is_custom: number;
  archived: number;
  notes: string;
}

function toExercise(r: ExerciseRow): Exercise {
  return {
    id: r.id,
    name: r.name,
    primaryMuscles: parseMuscles(r.primary_muscles),
    secondaryMuscles: parseMuscles(r.secondary_muscles),
    equipment: parseEquipment(r.equipment),
    unilateral: bool(r.unilateral),
    loadType: parseLoadType(r.load_type),
    category: parseCategory(r.category),
    progressionType: parseProgression(r.progression_type),
    backoffPercent: r.backoff_percent,
    repRangeMin: r.rep_range_min,
    repRangeMax: r.rep_range_max,
    weightIncrement: r.weight_increment,
    isCustom: bool(r.is_custom),
    archived: bool(r.archived),
    notes: r.notes,
  };
}

export function listExercises(includeArchived = false): Exercise[] {
  const where = includeArchived ? '' : 'WHERE archived = 0';
  return db()
    .all<ExerciseRow>(`SELECT * FROM exercises ${where} ORDER BY name COLLATE NOCASE`)
    .map(toExercise);
}

export function getExercise(id: string): Exercise | null {
  const row = db().first<ExerciseRow>('SELECT * FROM exercises WHERE id = ?', [id]);
  return row === null ? null : toExercise(row);
}

export type ExerciseInput = Omit<Exercise, 'id' | 'archived'>;

export function createExercise(input: ExerciseInput, id: string = newId()): string {
  db().run(
    `INSERT INTO exercises (id, name, primary_muscles, secondary_muscles, equipment, unilateral, load_type, category,
      progression_type, backoff_percent, rep_range_min, rep_range_max, weight_increment, is_custom, archived, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    [
      id,
      input.name.trim(),
      JSON.stringify(input.primaryMuscles),
      JSON.stringify(input.secondaryMuscles),
      input.equipment,
      int(input.unilateral),
      input.loadType,
      input.category,
      input.progressionType,
      input.backoffPercent,
      input.repRangeMin,
      input.repRangeMax,
      input.weightIncrement,
      int(input.isCustom),
      input.notes,
      Date.now(),
    ],
  );
  return id;
}

export function updateExercise(id: string, input: ExerciseInput): void {
  db().run(
    `UPDATE exercises SET name = ?, primary_muscles = ?, secondary_muscles = ?, equipment = ?, unilateral = ?, load_type = ?,
      category = ?, progression_type = ?, backoff_percent = ?, rep_range_min = ?, rep_range_max = ?, weight_increment = ?, notes = ?
     WHERE id = ?`,
    [
      input.name.trim(),
      JSON.stringify(input.primaryMuscles),
      JSON.stringify(input.secondaryMuscles),
      input.equipment,
      int(input.unilateral),
      input.loadType,
      input.category,
      input.progressionType,
      input.backoffPercent,
      input.repRangeMin,
      input.repRangeMax,
      input.weightIncrement,
      input.notes,
      id,
    ],
  );
}

/** Exercises are archived, never deleted: history keeps pointing at them. */
export function setExerciseArchived(id: string, archived: boolean): void {
  db().run('UPDATE exercises SET archived = ? WHERE id = ?', [int(archived), id]);
}

export function exerciseCount(): number {
  return db().first<{ n: number }>('SELECT COUNT(*) AS n FROM exercises')?.n ?? 0;
}
