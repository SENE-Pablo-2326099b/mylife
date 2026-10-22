import { recordEvents, weeklyConsistency, type SetRecord } from '../analytics';

// Weeks start on Monday: 2026-09-07, 09-14, 09-21, 09-28, 10-05.
const days = (...d: string[]) => d;

describe('weekly consistency', () => {
  it('counts consecutive weeks at goal; the open week does not break the streak', () => {
    const dates = days('2026-09-14', '2026-09-15', '2026-09-21', '2026-09-23', '2026-09-28', '2026-09-30', '2026-10-06');
    const c = weeklyConsistency(dates, '2026-10-07', 2, 6);
    expect(c.streak).toBe(3);
    expect(c.weeks.map((w) => w.sessions)).toEqual([0, 0, 2, 2, 2, 1]);
    expect(c.weeks[5]?.start).toBe('2026-10-05');
    expect(c.hit).toBe(3);
  });
  it('includes the current week once it reaches the goal', () => {
    const c = weeklyConsistency(days('2026-09-28', '2026-09-29', '2026-10-05', '2026-10-06'), '2026-10-07', 2, 4);
    expect(c.streak).toBe(2);
  });
  it('a missed week resets the streak', () => {
    const c = weeklyConsistency(days('2026-09-14', '2026-09-15', '2026-09-28', '2026-09-29'), '2026-10-07', 2, 4);
    expect(c.streak).toBe(1);
  });
  it('crosses month and year boundaries', () => {
    const c = weeklyConsistency(days('2026-12-28', '2027-01-04'), '2027-01-05', 1, 3);
    expect(c.weeks.map((w) => w.start)).toEqual(['2026-12-21', '2026-12-28', '2027-01-04']);
    expect(c.streak).toBe(2);
  });
});


const rec = (workoutId: string, date: string, weight: number, reps: number): SetRecord => ({
  workoutId,
  date,
  mesocycleId: null,
  weekIndex: null,
  setType: 'working',
  weight,
  reps,
  bodyweight: null,
});

describe('record events', () => {
  it('lists each session that beat the previous best, one per session', () => {
    const ev = recordEvents([
      rec('a', '2026-09-01', 100, 5),
      rec('a', '2026-09-01', 105, 3),
      rec('b', '2026-09-08', 100, 5),
      rec('c', '2026-09-15', 105, 5),
      rec('c', '2026-09-15', 110, 4),
    ]);
    expect(ev.map((e) => [e.workoutId, e.weight, e.reps])).toEqual([['c', 110, 4]]);
    expect(ev[0]?.gain).toBeCloseTo(110 * (1 + 4 / 30) - 100 * (1 + 5 / 30), 5);
  });
  it('ignores sets above the reliable rep count when asked', () => {
    const ev = recordEvents([rec('a', '2026-09-01', 100, 5), rec('b', '2026-09-08', 90, 10)], 6);
    expect(ev).toEqual([]);
  });
});
