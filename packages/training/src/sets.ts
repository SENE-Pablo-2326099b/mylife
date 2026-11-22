import { backoffWeight, roundToIncrement } from './math';
import type { ProgressionType, SetType, WorkoutSet } from './types';

type SetLike = Pick<WorkoutSet, 'setType' | 'typeManual' | 'weight' | 'targetWeight'>;

/** The weight a set will be logged at: what the user typed, else the prescription. */
export function effectiveWeight(set: Pick<WorkoutSet, 'weight' | 'targetWeight'>): number | null {
  return set.weight ?? set.targetWeight;
}

export function effectiveReps(set: Pick<WorkoutSet, 'reps' | 'targetReps'>): number | null {
  return set.reps ?? set.targetReps;
}

/** Ratios used by auto-detection. A set within 3% of the heaviest is another top set. */
const TOP_SET_TOLERANCE = 0.97;
/** A working set more than 15% lighter than the previous one is a drop set. */
const DROP_RATIO = 0.85;
/** Double progression: sets lighter than 90% of the heaviest, before it, are warmups. */
const WARMUP_RATIO = 0.9;

/**
 * Auto-detects the type of every set from the loads, in order.
 * Manual types are never changed but still inform the detection.
 * Sets without any weight keep their current (prescribed) type.
 */
export function classifySets(sets: readonly SetLike[], progression: ProgressionType): SetType[] {
  const weights = sets.map(effectiveWeight);
  const candidates = sets
    .map((s, i) => ({ s, w: weights[i] ?? null }))
    .filter(({ s, w }) => w !== null && !(s.typeManual && s.setType !== 'top_set' && s.setType !== 'working'));
  if (candidates.length === 0) return sets.map((s) => s.setType);
  const max = Math.max(...candidates.map(({ w }) => w ?? 0));

  return progression === 'top_set_backoff' ? classifyTopSet(sets, weights, max) : classifyDouble(sets, weights, max);
}

function classifyTopSet(sets: readonly SetLike[], weights: (number | null)[], max: number): SetType[] {
  const topIndex = sets.findIndex((s, i) => {
    if (s.typeManual) return s.setType === 'top_set';
    return weights[i] === max;
  });
  const result: SetType[] = [];
  sets.forEach((set, i) => {
    const w = weights[i] ?? null;
    if (set.typeManual || w === null) {
      result.push(set.setType);
      return;
    }
    if (w >= max * TOP_SET_TOLERANCE) {
      result.push('top_set');
    } else if (topIndex === -1 || i < topIndex) {
      result.push('warmup');
    } else {
      result.push(isDrop(result, weights, i) ? 'drop' : 'backoff');
    }
  });
  return result;
}

function classifyDouble(sets: readonly SetLike[], weights: (number | null)[], max: number): SetType[] {
  const firstWorking = weights.findIndex((w, i) => {
    const s = sets[i];
    if (s?.typeManual) return s.setType === 'working';
    return w !== null && w >= max * WARMUP_RATIO;
  });
  const result: SetType[] = [];
  sets.forEach((set, i) => {
    const w = weights[i] ?? null;
    if (set.typeManual || w === null) {
      result.push(set.setType);
    } else if (firstWorking === -1 || i < firstWorking) {
      result.push('warmup');
    } else {
      result.push(isDrop(result, weights, i) ? 'drop' : 'working');
    }
  });
  return result;
}

function isDrop(previousTypes: SetType[], weights: (number | null)[], i: number): boolean {
  for (let j = i - 1; j >= 0; j--) {
    const prevType = previousTypes[j];
    const prevWeight = weights[j];
    if (prevType === 'warmup' || prevWeight === null || prevWeight === undefined) continue;
    const w = weights[i] ?? 0;
    return prevType !== 'top_set' && w < prevWeight * DROP_RATIO;
  }
  return false;
}

/** Type for a set appended by the user, before any weight is known. */
export function typeForNewSet(sets: readonly Pick<WorkoutSet, 'setType'>[], progression: ProgressionType): SetType {
  if (progression === 'double_progression') return 'working';
  return sets.some((s) => s.setType === 'top_set') ? 'backoff' : 'top_set';
}

/** Weight of the reference top set: the heaviest top set, typed value first. */
export function topSetWeight(sets: readonly Pick<WorkoutSet, 'setType' | 'weight' | 'targetWeight'>[]): number | null {
  let best: number | null = null;
  for (const s of sets) {
    if (s.setType !== 'top_set') continue;
    const w = effectiveWeight(s);
    if (w !== null && (best === null || w > best)) best = w;
  }
  return best;
}

export interface BackoffOptions {
  percent: number;
  increment: number;
  bodyweight: number | null;
}

