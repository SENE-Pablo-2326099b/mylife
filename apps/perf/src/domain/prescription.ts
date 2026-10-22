import { BACKOFF_REPS, describeStrengthWeek, DEFAULT_SCHEME_4, TOP_REPS, type CyclePhase } from './mesocycle';
import { roundToIncrement } from './math';
import type { BarSpeed, DeloadConfig, ProgressionType, SetType, StrengthWeek, WeekOverride } from './types';

/** A completed set from history, enough for prescriptions. */
export interface HistorySet {
  setType: SetType;
  weight: number;
  reps: number;
  barSpeed: BarSpeed | null;
}

export interface PlannedSet {
  setType: SetType;
  targetWeight: number | null;
  targetReps: number | null;
  targetRepsMax: number | null;
}

export type ProgressionHint = { kind: 'increase'; from: number; to: number } | null;

export interface Prescription {
  sets: PlannedSet[];
  /** Short human summary, e.g. "1×4 + 3×5 @80%" or "3×8-12". */
  label: string;
  hint: ProgressionHint;
  /** Backoff / top set ratio (total mass) actually used this week, snapshotted on the workout so live recalculation matches. */
  backoffPercent: number;
  /** Main lifts with a reference: % of the 1RM of the day's top set and backoffs (shown on each set). */
  percents: { top: number; backoff: number } | null;
}

export interface PrescriptionInput {
  progressionType: ProgressionType;
  repMin: number;
  repMax: number;
  /** Double progression set count. */
  targetSets: number;
  topSetsOverride: number | null;
  backoffSetsOverride: number | null;
  /** Backoff / top set ratio when no reference is known (the user types the top set). */
  backoffPercent: number;
  increment: number;
  bodyweight: number | null;
  /** Null when no mesocycle is running: the week-1 shape is used. */
  phase: CyclePhase | null;
  scheme: readonly StrengthWeek[];
  deload: DeloadConfig;
  /** Completed non-warmup sets of the previous session of this exercise, in order. */
  lastSets: readonly HistorySet[];
  /** Reference 1RM, TOTAL mass for weighted exercises (see domain/reference). */
  referenceE1rm: number | null;
  /** This exercise's per-week tweaks for the running mesocycle, keyed by week index (deload = workWeeks + 1). */
  weekOverrides?: ReadonlyMap<number, WeekOverride>;
}

/**
 * Double progression trigger: every working set reached the top of the rep range.
 * Non-blocking — the UI shows a badge, the user decides.
 */
export function shouldIncreaseLoad(sets: readonly Pick<HistorySet, 'setType' | 'reps'>[], repMax: number): boolean {
  const working = sets.filter((s) => s.setType === 'working' || s.setType === 'top_set' || s.setType === 'backoff');
  return working.length > 0 && working.every((s) => s.reps >= repMax);
}

export function prescribe(input: PrescriptionInput): Prescription {
  return input.progressionType === 'top_set_backoff' ? prescribeTopSet(input) : prescribeDouble(input);
}

function reduceSets(count: number, factor: number): number {
  return Math.max(1, Math.round(count * factor));
}

/** Load at `percent` of a total-mass 1RM, given back as what the user loads (lest for weighted work). */
export function loadAt(reference: number, percent: number, increment: number, bodyweight: number | null): number {
  return Math.max(0, roundToIncrement(reference * percent - (bodyweight ?? 0), increment));
}

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/**
 * Week shape after applying, in order: cycle week ← template set counts ← per-exercise week override.
 * Reps stay in the strength ranges whatever the source: top set 1-5, backoffs 3-6.
 */
export function weekPlan(
  base: StrengthWeek,
  template: Pick<PrescriptionInput, 'topSetsOverride' | 'backoffSetsOverride'>,
  o: WeekOverride | undefined,
): StrengthWeek {
  const topRepsMin = clamp(o?.topRepsMin ?? base.topRepsMin, TOP_REPS.min, TOP_REPS.max);
  const topRepsMax = clamp(o?.topRepsMax ?? (o?.topRepsMin != null ? topRepsMin : base.topRepsMax), topRepsMin, TOP_REPS.max);
  return {
    topSets: o?.topSets ?? template.topSetsOverride ?? base.topSets,
    topRepsMin,
    topRepsMax,
    topPercent: o?.topPercent ?? base.topPercent,
    backoffSets: o?.backoffSets ?? template.backoffSetsOverride ?? base.backoffSets,
    backoffReps: clamp(o?.backoffReps ?? base.backoffReps, BACKOFF_REPS.min, BACKOFF_REPS.max),
    backoffPercent: o?.backoffPercent ?? base.backoffPercent,
  };
}

