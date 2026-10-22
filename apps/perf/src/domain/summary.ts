import { estimate1RM } from './math';
import { isReliable } from './reference';
import type { SetType } from './types';

/** A completed set of the session, with what is needed to judge it. */
export interface SummarySet {
  exerciseId: string;
  exerciseName: string;
  setType: SetType;
  weight: number;
  reps: number;
  /** Bodyweight for weighted (lest) exercises, null otherwise. */
  bodyweight: number | null;
  /** Main lifts (top set + backoff): only sets ≤ 6 reps count for records. */
  strength: boolean;
}

export interface SessionRecord {
  exerciseId: string;
  exerciseName: string;
  weight: number;
  reps: number;
  e1rm: number;
  previous: number;
  lest: boolean;
}

export interface SessionSummary {
  durationMin: number | null;
  sets: number;
  reps: number;
  /** Load moved (kg), total mass for weighted exercises. Warm-ups excluded. */
  tonnage: number;
  exercises: number;
  records: SessionRecord[];
  /** Tonnage of the previous session of the same template, when there is one. */
  previousTonnage: number | null;
  /** Deload week: volume is lower on purpose (filled in by the service). */
  deload?: boolean;
}

/**
 * End-of-session report. `bestBefore` = best e1RM per exercise before this session (reliable sets
 * only for main lifts), so a record is a set that beats it.
 */
export function summarizeSession(input: {
  startedAt: number;
  endedAt: number | null;
  sets: readonly SummarySet[];
  bestBefore: ReadonlyMap<string, number>;
  previousTonnage: number | null;
}): SessionSummary {
  const work = input.sets.filter((s) => s.setType !== 'warmup' && s.reps > 0);
  const tonnage = work.reduce((t, s) => t + (s.weight + (s.bodyweight ?? 0)) * s.reps, 0);
  const best = new Map<string, SessionRecord>();
  for (const s of work) {
    if (s.strength && !isReliable(s.reps)) continue;
    const e1rm = estimate1RM(s.weight, s.reps, s.bodyweight);
    const previous = input.bestBefore.get(s.exerciseId);
    if (previous === undefined || e1rm <= previous + 1e-6) continue;
    const current = best.get(s.exerciseId);
    if (current === undefined || e1rm > current.e1rm) {
      best.set(s.exerciseId, { exerciseId: s.exerciseId, exerciseName: s.exerciseName, weight: s.weight, reps: s.reps, e1rm, previous, lest: s.bodyweight !== null });
    }
  }
  const duration = input.endedAt === null ? null : Math.max(0, Math.round((input.endedAt - input.startedAt) / 60000));
  return {
    durationMin: duration,
    sets: work.length,
    reps: work.reduce((n, s) => n + s.reps, 0),
    tonnage: Math.round(tonnage),
    exercises: new Set(work.map((s) => s.exerciseId)).size,
    records: [...best.values()],
    previousTonnage: input.previousTonnage === null ? null : Math.round(input.previousTonnage),
  };
}

/**
 * Live record check when a set is validated: beats the best e1RM before this session and the
 * best of today, is not a warm-up, and (main lifts) is a reliable set. No history → no record.
 */
export function isRecordSet(p: { e1rm: number; historicBest: number | null; bestToday: number; setType: SetType; countsForRecord: boolean }): boolean {
  return p.historicBest !== null && p.countsForRecord && p.setType !== 'warmup' && p.e1rm > p.historicBest + 1e-6 && p.e1rm > p.bestToday + 1e-6;
}