/**
 * Live backoff recalculation: every non-completed backoff gets its target from the current top set.
 * Returns the same array instance when nothing changed (cheap identity check for the UI),
 * otherwise a new array where only modified sets are new objects.
 */
export function recalcBackoffs<T extends WorkoutSet>(sets: readonly T[], opts: BackoffOptions): readonly T[] {
  const top = topSetWeight(sets);
  if (top === null) return sets;
  const target = backoffWeight(top, opts.percent, opts.increment, opts.bodyweight);
  let changed = false;
  const next = sets.map((s) => {
    if (s.setType !== 'backoff' || s.completed || s.targetWeight === target) return s;
    changed = true;
    return { ...s, targetWeight: target };
  });
  return changed ? next : sets;
}

/**
 * Auto-detection applied to COMPLETED sets only — pending sets keep their prescribed type, so
 * half-typed values never make types flicker. The reference loads still include pending sets the
 * user typed a weight into, and the prescribed top set: doing backoffs before the top set must
 * not turn them into top sets.
 * Returns the same array when nothing changed.
 */
export function reclassifyCompleted<T extends WorkoutSet>(sets: readonly T[], progression: ProgressionType): readonly T[] {
  const reference = sets.filter(
    (s) => s.completed || s.weight !== null || (s.setType === 'top_set' && !s.typeManual && s.targetWeight !== null),
  );
  if (!reference.some((s) => s.completed)) return sets;
  const types = classifySets(reference, progression);
  const byId = new Map(reference.map((s, i) => [s.id, types[i] ?? s.setType]));
  let changed = false;
  const next = sets.map((s) => {
    const t = byId.get(s.id);
    if (!s.completed || t === undefined || t === s.setType) return s;
    changed = true;
    return { ...s, setType: t };
  });
  return changed ? next : sets;
}

/** Next type when the user taps the badge; restricted to types meaningful for the progression. */
/** Set types that make sense for a progression, in the order they are offered. */
export function setTypesFor(progression: ProgressionType): SetType[] {
  return progression === 'top_set_backoff' ? ['top_set', 'backoff', 'drop', 'warmup'] : ['working', 'drop', 'warmup'];
}

export function nextSetType(current: SetType, progression: ProgressionType): SetType {
  const allowed = setTypesFor(progression);
  const idx = allowed.indexOf(current);
  return allowed[(idx + 1) % allowed.length] ?? current;
}

const WARMUP_STEPS: readonly { ratio: number; reps: number }[] = [
  { ratio: 0.4, reps: 8 },
  { ratio: 0.6, reps: 5 },
  { ratio: 0.75, reps: 3 },
  { ratio: 0.85, reps: 2 },
];

/** Target for the n-th warmup set (0-based), ramping towards the first working load. */
export function warmupTarget(workingWeight: number | null, index: number, increment: number): { weight: number | null; reps: number } {
  const step = WARMUP_STEPS[Math.min(index, WARMUP_STEPS.length - 1)] ?? { ratio: 0.5, reps: 5 };
  return {
    weight: workingWeight === null ? null : Math.max(0, roundToIncrement(workingWeight * step.ratio, increment)),
    reps: step.reps,
  };
}

export interface WarmupOptions {
  increment: number;
  /** Weighted (lest) exercises: ratios apply to total mass, the result is given back as lest. */
  bodyweight?: number | null;
  /** Barbell: never below the empty bar. */
  barWeight?: number | null;
}

/**
 * The whole warm-up ramp towards a working load, in one go: 40 % ×8, 60 % ×5, 75 % ×3, 85 % ×2,
 * fewer steps for light loads. Weighted exercises ramp on total mass (bodyweight first, then a
 * small lest); barbell loads never go under the empty bar; duplicate loads are merged.
 */
export function warmupRamp(workingWeight: number | null, opts: WarmupOptions): { weight: number; reps: number }[] {
  if (workingWeight === null || workingWeight <= 0) return [];
  const bw = opts.bodyweight ?? 0;
  const total = workingWeight + bw;
  const floor = opts.barWeight ?? 0;
  // Light work needs less ramp: under 40 kg of total load, two steps are enough.
  const steps = total - bw < 10 && bw > 0 ? WARMUP_STEPS.slice(0, 2) : total < 40 ? WARMUP_STEPS.slice(1, 3) : WARMUP_STEPS;
  const out: { weight: number; reps: number }[] = [];
  for (const step of steps) {
    const raw = total * step.ratio - bw;
    const weight = Math.max(bw > 0 ? 0 : floor, roundToIncrement(Math.max(0, raw), opts.increment));
    if (weight >= workingWeight) continue;
    const prev = out[out.length - 1];
    if (prev !== undefined && prev.weight === weight) {
      prev.reps = Math.min(prev.reps, step.reps);
      continue;
    }
    out.push({ weight, reps: step.reps });
  }
  return out;
}
