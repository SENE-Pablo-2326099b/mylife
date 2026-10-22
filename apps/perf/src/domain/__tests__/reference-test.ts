import { bootstrapReference, epley, loadTable, manualReference, referenceAt, suggestManualUpdate, type RefCycle, type RefSet } from '../reference';

let seq = 0;
/** A logged set; `load` is total mass. */
function set(date: string, load: number, reps: number, extra: Partial<RefSet> = {}): RefSet {
  seq += 1;
  return {
    workoutId: extra.workoutId ?? `w-${date}`,
    date,
    order: seq,
    weekIndex: null,
    isDeload: false,
    setType: 'top_set',
    load,
    reps,
    targetLoad: null,
    targetReps: null,
    plannedRef: null,
    isTest: false,
    bodyweight: 0,
    ...extra,
  };
}

/** A set logged inside a cycle against a prescription built from `ref`. */
function planned(date: string, week: number, ref: number, pct: number, reps: number, done: { load?: number; reps?: number } = {}): RefSet {
  const target = Math.round((ref * pct) / 2.5) * 2.5;
  return set(date, done.load ?? target, done.reps ?? reps, { weekIndex: week, targetLoad: target, targetReps: reps, plannedRef: ref });
}

const bloc1: RefCycle = { id: 'b1', startDate: '2026-09-07', workWeeks: 4 };
const c1: RefCycle = { id: 'c1', startDate: '2026-10-12', workWeeks: 4 };
const c2: RefCycle = { id: 'c2', startDate: '2026-11-16', workWeeks: 4 };

describe('bootstrap (no plan yet)', () => {
  it('only higher-rep sets → best of the ≤ 8 tier, provisional (squat 80×8 rather than 80×10)', () => {
    const r = bootstrapReference([set('2026-09-24', 80, 8), set('2026-10-01', 80, 10)], '2026-10-12');
    expect(r?.status).toBe('provisional');
    expect(r?.value).toBeCloseTo(epley(80, 8));
    expect(r?.basis).toMatchObject({ kind: 'set', load: 80, reps: 8 });
  });
  it('a ≤ 6 set wins when it is the strongest → valid', () => {
    const r = bootstrapReference([set('2026-09-15', 100, 5), set('2026-09-22', 90, 8)], '2026-10-12');
    expect(r?.status).toBe('valid');
    expect(r?.value).toBeCloseTo(epley(100, 5));
  });
  it('a stronger recent 7-8 rep set beats stale ≤ 6 sets but stays provisional (dips +35×7 over +30×6)', () => {
    const bw = 63;
    const r = bootstrapReference([set('2026-09-15', 30 + bw, 6), set('2026-09-29', 35 + bw, 7)], '2026-10-12');
    expect(r?.status).toBe('provisional');
    expect((r?.value ?? 0) - bw).toBeCloseTo(57.9, 1);
  });
  it('nothing ≤ 8 → best set anyway, provisional', () => {
    expect(bootstrapReference([set('2026-09-30', 63, 11)], '2026-10-12')?.status).toBe('provisional');
  });
  it('looks back 12 weeks, falls back to older history', () => {
    const old = set('2026-01-01', 120, 3);
    const recent = set('2026-09-30', 100, 5);
    expect(bootstrapReference([old, recent], '2026-10-12')?.value).toBeCloseTo(epley(100, 5));
    expect(bootstrapReference([old], '2026-10-12')?.value).toBeCloseTo(epley(120, 3));
    expect(bootstrapReference([], '2026-10-12')).toBeNull();
  });
});

