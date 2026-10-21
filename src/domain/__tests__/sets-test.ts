import { classifySets, nextSetType, recalcBackoffs, reclassifyCompleted, typeForNewSet, warmupRamp, warmupTarget } from '../sets';
import type { SetType, WorkoutSet } from '../types';

let seq = 0;
function set(partial: Partial<WorkoutSet>): WorkoutSet {
  seq += 1;
  return {
    id: `s${seq}`,
    workoutExerciseId: 'we',
    position: seq,
    setType: 'working',
    typeManual: false,
    weight: null,
    reps: null,
    targetWeight: null,
    targetReps: null,
    targetRepsMax: null,
    barSpeed: null,
    isTest: false,
    note: '',
    completed: false,
    completedAt: null,
    ...partial,
  };
}

const types = (sets: WorkoutSet[], p: 'top_set_backoff' | 'double_progression'): SetType[] => classifySets(sets, p);

describe('classifySets — top set + backoff', () => {
  it('detects warmups, top set and backoffs from loads', () => {
    const sets = [set({ weight: 60 }), set({ weight: 80 }), set({ weight: 120 }), set({ weight: 95 }), set({ weight: 95 })];
    expect(types(sets, 'top_set_backoff')).toEqual(['warmup', 'warmup', 'top_set', 'backoff', 'backoff']);
  });
  it('flags a much lighter set after backoffs as a drop set', () => {
    const sets = [set({ weight: 120 }), set({ weight: 95 }), set({ weight: 70 })];
    expect(types(sets, 'top_set_backoff')).toEqual(['top_set', 'backoff', 'drop']);
  });
  it('treats two sets at the top weight as two top sets', () => {
    const sets = [set({ weight: 120 }), set({ weight: 118 }), set({ weight: 95 })];
    expect(types(sets, 'top_set_backoff')).toEqual(['top_set', 'top_set', 'backoff']);
  });
  it('uses targets when no weight is typed and keeps weightless sets as prescribed', () => {
    const sets = [set({ setType: 'top_set', targetWeight: 100 }), set({ setType: 'backoff' })];
    expect(types(sets, 'top_set_backoff')).toEqual(['top_set', 'backoff']);
  });
  it('never touches manual types', () => {
    const sets = [set({ weight: 100, setType: 'backoff', typeManual: true }), set({ weight: 120 })];
    expect(types(sets, 'top_set_backoff')).toEqual(['backoff', 'top_set']);
  });
});

describe('classifySets — double progression', () => {
  it('detects warmups, working and drop sets', () => {
    const sets = [set({ weight: 20 }), set({ weight: 40 }), set({ weight: 40 }), set({ weight: 40 }), set({ weight: 25 })];
    expect(types(sets, 'double_progression')).toEqual(['warmup', 'working', 'working', 'working', 'drop']);
  });
  it('keeps slightly lighter sets as working', () => {
    const sets = [set({ weight: 40 }), set({ weight: 37.5 })];
    expect(types(sets, 'double_progression')).toEqual(['working', 'working']);
  });
});

describe('recalcBackoffs', () => {
  const opts = { percent: 0.8, increment: 2.5, bodyweight: null };
  it('fills backoff targets from the top set', () => {
    const sets = [set({ setType: 'top_set', weight: 140 }), set({ setType: 'backoff' }), set({ setType: 'backoff' })];
    const next = recalcBackoffs(sets, opts);
    expect(next.map((s) => s.targetWeight)).toEqual([null, 112.5, 112.5]);
  });
  it('recomputes live when the top set changes but leaves completed backoffs and typed values alone', () => {
    const sets = [
      set({ setType: 'top_set', weight: 150 }),
      set({ setType: 'backoff', weight: 110, targetWeight: 112.5, completed: true }),
      set({ setType: 'backoff', weight: 105, targetWeight: 112.5 }),
      set({ setType: 'backoff', targetWeight: 112.5 }),
    ];
    const next = recalcBackoffs(sets, opts);
    expect(next[1]).toBe(sets[1]);
    expect(next[2]?.targetWeight).toBe(120);
    expect(next[2]?.weight).toBe(105);
    expect(next[3]?.targetWeight).toBe(120);
  });
  it('returns the same array when nothing changes', () => {
    const sets = [set({ setType: 'top_set', weight: 100 }), set({ setType: 'backoff', targetWeight: 80 })];
    expect(recalcBackoffs(sets, opts)).toBe(sets);
  });
  it('does nothing without a top set weight', () => {
    const sets = [set({ setType: 'top_set' }), set({ setType: 'backoff' })];
    expect(recalcBackoffs(sets, opts)).toBe(sets);
  });
});

