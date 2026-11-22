import { addDays } from './dates';
import type { SetType } from './types';

/**
 * Reference 1RM of a main lift — the number every top set / backoff load is a percentage of.
 *
 * Everything here is on TOTAL mass for weighted exercises (bodyweight + lest), on the bar otherwise:
 * the caller converts, and converts back to lest for display.
 */

/** Above this, a set is volume, not strength: its e1RM is shown but flagged unreliable. */
export const RELIABLE_MAX_REPS = 6;
/** Bootstrap only: a recent 7-8 rep set may stand in for missing / stale ≤ 6 sets (provisional). */
export const PROVISIONAL_MAX_REPS = 8;
/** Max rise of the reference per cycle (from the value the cycle started with). Drops are not capped. */
export const MAX_RISE_PER_CYCLE = 0.025;
/** How far back the bootstrap looks. */
const BOOTSTRAP_DAYS = 84;
/** A set logged exactly as prescribed reads as 1 ± rounding noise. */
const AS_PLANNED = 0.999;

/** Epley on a load; a single is its own max. */
export function epley(load: number, reps: number): number {
  if (reps <= 0 || load <= 0) return 0;
  return reps === 1 ? load : load * (1 + reps / 30);
}

export const isReliable = (reps: number): boolean => reps > 0 && reps <= RELIABLE_MAX_REPS;

/** A completed, non-warmup set of the lift. Loads in total mass. */
export interface RefSet {
  workoutId: string;
  date: string;
  /** Tie-break inside a day (workout start time). */
  order: number;
  weekIndex: number | null;
  isDeload: boolean;
  setType: SetType;
  load: number;
  reps: number;
  /** Prescribed load / reps (total mass), when the set had a prescription. */
  targetLoad: number | null;
  targetReps: number | null;
  /** Reference the prescription was built from (snapshot on the workout). */
  plannedRef: number | null;
  isTest: boolean;
  /** Bodyweight included in `load` (0 for bar exercises), to show the lest back. */
  bodyweight: number;
}

export interface RefCycle {
  id: string;
  startDate: string;
  workWeeks: number;
}

export type ReferenceStatus = 'valid' | 'provisional';

export interface ReferenceBasis {
  /**
   * set = best set (bootstrap) · plan = first planned sets of a cycle · test · s4 = end-of-cycle
   * calibration · manual = 1RM typed by the user (load = typed value + bodyweight, reps = 1).
   */
  kind: 'set' | 'plan' | 'test' | 's4' | 'manual';
  date: string;
  /** The set behind it, total mass, and the bodyweight it includes. */
  load: number;
  reps: number;
  bodyweight: number;
}

export interface Calibration {
  kind: 's4' | 'test';
  date: string;
  /** Performance / prediction: 1 = exactly as planned (S4) or exactly the reference (test). */
  measured: number;
  before: number;
  after: number;
  /** The performance was worth more than the rise applied (+2.5 % per cycle ceiling). */
  capped: boolean;
}

export interface Reference {
  value: number;
  status: ReferenceStatus;
  basis: ReferenceBasis;
  calibrations: Calibration[];
}

interface Best {
  value: number;
  set: RefSet;
}

function best(sets: readonly RefSet[], score: (s: RefSet) => number): Best | null {
  let out: Best | null = null;
  for (const s of sets) {
    const value = score(s);
    if (value > 0 && (out === null || value > out.value)) out = { value, set: s };
  }
  return out;
}

const raw = (s: RefSet) => epley(s.load, s.reps);
const basisOf = (s: RefSet) => ({ date: s.date, load: s.load, reps: s.reps, bodyweight: s.bodyweight });

/** Planned set read against its prescription: as prescribed → the reference it was planned from. */
function againstPlan(s: RefSet): number {
  if (s.plannedRef === null || s.targetLoad === null || s.targetReps === null) return 0;
  const expected = epley(s.targetLoad, s.targetReps);
  return expected > 0 ? (s.plannedRef * raw(s)) / expected : 0;
}

const isPlanned = (s: RefSet) => !s.isTest && s.plannedRef !== null && s.targetLoad !== null && s.targetReps !== null;

/**
 * Starting point from raw history (no usable plan yet): best Epley of the last 12 weeks on sets
 * ≤ 6 reps. When a 7-8 rep set beats them (they are stale — e.g. a remise en route), or when there
 * is nothing ≤ 6, the best higher-rep set is used and the reference is provisional.
 */
