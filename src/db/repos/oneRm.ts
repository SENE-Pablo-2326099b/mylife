import { db } from '../db';

export type OneRmMode = 'manual' | 'estimated';

/** The 1RM the user typed for a lift, as logged (lest for weighted lifts, bar load otherwise). */
export interface OneRm {
  exerciseId: string;
  value: number;
  /** manual: this value drives the loads · estimated: the history estimate does (value kept for later). */
  mode: OneRmMode;
  /** Day the value was typed or last confirmed: S4 / tests after it may suggest an update. */
  setOn: string;
}

interface Row {
  exercise_id: string;
  value: number;
  mode: string;
  set_on: string;
}

const toOneRm = (r: Row): OneRm => ({ exerciseId: r.exercise_id, value: r.value, mode: r.mode === 'estimated' ? 'estimated' : 'manual', setOn: r.set_on });

export function getOneRm(exerciseId: string): OneRm | null {
  const r = db().first<Row>('SELECT exercise_id, value, mode, set_on FROM exercise_one_rm WHERE exercise_id = ?', [exerciseId]);
  return r === null ? null : toOneRm(r);
}

export function listOneRms(): OneRm[] {
  return db().all<Row>('SELECT exercise_id, value, mode, set_on FROM exercise_one_rm').map(toOneRm);
}

export function saveOneRm(o: OneRm): void {
  db().run(
    `INSERT INTO exercise_one_rm (exercise_id, value, mode, set_on, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(exercise_id) DO UPDATE SET value = excluded.value, mode = excluded.mode, set_on = excluded.set_on, updated_at = excluded.updated_at`,
    [o.exerciseId, o.value, o.mode, o.setOn, Date.now()],
  );
}

export function deleteOneRm(exerciseId: string): void {
  db().run('DELETE FROM exercise_one_rm WHERE exercise_id = ?', [exerciseId]);
}
