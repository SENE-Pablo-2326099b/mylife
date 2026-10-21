import { DEFAULT_DELOAD, DEFAULT_SCHEME_4, generateScheme, phaseFor, resizeScheme } from '../mesocycle';
import { prescribe, shouldIncreaseLoad, type PrescriptionInput } from '../prescription';
import type { Mesocycle, WeekOverride } from '../types';

const meso: Mesocycle = {
  id: 'm',
  name: 'Cycle',
  kind: 'accumulation',
  macrocycleId: null,
  startDate: '2026-01-05',
  workWeeks: 4,
  deloadWeeks: 1,
  scheme: DEFAULT_SCHEME_4.map((w) => ({ ...w })),
  deload: DEFAULT_DELOAD,
  notes: '',
};

const base: PrescriptionInput = {
  progressionType: 'top_set_backoff',
  repMin: 3,
  repMax: 6,
  targetSets: 3,
  topSetsOverride: null,
  backoffSetsOverride: null,
  backoffPercent: 0.8,
  increment: 2.5,
  bodyweight: null,
  phase: null,
  scheme: meso.scheme,
  deload: DEFAULT_DELOAD,
  lastSets: [],
  referenceE1rm: null,
};

describe('mesocycle phases', () => {
  it('walks work weeks, deload, then over', () => {
    expect(phaseFor(meso, '2026-01-04').kind).toBe('before');
    const w1 = phaseFor(meso, '2026-01-05');
    expect(w1.kind === 'work' && w1.week).toBe(1);
    const w4 = phaseFor(meso, '2026-02-01');
    expect(w4.kind === 'work' && w4.strength.topRepsMin).toBe(2);
    expect(phaseFor(meso, '2026-02-02').kind).toBe('deload');
    expect(phaseFor(meso, '2026-02-09').kind).toBe('over');
  });
  it('survives a cycle length change mid-cycle', () => {
    const longer = { ...meso, workWeeks: 6, scheme: resizeScheme(meso.scheme, 6) };
    const w5 = phaseFor(longer, '2026-02-02');
    expect(w5.kind).toBe('work');
    // existing weeks are preserved
    expect(longer.scheme[0]).toEqual(DEFAULT_SCHEME_4[0]);
  });
  it('generates a sensible structure for other lengths, within the rep rules', () => {
    const s = generateScheme(6);
    expect(s).toHaveLength(6);
    expect(s[0]?.topRepsMin).toBe(5);
    expect(s[5]?.topRepsMin).toBe(2);
    expect(s[5]?.topPercent).toBe(0.925);
    expect(s[5]?.topPercent).toBeGreaterThan(s[0]?.topPercent ?? 0);
    for (const w of s) {
      expect(w.topRepsMax).toBeLessThanOrEqual(5);
      expect(w.backoffReps).toBeGreaterThanOrEqual(3);
      expect(w.backoffReps).toBeLessThanOrEqual(6);
      expect(w.backoffPercent).toBeLessThan(w.topPercent);
    }
    expect(generateScheme(4)).toEqual(DEFAULT_SCHEME_4);
  });
});