export function bootstrapReference(sets: readonly RefSet[], until: string): Reference | null {
  const upTo = sets.filter((s) => s.date < until);
  const recent = upTo.filter((s) => s.date >= addDays(until, -BOOTSTRAP_DAYS));
  const pool = recent.length > 0 ? recent : upTo;
  const reliable = best(pool.filter((s) => isReliable(s.reps)), raw);
  const nearly = best(pool.filter((s) => s.reps <= PROVISIONAL_MAX_REPS), raw);
  const pick = (b: Best, status: ReferenceStatus): Reference => ({
    value: b.value,
    status,
    basis: { kind: b.set.isTest ? 'test' : 'set', ...basisOf(b.set) },
    calibrations: [],
  });
  if (reliable !== null && (nearly === null || nearly.value <= reliable.value)) return pick(reliable, 'valid');
  if (nearly !== null) return pick(nearly, 'provisional');
  const any = best(pool, raw);
  return any === null ? null : pick(any, 'provisional');
}

/**
 * The reference in force on `date`, built forward through the history:
 * 1. bootstrap from raw sets (see `bootstrapReference`) while nothing better exists;
 * 2. a provisional reference is recalibrated by the first planned sets ≤ 6 reps of a cycle
 *    (read against the plan: as prescribed = confirmed, more = higher, less = lower) and becomes valid;
 * 3. a test set (≤ 6 reps) is the truth;
 * 4. at the end of each cycle the S4 top set is the indicator: done as planned or better → +2.5 %,
 *    missed → lowered by the miss.
 * Rises are capped at +2.5 % per cycle; drops are not.
 * `sets` must exclude the workout being prescribed.
 */
export function referenceAt(sets: readonly RefSet[], cycles: readonly RefCycle[], date: string): Reference | null {
  const cyc = [...cycles].filter((c) => c.startDate <= date).sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
  const cycleIndex = (d: string) => {
    let idx = -1;
    cyc.forEach((c, i) => {
      if (c.startDate <= d) idx = i;
    });
    return idx;
  };
  const inCycle = (i: number, d: string) => {
    const c = cyc[i];
    const next = cyc[i + 1];
    return c !== undefined && d >= c.startDate && (next === undefined || d < next.startDate);
  };

  const ordered = sets
    .filter((s) => s.date <= date)
    .sort((a, b) => (a.date === b.date ? a.order - b.order : a.date < b.date ? -1 : 1));
  const workouts: RefSet[][] = [];
  for (const s of ordered) {
    const last = workouts[workouts.length - 1];
    if (last !== undefined && last[0]?.workoutId === s.workoutId) last.push(s);
    else workouts.push([s]);
  }

  // Mutated by the cycle / workout steps below.
  const st: { ref: Reference | null; capBase: number | null } = { ref: null, capBase: null };
  const calibrations: Calibration[] = [];
  const ceiling = () => (st.capBase === null ? Infinity : st.capBase * (1 + MAX_RISE_PER_CYCLE));

  const enterCycle = (i: number) => {
    const prev = cyc[i - 1];
    if (prev !== undefined && st.ref !== null) {
      // S4 of the cycle that just ended.
      const s4 = best(
        ordered.filter(
          (s) =>
            inCycle(i - 1, s.date) &&
            s.weekIndex === prev.workWeeks &&
            !s.isDeload &&
            s.setType === 'top_set' &&
            isPlanned(s) &&
            isReliable(s.reps),
        ),
        (s) => (s.plannedRef === null ? 0 : againstPlan(s) / s.plannedRef),
      );
      if (s4 !== null) {
        const before: number = st.ref.value;
        const wanted = s4.value >= AS_PLANNED ? before * (1 + MAX_RISE_PER_CYCLE) : before * s4.value;
        const after = Math.min(wanted, Math.max(before, ceiling()));
        calibrations.push({ kind: 's4', date: s4.set.date, measured: s4.value, before, after, capped: after < before * s4.value });
        st.ref = { value: after, status: 'valid', basis: { kind: 's4', ...basisOf(s4.set) }, calibrations: [] };
      }
    }
    const c = cyc[i];
    if (c !== undefined && (st.ref === null || st.ref.status === 'provisional')) {
      const b = bootstrapReference(sets, c.startDate);
      if (b !== null) st.ref = b;
    }
    st.capBase = st.ref?.value ?? null;
  };

  const processWorkout = (w: readonly RefSet[]) => {
    for (const t of w) {
      if (!t.isTest || !isReliable(t.reps)) continue;
      const value = raw(t);
      const basis: ReferenceBasis = { kind: 'test', ...basisOf(t) };
      if (st.ref === null || st.ref.status === 'provisional') {
        st.ref = { value, status: 'valid', basis, calibrations: [] };
        st.capBase = value;
        continue;
      }
      const before: number = st.ref.value;
      const after = value >= before ? Math.max(before, Math.min(value, ceiling())) : value;
      calibrations.push({ kind: 'test', date: t.date, measured: value / before, before, after, capped: after < value });
      st.ref = { value: after, status: 'valid', basis, calibrations: [] };
    }
    if (st.ref !== null && st.ref.status === 'provisional') {
      const planned = best(
        w.filter((s) => isPlanned(s) && isReliable(s.reps)),
        againstPlan,
      );
      if (planned !== null) {
        st.ref = {
          value: planned.value,
          status: 'valid',
          basis: { kind: 'plan', ...basisOf(planned.set) },
          calibrations: [],
        };
        st.capBase = planned.value;
      }
    }
  };

  let ci = -1;
  for (const w of workouts) {
    const first = w[0];
    if (first === undefined) continue;
    const wc = cycleIndex(first.date);
    while (ci < wc) enterCycle(++ci);
    processWorkout(w);
  }
  const dc = cycleIndex(date);
  while (ci < dc) enterCycle(++ci);

  // Lift never planned (no cycle, or started mid-cycle): latest raw history.
  if (st.ref === null || st.ref.status === 'provisional') {
    const b = bootstrapReference(sets, addDays(date, 1));
    if (b !== null) st.ref = b;
  }
  return st.ref === null ? null : { ...st.ref, calibrations };
}