describe('new set types', () => {
  it('first set of a strength exercise is a top set, then backoffs', () => {
    expect(typeForNewSet([], 'top_set_backoff')).toBe('top_set');
    expect(typeForNewSet([{ setType: 'top_set' }], 'top_set_backoff')).toBe('backoff');
    expect(typeForNewSet([], 'double_progression')).toBe('working');
  });
  it('cycles through the types allowed by the progression', () => {
    expect(nextSetType('top_set', 'top_set_backoff')).toBe('backoff');
    expect(nextSetType('warmup', 'top_set_backoff')).toBe('top_set');
    expect(nextSetType('working', 'double_progression')).toBe('drop');
    expect(nextSetType('warmup', 'double_progression')).toBe('working');
  });
});

describe('reclassifyCompleted', () => {
  it('only looks at completed sets and leaves pending ones as prescribed', () => {
    const sets = [
      set({ setType: 'top_set', weight: 60, reps: 5, completed: true }),
      set({ setType: 'top_set', weight: 120, reps: 3, completed: true }),
      set({ setType: 'backoff', targetWeight: 200 }),
    ];
    const next = reclassifyCompleted(sets, 'top_set_backoff');
    expect(next.map((s) => s.setType)).toEqual(['warmup', 'top_set', 'backoff']);
    expect(next[2]).toBe(sets[2]);
  });
  it('keeps backoffs done before the top set as backoffs', () => {
    const typedTop = [
      set({ setType: 'top_set', weight: 100 }),
      set({ setType: 'backoff', weight: 80, reps: 6, completed: true }),
      set({ setType: 'backoff', weight: 80, reps: 6, completed: true }),
    ];
    expect(reclassifyCompleted(typedTop, 'top_set_backoff')).toBe(typedTop);
    const prescribedTop = [
      set({ setType: 'top_set', targetWeight: 100 }),
      set({ setType: 'backoff', weight: 80, reps: 6, completed: true }),
    ];
    expect(reclassifyCompleted(prescribedTop, 'top_set_backoff')).toBe(prescribedTop);
  });
  it('returns the same array when nothing changes', () => {
    const sets = [set({ setType: 'working', weight: 20, completed: true })];
    expect(reclassifyCompleted(sets, 'double_progression')).toBe(sets);
  });
});

describe('warmupTarget', () => {
  it('ramps towards the working load', () => {
    expect(warmupTarget(100, 0, 2.5)).toEqual({ weight: 40, reps: 8 });
    expect(warmupTarget(100, 1, 2.5)).toEqual({ weight: 60, reps: 5 });
    expect(warmupTarget(100, 9, 2.5)).toEqual({ weight: 85, reps: 2 });
    expect(warmupTarget(null, 0, 2.5).weight).toBeNull();
  });
});

describe('warmupRamp', () => {
  it('builds the whole ramp for a barbell lift', () => {
    expect(warmupRamp(100, { increment: 2.5, barWeight: 20 })).toEqual([
      { weight: 40, reps: 8 },
      { weight: 60, reps: 5 },
      { weight: 75, reps: 3 },
      { weight: 85, reps: 2 },
    ]);
  });
  it('never goes under the empty bar and merges duplicates', () => {
    // 40 kg: 40 % = 16 → empty bar
    expect(warmupRamp(40, { increment: 2.5, barWeight: 20 })).toEqual([
      { weight: 20, reps: 8 },
      { weight: 25, reps: 5 },
      { weight: 30, reps: 3 },
      { weight: 35, reps: 2 },
    ]);
    // 30 kg: 60 % = 18 → empty bar
    expect(warmupRamp(30, { increment: 2.5, barWeight: 20 })).toEqual([
      { weight: 20, reps: 5 },
      { weight: 22.5, reps: 3 },
    ]);
  });
  it('ramps weighted exercises on total mass: bodyweight first, then a small lest', () => {
    // +32.5 lest at 63 kg → 95.5 total: 40 % and 60 % → bodyweight, 75 % → +7.5, 85 % → +17.5
    const r = warmupRamp(32.5, { increment: 2.5, bodyweight: 63 });
    expect(r).toEqual([
      { weight: 0, reps: 5 },
      { weight: 7.5, reps: 3 },
      { weight: 17.5, reps: 2 },
    ]);
  });
  it('skips the ramp without a working load', () => {
    expect(warmupRamp(null, { increment: 2.5 })).toEqual([]);
  });
});
