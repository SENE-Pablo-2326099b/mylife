import type { PlanProposal } from '@/domain/planning';
import type { PlannedSession } from '@/domain/types';

import { db, newId } from '../db';

interface PlannedRow {
  id: string;
  date: string;
  template_id: string | null;
  title: string;
  position: number;
  workout_id: string | null;
}

const toPlanned = (r: PlannedRow): PlannedSession => ({
  id: r.id,
  date: r.date,
  templateId: r.template_id,
  title: r.title,
  position: r.position,
  workoutId: r.workout_id,
});

export function listPlanned(from: string, to: string): PlannedSession[] {
  return db()
    .all<PlannedRow>('SELECT * FROM planned_sessions WHERE date BETWEEN ? AND ? ORDER BY date, position', [from, to])
    .map(toPlanned);
}

export function getPlanned(id: string): PlannedSession | null {
  const r = db().first<PlannedRow>('SELECT * FROM planned_sessions WHERE id = ?', [id]);
  return r === null ? null : toPlanned(r);
}

export function addPlanned(date: string, templateId: string, title: string): string {
  const id = newId();
  const pos = db().first<{ p: number | null }>('SELECT MAX(position) AS p FROM planned_sessions WHERE date = ?', [date])?.p ?? -1;
  db().run(
    'INSERT INTO planned_sessions (id, date, template_id, title, position, workout_id, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)',
    [id, date, templateId, title, pos + 1, Date.now()],
  );
  return id;
}

export function addPlannedBulk(items: readonly (PlanProposal & { title: string })[]): void {
  db().transaction(() => {
    for (const p of items) {
      db().run(
        'INSERT INTO planned_sessions (id, date, template_id, title, position, workout_id, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)',
        [newId(), p.date, p.templateId, p.title, p.position, Date.now()],
      );
    }
  });
}

export function movePlanned(id: string, date: string): void {
  const pos = db().first<{ p: number | null }>('SELECT MAX(position) AS p FROM planned_sessions WHERE date = ?', [date])?.p ?? -1;
  db().run('UPDATE planned_sessions SET date = ?, position = ? WHERE id = ?', [date, pos + 1, id]);
}

export function deletePlanned(id: string): void {
  db().run('DELETE FROM planned_sessions WHERE id = ?', [id]);
}

export function linkPlannedWorkout(id: string, workoutId: string | null): void {
  db().run('UPDATE planned_sessions SET workout_id = ? WHERE id = ?', [workoutId, id]);
}

/** Pending (not done) planned sessions in a range — used to clear a regenerated plan. */
export function deletePendingPlanned(from: string, to: string): void {
  db().run('DELETE FROM planned_sessions WHERE workout_id IS NULL AND date BETWEEN ? AND ?', [from, to]);
}

export function datesWithPlansOrWorkouts(from: string, to: string): Set<string> {
  const rows = db().all<{ date: string }>(
    `SELECT date FROM planned_sessions WHERE date BETWEEN ? AND ?
     UNION SELECT date FROM workouts WHERE date BETWEEN ? AND ?`,
    [from, to, from, to],
  );
  return new Set(rows.map((r) => r.date));
}
