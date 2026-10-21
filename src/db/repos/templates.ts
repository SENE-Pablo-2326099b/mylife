import type { Exercise, Intention, Template, TemplateExercise, WeekPatternEntry } from '@/domain/types';

import { db, newId } from '../db';
import { insertRaw, selectRaw } from '../raw';
import { parseIntention, parseProgression } from '../parse';

interface TemplateRow {
  id: string;
  name: string;
  notes: string;
  position: number;
}

interface TemplateExerciseRow {
  id: string;
  template_id: string;
  exercise_id: string;
  position: number;
  intention: string;
  target_sets: number;
  rep_min: number | null;
  rep_max: number | null;
  top_sets: number | null;
  backoff_sets: number | null;
  backoff_percent: number | null;
  progression_type: string | null;
  notes: string;
}

function toTemplateExercise(r: TemplateExerciseRow): TemplateExercise {
  return {
    id: r.id,
    templateId: r.template_id,
    exerciseId: r.exercise_id,
    position: r.position,
    intention: parseIntention(r.intention),
    targetSets: r.target_sets,
    progressionType: r.progression_type === null ? null : parseProgression(r.progression_type),
    repMin: r.rep_min,
    repMax: r.rep_max,
    topSets: r.top_sets,
    backoffSets: r.backoff_sets,
    backoffPercent: r.backoff_percent,
    notes: r.notes,
  };
}

export function listTemplates(): Template[] {
  return db().all<TemplateRow>('SELECT id, name, notes, position FROM templates WHERE archived = 0 ORDER BY position, created_at');
}

export function getTemplate(id: string): Template | null {
  return db().first<TemplateRow>('SELECT id, name, notes, position FROM templates WHERE id = ?', [id]);
}

export function createTemplate(name: string, id: string = newId()): string {
  const pos = db().first<{ p: number | null }>('SELECT MAX(position) AS p FROM templates')?.p ?? -1;
  db().run('INSERT INTO templates (id, name, notes, position, archived, created_at) VALUES (?, ?, ?, ?, 0, ?)', [
    id,
    name.trim(),
    '',
    pos + 1,
    Date.now(),
  ]);
  return id;
}

export function renameTemplate(id: string, name: string): void {
  db().run('UPDATE templates SET name = ? WHERE id = ?', [name.trim(), id]);
}

/** Archived rather than deleted: past workouts reference it. Future plans and the pattern are cleared. */
/** Archives a template; the returned function restores it with its pattern days and future plans. */
export function archiveTemplateUndoable(id: string): () => void {
  const pattern = selectRaw('week_pattern', 'template_id = ?', [id]);
  const planned = selectRaw('planned_sessions', 'template_id = ? AND workout_id IS NULL', [id]);
  archiveTemplate(id);
  return () =>
    db().transaction(() => {
      db().run('UPDATE templates SET archived = 0 WHERE id = ?', [id]);
      for (const r of pattern) insertRaw('week_pattern', r);
      for (const r of planned) insertRaw('planned_sessions', r);
    });
}

export function archiveTemplate(id: string): void {
  db().transaction(() => {
    db().run('UPDATE templates SET archived = 1 WHERE id = ?', [id]);
    db().run('DELETE FROM week_pattern WHERE template_id = ?', [id]);
    db().run('DELETE FROM planned_sessions WHERE template_id = ? AND workout_id IS NULL', [id]);
  });
}

export function listTemplateExercises(templateId: string): TemplateExercise[] {
  return db()
    .all<TemplateExerciseRow>('SELECT * FROM template_exercises WHERE template_id = ? ORDER BY position', [templateId])
    .map(toTemplateExercise);
}

/** Intention inferred from the exercise; editable afterwards. */
export function defaultIntention(ex: Exercise): Intention {
  return ex.progressionType === 'top_set_backoff' || ex.category === 'main' ? 'strength' : 'hypertrophy';
}

export function addTemplateExercise(templateId: string, ex: Exercise): string {
  const id = newId();
  const pos = db().first<{ p: number | null }>('SELECT MAX(position) AS p FROM template_exercises WHERE template_id = ?', [
    templateId,
  ])?.p ?? -1;
  db().run(
    `INSERT INTO template_exercises (id, template_id, exercise_id, position, intention, target_sets, rep_min, rep_max,
       top_sets, backoff_sets, backoff_percent, notes)
     VALUES (?, ?, ?, ?, ?, 3, NULL, NULL, NULL, NULL, NULL, '')`,
    [id, templateId, ex.id, pos + 1, defaultIntention(ex)],
  );
  return id;
}

export function updateTemplateExercise(te: TemplateExercise): void {
  db().run(
    `UPDATE template_exercises SET exercise_id = ?, intention = ?, target_sets = ?, rep_min = ?, rep_max = ?, top_sets = ?,
       backoff_sets = ?, backoff_percent = ?, progression_type = ?, notes = ? WHERE id = ?`,
    [
      te.exerciseId,
      te.intention,
      te.targetSets,
      te.repMin,
      te.repMax,
      te.topSets,
      te.backoffSets,
      te.backoffPercent,
      te.progressionType,
      te.notes,
      te.id,
    ],
  );
}

export function removeTemplateExercise(id: string): void {
  db().run('DELETE FROM template_exercises WHERE id = ?', [id]);
}

/** Removes an exercise from a template; the returned function puts it back in place. */
export function removeTemplateExerciseUndoable(id: string): () => void {
  const row = selectRaw('template_exercises', 'id = ?', [id])[0];
  removeTemplateExercise(id);
  return () => {
    if (row !== undefined) insertRaw('template_exercises', row);
  };
}

export function reorderTemplateExercises(orderedIds: readonly string[]): void {
  db().transaction(() => {
    orderedIds.forEach((id, i) => db().run('UPDATE template_exercises SET position = ? WHERE id = ?', [i, id]));
  });
}

interface PatternRow {
  id: string;
  weekday: number;
  template_id: string;
  position: number;
}

export function getWeekPattern(): WeekPatternEntry[] {
  return db()
    .all<PatternRow>('SELECT * FROM week_pattern ORDER BY weekday, position')
    .map((r) => ({ id: r.id, weekday: r.weekday, templateId: r.template_id, position: r.position }));
}

export function addPatternEntry(weekday: number, templateId: string): void {
  const pos = db().first<{ p: number | null }>('SELECT MAX(position) AS p FROM week_pattern WHERE weekday = ?', [weekday])?.p ?? -1;
  db().run('INSERT INTO week_pattern (id, weekday, template_id, position) VALUES (?, ?, ?, ?)', [
    newId(),
    weekday,
    templateId,
    pos + 1,
  ]);
}

export function removePatternEntry(id: string): void {
  db().run('DELETE FROM week_pattern WHERE id = ?', [id]);
}

/** Active template slots using an exercise (to find its usual settings). */
export function templateSlotsForExercise(exerciseId: string): TemplateExercise[] {
  return db()
    .all<TemplateExerciseRow>(
      `SELECT te.* FROM template_exercises te JOIN templates t ON t.id = te.template_id
       WHERE te.exercise_id = ? AND t.archived = 0 ORDER BY t.position, te.position`,
      [exerciseId],
    )
    .map(toTemplateExercise);
}

export function getTemplateExercise(id: string): TemplateExercise | null {
  const r = db().first<TemplateExerciseRow>('SELECT * FROM template_exercises WHERE id = ?', [id]);
  return r === null ? null : toTemplateExercise(r);
}