describe('reference through the cycles', () => {
  const history = [set('2026-09-24', 80, 8), set('2026-10-01', 80, 10)];
  const prov = epley(80, 8); // 101.3

  it('starts cycle 1 provisional from the remise en route', () => {
    const r = referenceAt(history, [bloc1, c1], '2026-10-12');
    expect(r?.status).toBe('provisional');
    expect(r?.value).toBeCloseTo(prov);
  });

  it('the first planned top set recalibrates a provisional reference, read against the plan', () => {
    // As prescribed (rounding included) → the reference is confirmed and becomes valid.
    const asPlanned = referenceAt([...history, planned('2026-10-15', 1, prov, 0.8, 5)], [bloc1, c1], '2026-10-22');
    expect(asPlanned?.status).toBe('valid');
    expect(asPlanned?.value).toBeCloseTo(prov);
    expect(asPlanned?.basis.kind).toBe('plan');
    // Only 3 reps of the planned 5 → lower.
    const missed = referenceAt([...history, planned('2026-10-15', 1, prov, 0.8, 5, { reps: 3 })], [bloc1, c1], '2026-10-22');
    expect(missed?.value).toBeCloseTo((prov * epley(80, 3)) / epley(80, 5));
    // +5 kg on the planned load → higher (no ceiling on a provisional reference).
    const more = referenceAt([...history, planned('2026-10-15', 1, prov, 0.8, 5, { load: 85 })], [bloc1, c1], '2026-10-22');
    expect(more?.value).toBeCloseTo((prov * 85) / 80);
  });

  it('a valid reference stays put during the cycle', () => {
    const sets = [...history, planned('2026-10-15', 1, prov, 0.8, 5), planned('2026-10-22', 2, prov, 0.83, 4, { reps: 5 })];
    expect(referenceAt(sets, [bloc1, c1], '2026-10-29')?.value).toBeCloseTo(prov);
  });

  const cycle1 = (s4: { load?: number; reps?: number } = {}) => [
    ...history,
    planned('2026-10-15', 1, prov, 0.8, 5),
    planned('2026-10-22', 2, prov, 0.83, 4),
    planned('2026-10-29', 3, prov, 0.85, 4),
    planned('2026-11-05', 4, prov, 0.88, 3, s4),
  ];

  it('S4 done as planned → the next cycle starts 2.5 % higher', () => {
    const r = referenceAt(cycle1(), [bloc1, c1, c2], '2026-11-16');
    expect(r?.value).toBeCloseTo(prov * 1.025);
    expect(r?.calibrations).toHaveLength(1);
    expect(r?.calibrations[0]).toMatchObject({ kind: 's4', capped: false });
    expect(r?.basis.kind).toBe('s4');
  });
  it('S4 crushed → still +2.5 % (ceiling)', () => {
    const r = referenceAt(cycle1({ reps: 5 }), [bloc1, c1, c2], '2026-11-16');
    expect(r?.value).toBeCloseTo(prov * 1.025);
    expect(r?.calibrations[0]?.measured).toBeGreaterThan(1.05);
    expect(r?.calibrations[0]?.capped).toBe(true);
  });
  it('S4 missed → lowered by the miss', () => {
    const r = referenceAt(cycle1({ reps: 2 }), [bloc1, c1, c2], '2026-11-16');
    expect(r?.value).toBeCloseTo((prov * epley(87.5, 2)) / epley(87.5, 3));
    expect(r?.value).toBeLessThan(prov);
  });
  it('no S4 → no calibration, the reference carries over', () => {
    const sets = cycle1().filter((s) => s.weekIndex !== 4);
    const r = referenceAt(sets, [bloc1, c1, c2], '2026-11-16');
    expect(r?.value).toBeCloseTo(prov);
    expect(r?.calibrations).toHaveLength(0);
  });
  it('the preview of a later cycle uses today’s reference', () => {
    expect(referenceAt(history, [bloc1, c1, c2], '2026-11-16')?.value).toBeCloseTo(prov);
  });
});

