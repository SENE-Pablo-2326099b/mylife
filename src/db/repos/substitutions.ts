import type { Exercise } from '@/domain/types';

import { db } from '../db';
import { listExercises } from './exercises';

/** Remembers that `to` was done instead of `from` (counts repeated swaps). */
export function recordSubstitution(from: string, to: string, at: number = Date.now()): void {
  if (from === to) return;
  db().run(
    `INSERT INTO exercise_substitutions (from_exercise_id, to_exercise_id, uses, last_used_at) VALUES (?, ?, 1, ?)
     ON CONFLICT(from_exercise_id, to_exercise_id) DO UPDATE SET uses = uses + 1, last_used_at = MAX(last_used_at, excluded.last_used_at)`,
    [from, to, at],
  );
}

/** Ensures an imported substitution exists without double-counting it on re-import. */
export function seedSubstitution(from: string, to: string, uses: number, at: number): void {
  db().run(
    `INSERT INTO exercise_substitutions (from_exercise_id, to_exercise_id, uses, last_used_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(from_exercise_id, to_exercise_id) DO UPDATE SET uses = MAX(uses, excluded.uses),
       last_used_at = MAX(last_used_at, excluded.last_used_at)`,
    [from, to, uses, at],
  );
}

export interface Alternative {
  exercise: Exercise;
  /** Times it was already done instead of this exercise (0 = suggested by muscles). */
  uses: number;
}

/**
 * Replacement candidates for an exercise, best first:
 * 1. what you already did instead of it (most used, then most recent), and what it replaced;
 * 2. other exercises working the same primary muscles, same kind (compound / isolation) first.
 */
export function alternativesFor(exercise: Exercise, limit = 8): Alternative[] {
  const rows = db().all<{ id: string; uses: number; last: number }>(
    `SELECT to_exercise_id AS id, uses, last_used_at AS last FROM exercise_substitutions WHERE from_exercise_id = ?
     UNION ALL
     SELECT from_exercise_id AS id, 0 AS uses, last_used_at AS last FROM exercise_substitutions WHERE to_exercise_id = ?`,
    [exercise.id, exercise.id],
  );
  const all = listExercises().filter((e) => e.id !== exercise.id);
  const byId = new Map(all.map((e) => [e.id, e]));
  const seen = new Set<string>();
  const out: Alternative[] = [];
  for (const r of [...rows].sort((a, b) => b.uses - a.uses || b.last - a.last)) {
    const e = byId.get(r.id);
    if (e === undefined || seen.has(e.id)) continue;
    seen.add(e.id);
    out.push({ exercise: e, uses: r.uses });
  }
  const isolation = exercise.category === 'isolation';
  const scored = all
    .filter((e) => !seen.has(e.id))
    .map((e) => {
      const overlap = e.primaryMuscles.filter((m) => exercise.primaryMuscles.includes(m)).length;
      const sameKind = (e.category === 'isolation') === isolation ? 1 : 0;
      return { e, score: overlap * 10 + sameKind * 3 + (e.isCustom ? 1 : 0) };
    })
    .filter((x) => x.score >= 10)
    .sort((a, b) => b.score - a.score || a.e.name.localeCompare(b.e.name));
  for (const { e } of scored) out.push({ exercise: e, uses: 0 });
  return out.slice(0, limit);
}