describe('top set + backoff prescription (% of the reference 1RM)', () => {
  const sets = (d: string, ref = 100, extra: Partial<PrescriptionInput> = {}) =>
    prescribe({ ...base, phase: phaseFor(meso, d), referenceE1rm: ref, ...extra }).sets.map((s) => `${s.setType}:${s.targetWeight}x${s.targetReps}`);

  it('pre-fills the accumulation cycle: 80/70, 83/73, 85/75, 92.5/78, deload 65/55', () => {
    expect(sets('2026-01-05')).toEqual(['top_set:80x5', 'backoff:70x6', 'backoff:70x6', 'backoff:70x6', 'backoff:70x6']);
    expect(sets('2026-01-12')).toEqual(['top_set:82.5x4', 'backoff:72.5x6', 'backoff:72.5x6', 'backoff:72.5x6', 'backoff:72.5x6']);
    expect(sets('2026-01-19')).toEqual(['top_set:85x4', 'backoff:75x6', 'backoff:75x6', 'backoff:75x6']);
    expect(sets('2026-01-26')).toEqual(['top_set:92.5x2', 'backoff:77.5x5', 'backoff:77.5x5', 'backoff:77.5x5']);
    expect(sets('2026-02-02')).toEqual(['top_set:65x3', 'backoff:55x5', 'backoff:55x5']);
  });
  it('labels the week with its percentages and snapshots the backoff / top ratio', () => {
    const p = prescribe({ ...base, phase: phaseFor(meso, '2026-01-05'), referenceE1rm: 100 });
    expect(p.label).toBe('1×5 @80 % + 4×6 @70 %');
    expect(p.backoffPercent).toBe(0.875);
    const d = prescribe({ ...base, phase: phaseFor(meso, '2026-02-02'), referenceE1rm: 100 });
    expect(d.label).toBe('Deload · 1×3 @65 % + 2×5 @55 %');
  });
  it('weighted exercises: percentages of total mass, given back as lest', () => {
    // Dips: 63 kg bodyweight, reference +57.9 → 120.9 total.
    const dips = (d: string) => sets(d, 120.9, { bodyweight: 63 });
    expect(dips('2026-01-05')[0]).toBe('top_set:32.5x5'); // 96.7 total
    expect(dips('2026-01-26')[0]).toBe('top_set:50x2'); // 111.8 total
    expect(dips('2026-02-02')).toEqual(['top_set:15x3', 'backoff:2.5x5', 'backoff:2.5x5']);
  });
  it('only the % of the day: the previous session (heavier set, fast bar) never moves the loads', () => {
    const last = { lastSets: [{ setType: 'top_set' as const, weight: 95, reps: 5, barSpeed: 'fast' as const }] };
    expect(sets('2026-01-12', 100, last)).toEqual(sets('2026-01-12', 100));
    expect(sets('2026-01-12', 100, last)[0]).toBe('top_set:82.5x4');
  });
  it('honours template set counts on work weeks, not on the deload', () => {
    expect(sets('2026-01-05', 100, { topSetsOverride: 2, backoffSetsOverride: 1 })).toEqual(['top_set:80x5', 'top_set:80x5', 'backoff:70x6']);
    expect(sets('2026-02-02', 100, { topSetsOverride: 2, backoffSetsOverride: 1 })).toHaveLength(3);
  });
  it('without a cycle, uses the first week', () => {
    expect(prescribe({ ...base, referenceE1rm: 100 }).sets[0]?.targetWeight).toBe(80);
  });
  it('without a reference, leaves loads empty', () => {
    const p = prescribe({ ...base, phase: phaseFor(meso, '2026-01-05') });
    expect(p.sets.every((s) => s.targetWeight === null)).toBe(true);
  });
});