/**
 * Top set + backoff: loads are percentages of the reference 1RM (total mass for weighted work).
 * Deload = the cycle's deload week shape (same rule). Without any reference, the user types the top
 * set and the backoffs follow it at the exercise ratio.
 */
function prescribeTopSet(input: PrescriptionInput): Prescription {
  const { phase, increment, bodyweight } = input;
  const overrides = input.weekOverrides ?? new Map<number, WeekOverride>();
  const fallback = DEFAULT_SCHEME_4[0];
  if (fallback === undefined) throw new Error('empty default scheme');
  const isDeload = phase?.kind === 'deload';
  // No cycle running: the first week's shape.
  const base = isDeload ? input.deload.main : phase?.kind === 'work' ? phase.strength : (input.scheme[0] ?? fallback);
  const week = phase?.kind === 'work' || phase?.kind === 'deload' ? phase.week : null;
  // The deload week has its own set counts; template counts shape the work weeks only.
  const counts = isDeload ? { topSetsOverride: null, backoffSetsOverride: null } : input;
  const plan = weekPlan(base, counts, week === null ? undefined : overrides.get(week));
  const ref = input.referenceE1rm;
  const bw = bodyweight ?? 0;

  // The day's % of the 1RM, nothing else: no fixed load, the previous session never moves the loads.
  const top = ref === null ? null : loadAt(ref, plan.topPercent, increment, bodyweight);
  const backoff = ref === null ? null : loadAt(ref, plan.backoffPercent, increment, bodyweight);
  // Ratio for live recalculation of the backoffs from a typed top set (lifts without a reference).
  const ratio = top !== null && backoff !== null && top + bw > 0 ? (backoff + bw) / (top + bw) : input.backoffPercent;
  const percents = ref === null || ref <= 0 ? null : { top: plan.topPercent, backoff: plan.backoffPercent };
  return buildTopSetPrescription(plan, top, backoff, Math.round(ratio * 1000) / 1000, isDeload, percents);
}

function buildTopSetPrescription(
  plan: StrengthWeek,
  top: number | null,
  backoff: number | null,
  ratio: number,
  isDeload: boolean,
  percents: Prescription['percents'],
): Prescription {
  const sets: PlannedSet[] = [];
  for (let i = 0; i < plan.topSets; i++) {
    sets.push({ setType: 'top_set', targetWeight: top, targetReps: plan.topRepsMin, targetRepsMax: plan.topRepsMax });
  }
  for (let i = 0; i < plan.backoffSets; i++) {
    sets.push({ setType: 'backoff', targetWeight: backoff, targetReps: plan.backoffReps, targetRepsMax: null });
  }
  const label = `${isDeload ? 'Deload · ' : ''}${describeStrengthWeek(plan, true)}`;
  return { sets, label, hint: null, backoffPercent: ratio, percents };
}

function prescribeDouble(input: PrescriptionInput): Prescription {
  const { repMin, repMax, increment } = input;
  const isDeload = input.phase?.kind === 'deload';
  const count = isDeload ? reduceSets(input.targetSets, input.deload.volumeFactor) : input.targetSets;
  const working = input.lastSets.filter((s) => s.setType !== 'warmup' && s.setType !== 'drop');
  const lastWeight = working.length > 0 ? Math.max(...working.map((s) => s.weight)) : null;

  let weight = lastWeight;
  let hint: ProgressionHint = null;
  let repsFor = (i: number): number => clamp(working[i]?.reps ?? repMin, repMin, repMax);

  if (lastWeight !== null && isDeload) {
    weight = roundToIncrement(lastWeight * input.deload.loadFactor, increment);
    repsFor = () => repMin;
  } else if (lastWeight !== null && shouldIncreaseLoad(working, repMax)) {
    weight = roundToIncrement(lastWeight + increment, increment);
    hint = { kind: 'increase', from: lastWeight, to: weight };
    repsFor = () => repMin;
  }

  const sets: PlannedSet[] = Array.from({ length: count }, (_, i) => ({
    setType: 'working',
    targetWeight: weight,
    targetReps: repsFor(i),
    targetRepsMax: repMax,
  }));
  const range = repMin === repMax ? `${repMin}` : `${repMin}-${repMax}`;
  const label = `${count}×${range}`;
  return { sets, label: isDeload ? `Deload · ${label}` : label, hint, backoffPercent: input.backoffPercent, percents: null };
}

