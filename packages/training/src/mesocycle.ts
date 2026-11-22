import { diffDays } from './dates';
import { formatPercent } from './math';
import { schemeForKind, type MesoKind } from './mesoTypes';
import type { DeloadConfig, Mesocycle, StrengthWeek } from './types';

/** Top set reps: 1 to 5 (6 and more is volume, not strength). */
export const TOP_REPS = { min: 1, max: 5 } as const;
/** Backoff reps: 3 to 6. */
export const BACKOFF_REPS = { min: 3, max: 6 } as const;

/**
 * Accumulation cycle, starting values (programme-reel.md): intensity up, volume down.
 * Percentages of the reference 1RM (total mass for weighted exercises); backoffs ~10 points under
 * the top set. Pre-filled only — every week is editable per cycle and per exercise (WeekOverride).
 */
export const DEFAULT_SCHEME_4: readonly StrengthWeek[] = [
  { topSets: 1, topRepsMin: 5, topRepsMax: 5, topPercent: 0.8, backoffSets: 4, backoffReps: 6, backoffPercent: 0.7 },
  { topSets: 1, topRepsMin: 4, topRepsMax: 4, topPercent: 0.83, backoffSets: 4, backoffReps: 6, backoffPercent: 0.73 },
  { topSets: 1, topRepsMin: 4, topRepsMax: 4, topPercent: 0.85, backoffSets: 3, backoffReps: 6, backoffPercent: 0.75 },
  { topSets: 1, topRepsMin: 2, topRepsMax: 2, topPercent: 0.925, backoffSets: 3, backoffReps: 5, backoffPercent: 0.78 },
];

/** S4 pre-filled before oct. 2026 (1×3 @88 %): cycles still on it are moved to the heavier S4 (see upgradeLegacyS4). */
export const LEGACY_S4: StrengthWeek = { topSets: 1, topRepsMin: 3, topRepsMax: 3, topPercent: 0.88, backoffSets: 3, backoffReps: 5, backoffPercent: 0.78 };

export const sameWeek = (a: StrengthWeek, b: StrengthWeek): boolean =>
  a.topSets === b.topSets &&
  a.topRepsMin === b.topRepsMin &&
  a.topRepsMax === b.topRepsMax &&
  Math.abs(a.topPercent - b.topPercent) < 1e-6 &&
  a.backoffSets === b.backoffSets &&
  a.backoffReps === b.backoffReps &&
  Math.abs(a.backoffPercent - b.backoffPercent) < 1e-6;

/** Deload week: main lifts 1×3 @65 % + 2×5 @55 %; accessories −40 % load, half the sets. */
export const DEFAULT_DELOAD: DeloadConfig = {
  main: { topSets: 1, topRepsMin: 3, topRepsMax: 3, topPercent: 0.65, backoffSets: 2, backoffReps: 5, backoffPercent: 0.55 },
  loadFactor: 0.6,
  volumeFactor: 0.5,
};

/** Percent to the half point (0.925 stays 92.5 %). */
const roundPct = (v: number) => Math.round(v * 200) / 200;

/**
 * Builds a scheme for any cycle length. 4 weeks → the reference scheme; other lengths
 * interpolate the same curve (top 80 → 92.5 %, 5 → 2 reps, backoffs 70 → 78 %, 4 → 3 sets at 6 → 5 reps).
 */
export function generateScheme(workWeeks: number): StrengthWeek[] {
  const n = Math.max(1, Math.round(workWeeks));
  if (n === 4) return DEFAULT_SCHEME_4.map((w) => ({ ...w }));
  return Array.from({ length: n }, (_, i) => {
    const t = n === 1 ? 0 : i / (n - 1);
    const topPercent = roundPct(0.8 + 0.125 * t);
    const topReps = Math.round(5 - 3 * t);
    return {
      topSets: 1,
      topRepsMin: topReps,
      topRepsMax: topReps,
      topPercent,
      backoffSets: t < 0.5 ? 4 : 3,
      backoffReps: t < 0.9 ? 6 : 5,
      backoffPercent: roundPct(0.7 + 0.08 * t),
    };
  });
}

/**
 * Resizes a scheme to a new week count while keeping the user's existing week settings:
 * weeks that already exist are preserved, missing ones come from the block type's curve
 * (accumulation curve when no type is given).
 */
export function resizeScheme(scheme: readonly StrengthWeek[], workWeeks: number, kind?: MesoKind): StrengthWeek[] {
  const generated = (kind === undefined ? null : schemeForKind(kind, workWeeks)) ?? generateScheme(workWeeks);
  return generated.map((week, i) => scheme[i] ?? week);
}

export type CyclePhase =
  | { kind: 'before'; daysUntilStart: number }
  | { kind: 'work'; week: number; strength: StrengthWeek }
  | { kind: 'deload'; week: number }
  | { kind: 'over'; week: number };

export function totalWeeks(meso: Pick<Mesocycle, 'workWeeks' | 'deloadWeeks'>): number {
  return meso.workWeeks + meso.deloadWeeks;
}

/** 1-based week of the cycle for a date. Weeks are counted from the start date, not calendar weeks. */
export function weekIndexFor(meso: Pick<Mesocycle, 'startDate'>, date: string): number {
  return Math.floor(diffDays(meso.startDate, date) / 7) + 1;
}

export function phaseFor(meso: Mesocycle, date: string): CyclePhase {
  const days = diffDays(meso.startDate, date);
  if (days < 0) return { kind: 'before', daysUntilStart: -days };
  const week = Math.floor(days / 7) + 1;
  if (week <= meso.workWeeks) {
    // A scheme shorter than workWeeks (edited mid-cycle) falls back to the generated curve.
    const strength = meso.scheme[week - 1] ?? generateScheme(meso.workWeeks)[week - 1];
    if (strength === undefined) return { kind: 'over', week };
    return { kind: 'work', week, strength };
  }
  if (week <= totalWeeks(meso)) return { kind: 'deload', week };
  return { kind: 'over', week };
}

/** End date (inclusive) of a mesocycle. */
export function mesocycleEndOffsetDays(meso: Pick<Mesocycle, 'workWeeks' | 'deloadWeeks'>): number {
  return totalWeeks(meso) * 7 - 1;
}

/**
 * The mesocycle governing a date: the latest one that started on or before it.
 * Mesocycles chain, so an "over" cycle still governs until the next one starts.
 */
export function mesocycleForDate<T extends Pick<Mesocycle, 'startDate'>>(mesos: readonly T[], date: string): T | null {
  let best: T | null = null;
  for (const m of mesos) {
    if (diffDays(m.startDate, date) >= 0 && (best === null || diffDays(best.startDate, m.startDate) > 0)) {
      best = m;
    }
  }
  return best;
}


/** "1×5 @80 % + 4×6 @70 %" (percentages of the reference 1RM). */
export function describeStrengthWeek(w: StrengthWeek, withPercent = true): string {
  const reps = w.topRepsMin === w.topRepsMax ? `${w.topRepsMin}` : `${w.topRepsMin}-${w.topRepsMax}`;
  const top = `${w.topSets}×${reps}${withPercent ? ` @${formatPercent(w.topPercent)}` : ''}`;
  if (w.backoffSets <= 0) return top;
  return `${top} + ${w.backoffSets}×${w.backoffReps}${withPercent ? ` @${formatPercent(w.backoffPercent)}` : ''}`;
}