/**
 * The 1RM typed by the user, as a reference. `value` is as logged (lest for weighted lifts): the
 * bodyweight of the day is added so the percentages apply to the total mass, and the gap lest ↔
 * total stays right when the bodyweight changes.
 */
export function manualReference(value: number, bodyweight: number, setOn: string): Reference {
  const load = value + bodyweight;
  return { value: load, status: 'valid', basis: { kind: 'manual', date: setOn, load, reps: 1, bodyweight }, calibrations: [] };
}

export interface ManualSuggestion {
  kind: 's4' | 'test';
  date: string;
  /** The set behind it, total mass, and the bodyweight it includes. */
  load: number;
  reps: number;
  bodyweight: number;
  /** S4: performance / plan (1 = as planned) · test: the test's e1RM / the typed 1RM. */
  measured: number;
  /** Suggested 1RM, total mass. */
  to: number;
  /** Above the usual +2.5 % per cycle. */
  aboveCap: boolean;
}

/**
 * What the S4 top set or a test done after the typed 1RM says about it. Never applied by itself:
 * the user decides. S4 done as planned or better → +2.5 %; missed → lowered by the miss. A test
 * (≤ 6 reps) gives its own estimate. The latest of the two wins; nothing when it would not move
 * the 1RM by at least 0.5 %.
 */
export function suggestManualUpdate(
  manualTotal: number,
  setOn: string,
  sets: readonly RefSet[],
  cycles: readonly Pick<RefCycle, 'startDate' | 'workWeeks'>[],
): ManualSuggestion | null {
  const after = sets.filter((s) => s.date > setOn && isReliable(s.reps));
  const candidates: ManualSuggestion[] = [];
  const cycleOf = (d: string) =>
    [...cycles].filter((c) => c.startDate <= d).sort((a, b) => (a.startDate < b.startDate ? 1 : -1))[0];
  const s4 = best(
    after.filter((s) => {
      const c = cycleOf(s.date);
      return c !== undefined && s.weekIndex === c.workWeeks && !s.isDeload && s.setType === 'top_set' && isPlanned(s);
    }),
    (s) => (s.plannedRef === null ? 0 : againstPlan(s) / s.plannedRef),
  );
  if (s4 !== null) {
    const factor = s4.value >= AS_PLANNED ? 1 + MAX_RISE_PER_CYCLE : s4.value;
    candidates.push({ kind: 's4', ...basisOf(s4.set), measured: s4.value, to: manualTotal * factor, aboveCap: false });
  }
  const test = best(
    after.filter((s) => s.isTest),
    raw,
  );
  if (test !== null) {
    candidates.push({
      kind: 'test',
      ...basisOf(test.set),
      measured: test.value / manualTotal,
      to: test.value,
      aboveCap: test.value > manualTotal * (1 + MAX_RISE_PER_CYCLE) + 1e-9,
    });
  }
  const latest = candidates.sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  if (latest === undefined || Math.abs(latest.to / manualTotal - 1) < 0.005) return null;
  return latest;
}

export interface LoadRow {
  label: string;
  /** Load as logged (lest for weighted exercises), rounded to the increment. */
  load: number;
}

/**
 * Loads from the reference 1RM (total mass): per rep count 1-6 (inverse Epley) and per % of 1RM.
 * Given back as logged load (minus bodyweight for weighted exercises), never negative.
 */
export function loadTable(reference: number, bodyweight: number, increment: number): { byReps: LoadRow[]; byPercent: LoadRow[] } {
  const round = (v: number) => Math.max(0, Math.round(v / increment) * increment);
  const byReps = [1, 2, 3, 4, 5, 6].map((reps) => ({
    label: `${reps} rep${reps > 1 ? 's' : ''}`,
    load: round((reps === 1 ? reference : reference / (1 + reps / 30)) - bodyweight),
  }));
  const byPercent = [100, 95, 90, 85, 80, 75, 70, 65, 60].map((p) => ({ label: `${p} %`, load: round((reference * p) / 100 - bodyweight) }));
  return { byReps, byPercent };
}
