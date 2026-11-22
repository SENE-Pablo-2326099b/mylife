import { addDays, startOfWeek } from './dates';
import { estimate1RM } from './math';
import type { ExerciseCategory, Muscle, SetType } from './types';

/** A completed set joined with the context analytics need. */
export interface SetRecord {
  workoutId: string;
  date: string;
  mesocycleId: string | null;
  weekIndex: number | null;
  setType: SetType;
  weight: number;
  reps: number;
  bodyweight: number | null;
}

export function setE1rm(s: Pick<SetRecord, 'weight' | 'reps' | 'bodyweight'>): number {
  return estimate1RM(s.weight, s.reps, s.bodyweight);
}

const counts = (s: Pick<SetRecord, 'setType'>) => s.setType !== 'warmup';

export interface E1rmPoint {
  date: string;
  e1rm: number;
  weight: number;
  reps: number;
  /** False when the point comes from a set above the reliable rep count (main lifts only). */
  reliable: boolean;
}

/**
 * Best e1RM per workout, chronological — the e1RM curve.
 * With `reliableMaxReps` (main lifts), a session's point comes from its sets at or under that rep
 * count when it has any; otherwise from its best set, flagged unreliable.
 */
export function e1rmSeries(sets: readonly SetRecord[], reliableMaxReps?: number): E1rmPoint[] {
  const byWorkout = new Map<string, E1rmPoint>();
  for (const s of sets) {
    if (!counts(s) || s.reps <= 0) continue;
    const e1rm = setE1rm(s);
    const reliable = reliableMaxReps === undefined || s.reps <= reliableMaxReps;
    const current = byWorkout.get(s.workoutId);
    const better =
      current === undefined || (reliable && !current.reliable) || (reliable === current.reliable && e1rm > current.e1rm);
    if (better) byWorkout.set(s.workoutId, { date: s.date, e1rm, weight: s.weight, reps: s.reps, reliable });
  }
  return [...byWorkout.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export interface CycleBest {
  mesocycleId: string;
  e1rm: number;
  date: string;
}

/** Max e1RM per mesocycle, in the order of `mesocycleOrder` (oldest first). Cycles without data are skipped. */
export function bestPerCycle(sets: readonly SetRecord[], mesocycleOrder: readonly string[]): CycleBest[] {
  const best = new Map<string, CycleBest>();
  for (const s of sets) {
    if (s.mesocycleId === null || !counts(s) || s.reps <= 0) continue;
    const e1rm = setE1rm(s);
    const current = best.get(s.mesocycleId);
    if (current === undefined || e1rm > current.e1rm) best.set(s.mesocycleId, { mesocycleId: s.mesocycleId, e1rm, date: s.date });
  }
  return mesocycleOrder.flatMap((id) => {
    const b = best.get(id);
    return b === undefined ? [] : [b];
  });
}

/** Gains below this ratio are noise and do not count as progress. */
export const PROGRESS_THRESHOLD = 0.005;

/**
 * Stagnation: the e1RM did not beat the best of earlier cycles for `minCycles` (default 2)
 * consecutive cycles. Needs a baseline cycle, so at least minCycles + 1 cycles of data.
 */
export function detectStagnation(
  cycleBests: readonly Pick<CycleBest, 'e1rm'>[],
  minCycles = 2,
): { stagnant: boolean; cycles: number } {
  let bestSoFar = cycleBests[0]?.e1rm ?? 0;
  let streak = 0;
  for (const c of cycleBests.slice(1)) {
    if (c.e1rm > bestSoFar * (1 + PROGRESS_THRESHOLD)) {
      streak = 0;
    } else {
      streak += 1;
    }
    bestSoFar = Math.max(bestSoFar, c.e1rm);
  }
  return { stagnant: streak >= minCycles, cycles: streak };
}

export interface VolumeSet {
  date: string;
  setType: SetType;
  primaryMuscles: readonly Muscle[];
  secondaryMuscles: readonly Muscle[];
  category: ExerciseCategory;
}

/** Arms: only isolation work counts as direct volume; compounds that hit them (dips, rows, presses) are indirect. */
export const ARM_MUSCLES: readonly Muscle[] = ['biceps', 'triceps', 'forearms'];

export function isIndirect(muscle: Muscle, category: ExerciseCategory): boolean {
  return category !== 'isolation' && ARM_MUSCLES.includes(muscle);
}

export interface MuscleVolume {
  /** Hard sets that count toward the muscle's target. */
  direct: number;
  /** Arms only: sets of compounds that also work them, shown apart. */
  indirect: number;
}

/**
 * Hard sets per muscle per week (week key = Monday). Warmups excluded.
 * A set counts 1 for each primary muscle and 0.5 for each secondary muscle (fractional volume);
 * for the arms, sets of compound exercises go to `indirect` instead of `direct`.
 */
export function weeklyVolume(sets: readonly VolumeSet[]): Map<string, Map<Muscle, MuscleVolume>> {
  const weeks = new Map<string, Map<Muscle, MuscleVolume>>();
  const add = (week: Map<Muscle, MuscleVolume>, m: Muscle, v: number, category: ExerciseCategory) => {
    const cur = week.get(m) ?? { direct: 0, indirect: 0 };
    if (isIndirect(m, category)) cur.indirect += v;
    else cur.direct += v;
    week.set(m, cur);
  };
  for (const s of sets) {
    if (s.setType === 'warmup') continue;
    const key = startOfWeek(s.date);
    let week = weeks.get(key);
    if (week === undefined) {
      week = new Map();
      weeks.set(key, week);
    }
    for (const m of s.primaryMuscles) add(week, m, 1, s.category);
    for (const m of s.secondaryMuscles) {
      if (!s.primaryMuscles.includes(m)) add(week, m, 0.5, s.category);
    }
  }
  return weeks;
}

export interface PersonalRecords {
  bestE1rm: E1rmPoint | null;
  heaviest: E1rmPoint | null;
  /** Heaviest weight for each rep count (1..12). */
  repMaxes: { reps: number; weight: number; date: string }[];
}

export function personalRecords(sets: readonly SetRecord[], maxReps = 12, reliableMaxReps?: number): PersonalRecords {
  let bestReliable: E1rmPoint | null = null;
  let bestAny: E1rmPoint | null = null;
  let heaviest: E1rmPoint | null = null;
  const repMax = new Map<number, { weight: number; date: string }>();
  for (const s of sets) {
    if (!counts(s) || s.reps <= 0) continue;
    const e1rm = setE1rm(s);
    const reliable = reliableMaxReps === undefined || s.reps <= reliableMaxReps;
    const point = { date: s.date, e1rm, weight: s.weight, reps: s.reps, reliable };
    if (bestAny === null || e1rm > bestAny.e1rm) bestAny = point;
    if (reliable && (bestReliable === null || e1rm > bestReliable.e1rm)) bestReliable = point;
    if (heaviest === null || s.weight > heaviest.weight || (s.weight === heaviest.weight && s.reps > heaviest.reps)) {
      heaviest = point;
    }
    if (s.reps <= maxReps) {
      const current = repMax.get(s.reps);
      if (current === undefined || s.weight > current.weight) repMax.set(s.reps, { weight: s.weight, date: s.date });
    }
  }
  // A heavier weight at more reps also beats the lower-rep record: keep the table monotonic.
  const repMaxes: PersonalRecords['repMaxes'] = [];
  let carry = -Infinity;
  for (let r = maxReps; r >= 1; r--) {
    const rec = repMax.get(r);
    if (rec !== undefined && rec.weight > carry) {
      carry = rec.weight;
      repMaxes.unshift({ reps: r, ...rec });
    }
  }
  // Main lifts: the record e1RM comes from a reliable set whenever one exists.
  return { bestE1rm: bestReliable ?? bestAny, heaviest, repMaxes };
}

/** Is this set a new e1RM record compared to `previousBest`? */
export function isE1rmPr(set: Pick<SetRecord, 'weight' | 'reps' | 'bodyweight'>, previousBest: number | null): boolean {
  return previousBest !== null && setE1rm(set) > previousBest + 1e-9;
}

/** Heaviest top set per training week, for the "top set history" view. */
export function topSetHistory(sets: readonly SetRecord[]): { week: string; weight: number; reps: number; date: string }[] {
  const byWeek = new Map<string, { week: string; weight: number; reps: number; date: string }>();
  for (const s of sets) {
    if (s.setType !== 'top_set') continue;
    const week = startOfWeek(s.date);
    const cur = byWeek.get(week);
    if (cur === undefined || s.weight > cur.weight || (s.weight === cur.weight && s.reps > cur.reps)) {
      byWeek.set(week, { week, weight: s.weight, reps: s.reps, date: s.date });
    }
  }
  return [...byWeek.values()].sort((a, b) => (a.week < b.week ? -1 : 1));
}

export interface Consistency {
  /** Consecutive weeks reaching the goal, ending with the current week (or last week while the current one is still open). */
  streak: number;
  /** Sessions per week, oldest first, the current week last. */
  weeks: { start: string; sessions: number }[];
  /** Weeks reaching the goal among the shown ones. */
  hit: number;
}

/**
 * Weekly consistency: a week counts when it has at least `goal` sessions. The current week does
 * not break the streak while it is still in progress.
 */
export function weeklyConsistency(sessionDates: readonly string[], today: string, goal: number, weeks = 12): Consistency {
  const current = startOfWeek(today);
  const counts = new Map<string, number>();
  for (const d of sessionDates) {
    const w = startOfWeek(d);
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  const shift = (w: string, n: number) => addDays(w, 7 * n);
  const list = Array.from({ length: weeks }, (_, i) => {
    const start = shift(current, i - weeks + 1);
    return { start, sessions: counts.get(start) ?? 0 };
  });
  const target = Math.max(1, goal);
  let streak = 0;
  let w = current;
  if ((counts.get(w) ?? 0) < target) w = shift(w, -1);
  while ((counts.get(w) ?? 0) >= target) {
    streak += 1;
    w = shift(w, -1);
  }
  return { streak, weeks: list, hit: list.filter((x) => x.sessions >= target).length };
}

export interface RecordEvent {
  date: string;
  workoutId: string;
  weight: number;
  reps: number;
  e1rm: number;
  /** Gain over the previous best (kg). */
  gain: number;
}

/**
 * Every time an exercise beat its best e1RM, chronologically (first-ever session excluded: there
 * is nothing to beat yet). With `reliableMaxReps`, only sets up to that many reps count.
 */
export function recordEvents(sets: readonly SetRecord[], reliableMaxReps?: number): RecordEvent[] {
  const out: RecordEvent[] = [];
  let best: number | null = null;
  let firstWorkout: string | null = null;
  for (const s of sets) {
    if (!counts(s) || s.reps <= 0) continue;
    if (reliableMaxReps !== undefined && s.reps > reliableMaxReps) continue;
    const e1rm = setE1rm(s);
    firstWorkout ??= s.workoutId;
    if (best === null || s.workoutId === firstWorkout) {
      best = Math.max(best ?? 0, e1rm);
      continue;
    }
    if (e1rm > best + 1e-6) {
      const last = out[out.length - 1];
      const event = { date: s.date, workoutId: s.workoutId, weight: s.weight, reps: s.reps, e1rm, gain: e1rm - best };
      // One event per session: keep the best set.
      if (last !== undefined && last.workoutId === s.workoutId) {
        event.gain = last.gain + (e1rm - best);
        out[out.length - 1] = event;
      } else out.push(event);
      best = e1rm;
    }
  }
  return out;
}
