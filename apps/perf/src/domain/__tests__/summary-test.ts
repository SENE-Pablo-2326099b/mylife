import { isRecordSet, summarizeSession, type SummarySet } from '../summary';

const set = (p: Partial<SummarySet>): SummarySet => ({
  exerciseId: 'sq',
  exerciseName: 'Squat',
  setType: 'working',
  weight: 100,
  reps: 5,
  bodyweight: null,
  strength: false,
  ...p,
});

describe('session summary', () => {
  it('counts sets, reps, tonnage and duration, without warm-ups', () => {
    const s = summarizeSession({
      startedAt: 0,
      endedAt: 75 * 60000,
      sets: [set({ setType: 'warmup', weight: 60 }), set({}), set({ reps: 6 })],
      bestBefore: new Map(),
      previousTonnage: 1000,
    });
    expect(s).toMatchObject({ durationMin: 75, sets: 2, reps: 11, tonnage: 1100, exercises: 1, previousTonnage: 1000, records: [] });
  });
  it('counts weighted (lest) work on total mass', () => {
    const s = summarizeSession({ startedAt: 0, endedAt: null, sets: [set({ weight: 20, reps: 5, bodyweight: 63 })], bestBefore: new Map(), previousTonnage: null });
    expect(s.tonnage).toBe(415);
    expect(s.durationMin).toBeNull();
  });
  it('flags one record per exercise: the best set above the previous best', () => {
    const s = summarizeSession({
      startedAt: 0,
      endedAt: 1,
      sets: [set({ weight: 100, reps: 5 }), set({ weight: 105, reps: 5 }), set({ exerciseId: 'b', exerciseName: 'Bench', weight: 60, reps: 5 })],
      bestBefore: new Map([
        ['sq', 115],
        ['b', 80],
      ]),
      previousTonnage: null,
    });
    expect(s.records).toHaveLength(1);
    expect(s.records[0]).toMatchObject({ exerciseId: 'sq', weight: 105, reps: 5, previous: 115 });
  });
  it('main lifts: sets above 6 reps never make a record; first-ever sessions make none', () => {
    const s = summarizeSession({
      startedAt: 0,
      endedAt: 1,
      sets: [set({ strength: true, weight: 90, reps: 10 }), set({ exerciseId: 'new', weight: 50 })],
      bestBefore: new Map([['sq', 100]]),
      previousTonnage: null,
    });
    expect(s.records).toEqual([]);
  });
});


describe('live record check', () => {
  const base = { e1rm: 120, historicBest: 115, bestToday: 0, setType: 'top_set' as const, countsForRecord: true };
  it('fires above the historic and today bests', () => {
    expect(isRecordSet(base)).toBe(true);
    expect(isRecordSet({ ...base, bestToday: 121 })).toBe(false);
    expect(isRecordSet({ ...base, e1rm: 115 })).toBe(false);
  });
  it('never on warm-ups, unreliable sets or without history', () => {
    expect(isRecordSet({ ...base, setType: 'warmup' })).toBe(false);
    expect(isRecordSet({ ...base, countsForRecord: false })).toBe(false);
    expect(isRecordSet({ ...base, historicBest: null })).toBe(false);
  });
});