describe('per-week plan', () => {
  const ov = (weekIndex: number, patch: Partial<WeekOverride>): [number, WeekOverride] => [
    weekIndex,
    { weekIndex, topSets: null, topRepsMin: null, topRepsMax: null, backoffSets: null, backoffReps: null, backoffPercent: null, topPercent: null, ...patch },
  ];

  it('applies per-exercise week tweaks over the cycle and template', () => {
    const p = prescribe({
      ...base,
      phase: phaseFor(meso, '2026-01-12'),
      referenceE1rm: 150,
      topSetsOverride: 1,
      weekOverrides: new Map([ov(2, { topSets: 2, topRepsMin: 3, backoffSets: 1, backoffReps: 5, backoffPercent: 0.7 })]),
    });
    // 150 × 83 % = 124.5 → 125 ; 150 × 70 % = 105.
    expect(p.sets.map((s) => `${s.setType}:${s.targetWeight}x${s.targetReps}`)).toEqual(['top_set:125x3', 'top_set:125x3', 'backoff:105x5']);
    expect(p.percents).toEqual({ top: 0.83, backoff: 0.7 });
    expect(p.label).toBe('2×3 @83 % + 1×5 @70 %');
  });
  it('moves the percentages of one week', () => {
    const p = prescribe({ ...base, phase: phaseFor(meso, '2026-01-05'), referenceE1rm: 100, weekOverrides: new Map([ov(1, { topPercent: 0.82, backoffPercent: 0.72 })]) });
    expect(p.sets[0]?.targetWeight).toBe(82.5);
    expect(p.sets[1]?.targetWeight).toBe(72.5);
  });
  it('keeps reps in the strength ranges: top set 1-5, backoffs 3-6', () => {
    const p = prescribe({ ...base, phase: phaseFor(meso, '2026-01-05'), referenceE1rm: 100, weekOverrides: new Map([ov(1, { topRepsMin: 8, backoffReps: 10 })]) });
    expect(p.sets[0]?.targetReps).toBe(5);
    expect(p.sets[1]?.targetReps).toBe(6);
  });
  it('tweaks the deload week of one exercise', () => {
    const p = prescribe({ ...base, phase: phaseFor(meso, '2026-02-02'), referenceE1rm: 100, weekOverrides: new Map([ov(5, { topRepsMin: 2, topPercent: 0.7 })]) });
    expect(p.sets[0]?.targetWeight).toBe(70);
    expect(p.sets[0]?.targetReps).toBe(2);
  });
  it('without a reference, no load is invented: the user types the top set', () => {
    const p = prescribe({ ...base, phase: phaseFor(meso, '2026-01-26'), weekOverrides: new Map([ov(4, { topRepsMin: 1 })]) });
    expect(p.sets.map((s) => s.targetWeight)).toEqual([null, null, null, null]);
    expect(p.percents).toBeNull();
  });
});

describe('double progression', () => {
  const dp: PrescriptionInput = { ...base, progressionType: 'double_progression', repMin: 8, repMax: 12 };
  const last = (reps: number[]) => reps.map((r) => ({ setType: 'working' as const, weight: 20, reps: r, barSpeed: null }));

  it('detects when every set reached the top of the range', () => {
    expect(shouldIncreaseLoad(last([12, 12, 12]), 12)).toBe(true);
    expect(shouldIncreaseLoad(last([12, 12, 11]), 12)).toBe(false);
    expect(shouldIncreaseLoad([], 12)).toBe(false);
  });
  it('suggests a load increase and restarts at the bottom of the range', () => {
    const p = prescribe({ ...dp, lastSets: last([12, 12, 12]) });
    expect(p.hint).toEqual({ kind: 'increase', from: 20, to: 22.5 });
    expect(p.sets.map((s) => [s.targetWeight, s.targetReps])).toEqual([
      [22.5, 8],
      [22.5, 8],
      [22.5, 8],
    ]);
  });
  it('keeps the load and targets last reps otherwise', () => {
    const p = prescribe({ ...dp, lastSets: last([12, 10, 9]) });
    expect(p.hint).toBeNull();
    expect(p.sets.map((s) => [s.targetWeight, s.targetReps])).toEqual([
      [20, 12],
      [20, 10],
      [20, 9],
    ]);
    expect(p.label).toBe('3×8-12');
  });
  it('keeps volume constant across weeks and reduces it at deload', () => {
    const w1 = prescribe({ ...dp, phase: phaseFor(meso, '2026-01-05'), lastSets: last([10, 10, 10]) });
    const w4 = prescribe({ ...dp, phase: phaseFor(meso, '2026-01-26'), lastSets: last([10, 10, 10]) });
    const deload = prescribe({ ...dp, phase: phaseFor(meso, '2026-02-02'), lastSets: last([12, 12, 12]) });
    expect(w1.sets).toHaveLength(3);
    expect(w4.sets).toHaveLength(3);
    expect(deload.sets).toHaveLength(2);
    expect(deload.sets[0]?.targetWeight).toBe(12.5); // 20 × 0.6 = 12 → 12.5
    expect(deload.hint).toBeNull();
  });
});