describe('test sets', () => {
  const base = [set('2026-09-15', 100, 5)]; // valid, 116.7
  const ref = epley(100, 5);

  it('a test above the reference raises it, at most +2.5 % per cycle', () => {
    const r = referenceAt([...base, set('2026-10-20', 125, 1, { isTest: true })], [c1], '2026-10-27');
    expect(r?.value).toBeCloseTo(ref * 1.025);
    expect(r?.calibrations[0]).toMatchObject({ kind: 'test', capped: true });
    expect(r?.basis.kind).toBe('test');
  });
  it('a test below the reference is the new truth', () => {
    const r = referenceAt([...base, set('2026-10-20', 110, 1, { isTest: true })], [c1], '2026-10-27');
    expect(r?.value).toBeCloseTo(110);
  });
  it('a test replaces a provisional reference outright', () => {
    const r = referenceAt([set('2026-09-24', 80, 8), set('2026-10-20', 100, 1, { isTest: true })], [bloc1, c1], '2026-10-27');
    expect(r).toMatchObject({ value: 100, status: 'valid' });
  });
  it('the ceiling is shared by tests and S4 within a cycle', () => {
    const p = epley(100, 5);
    const sets = [
      ...base,
      set('2026-10-20', 125, 1, { isTest: true }),
      planned('2026-11-05', 4, p * 1.025, 0.88, 3, { reps: 5 }),
    ];
    expect(referenceAt(sets, [c1, c2], '2026-11-16')?.value).toBeCloseTo(p * 1.025);
  });
  it('ignores a "test" above 6 reps', () => {
    const r = referenceAt([...base, set('2026-10-20', 100, 10, { isTest: true })], [c1], '2026-10-27');
    expect(r?.value).toBeCloseTo(ref);
  });
});

describe('no cycles', () => {
  it('follows the raw history', () => {
    expect(referenceAt([set('2026-09-15', 100, 5), set('2026-10-01', 105, 5)], [], '2026-10-10')?.value).toBeCloseTo(epley(105, 5));
    expect(referenceAt([], [], '2026-10-10')).toBeNull();
  });
});


describe('load table', () => {
  it('gives loads per rep count and per percent, rounded', () => {
    const t = loadTable(100, 0, 2.5);
    expect(t.byReps.map((r) => r.load)).toEqual([100, 95, 90, 87.5, 85, 82.5]);
    expect(t.byPercent[0]).toEqual({ label: '100 %', load: 100 });
    expect(t.byPercent[4]).toEqual({ label: '80 %', load: 80 });
  });
  it('weighted exercises: total mass minus bodyweight, never negative', () => {
    const t = loadTable(120.9, 63, 2.5);
    expect(t.byReps[0]?.load).toBe(57.5);
    expect(t.byPercent[8]?.load).toBe(10); // 60 % = 72.5 − 63
    expect(loadTable(80, 63, 2.5).byPercent[8]?.load).toBe(0);
  });
});

describe('1RM typed by the user', () => {
  it('adds the bodyweight of the day: percentages apply to the total mass', () => {
    // Dips: 1RM +57.5, 69.5 kg bodyweight → 127 total.
    const r = manualReference(57.5, 69.5, '2026-10-13');
    expect(r.value).toBe(127);
    expect(r.status).toBe('valid');
    expect(r.basis).toMatchObject({ kind: 'manual', load: 127, reps: 1, bodyweight: 69.5 });
  });

  it('a successful S4 after the typed value suggests +2.5 %, a missed one a drop', () => {
    const ok = planned('2026-11-05', 4, 127, 0.925, 2);
    expect(suggestManualUpdate(127, '2026-10-13', [ok], [c1])).toMatchObject({ kind: 's4', to: 127 * 1.025, aboveCap: false });
    const missed = planned('2026-11-05', 4, 127, 0.925, 2, { reps: 1 });
    const s = suggestManualUpdate(127, '2026-10-13', [missed], [c1]);
    expect(s?.kind).toBe('s4');
    expect(s?.to).toBeLessThan(127);
  });

  it('a test gives its own estimate, flagged above the usual cap; nothing before the typed date', () => {
    const test = set('2026-11-20', 132, 1, { isTest: true });
    expect(suggestManualUpdate(127, '2026-10-13', [test], [c1, c2])).toMatchObject({ kind: 'test', to: 132, aboveCap: true });
    expect(suggestManualUpdate(127, '2026-11-21', [test], [c1, c2])).toBeNull();
    // Work weeks 1-3 and higher-rep sets say nothing about the 1RM.
    expect(suggestManualUpdate(127, '2026-10-13', [planned('2026-10-13', 1, 127, 0.8, 5), set('2026-10-20', 110, 8, { isTest: true })], [c1])).toBeNull();
  });
});
