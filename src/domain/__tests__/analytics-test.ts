import {
  bestPerCycle,
  detectStagnation,
  e1rmSeries,
  personalRecords,
  topSetHistory,
  weeklyVolume,
  type SetRecord,
} from '../analytics';
import { expandPattern, nextPlanned } from '../planning';
import { DEFAULT_REST, restSeconds } from '../rest';

const rec = (p: Partial<SetRecord>): SetRecord => ({
  workoutId: 'w1',
  date: '2026-01-05',
  mesocycleId: 'm1',
  weekIndex: 1,
  setType: 'top_set',
  weight: 100,
  reps: 5,
  bodyweight: null,
  ...p,
});

describe('e1RM series and cycle bests', () => {
  const sets = [
    rec({ workoutId: 'a', date: '2026-01-05', weight: 100, reps: 5 }),
    rec({ workoutId: 'a', date: '2026-01-05', weight: 80, reps: 6, setType: 'backoff' }),
    rec({ workoutId: 'a', date: '2026-01-05', weight: 140, reps: 1, setType: 'warmup' }),
    rec({ workoutId: 'b', date: '2026-02-09', weight: 110, reps: 3, mesocycleId: 'm2' }),
  ];
  it('keeps the best non-warmup set per workout', () => {
    const series = e1rmSeries(sets);
    expect(series).toHaveLength(2);
    expect(series[0]?.e1rm).toBeCloseTo(116.67, 1);
    expect(series[1]?.e1rm).toBeCloseTo(121, 1);
  });
  it('computes max e1RM per mesocycle in cycle order', () => {
    const best = bestPerCycle(sets, ['m1', 'm2', 'm3']);
    expect(best.map((b) => b.mesocycleId)).toEqual(['m1', 'm2']);
  });
});

describe('detectStagnation', () => {
  const c = (...v: number[]) => v.map((e1rm) => ({ e1rm }));
  it('flags 2+ consecutive cycles without progress', () => {
    expect(detectStagnation(c(150, 150, 149))).toEqual({ stagnant: true, cycles: 2 });
    expect(detectStagnation(c(140, 150, 150.2, 149, 148)).stagnant).toBe(true);
  });
  it('does not flag progressing or too-short histories', () => {
    expect(detectStagnation(c(150, 150, 155)).stagnant).toBe(false);
    expect(detectStagnation(c(150, 149)).stagnant).toBe(false);
    expect(detectStagnation(c()).stagnant).toBe(false);
  });
});

describe('weeklyVolume', () => {
  it('counts hard sets per muscle per week, secondary muscles as half', () => {
    const v = weeklyVolume([
      { date: '2026-01-05', setType: 'top_set', primaryMuscles: ['chest'], secondaryMuscles: ['shoulders'], category: 'main' },
      { date: '2026-01-07', setType: 'backoff', primaryMuscles: ['chest'], secondaryMuscles: ['shoulders'], category: 'main' },
      { date: '2026-01-07', setType: 'warmup', primaryMuscles: ['chest'], secondaryMuscles: [], category: 'main' },
      { date: '2026-01-12', setType: 'working', primaryMuscles: ['biceps'], secondaryMuscles: [], category: 'isolation' },
    ]);
    expect(v.get('2026-01-05')?.get('chest')).toEqual({ direct: 2, indirect: 0 });
    expect(v.get('2026-01-05')?.get('shoulders')).toEqual({ direct: 1, indirect: 0 });
    expect(v.get('2026-01-12')?.get('biceps')).toEqual({ direct: 1, indirect: 0 });
  });

  it('arms: compound sets (dips, rows) are indirect, isolation is direct', () => {
    const v = weeklyVolume([
      { date: '2026-01-06', setType: 'top_set', primaryMuscles: ['chest', 'triceps'], secondaryMuscles: ['shoulders'], category: 'main' },
      { date: '2026-01-07', setType: 'working', primaryMuscles: ['back', 'lats'], secondaryMuscles: ['biceps'], category: 'compound' },
      { date: '2026-01-07', setType: 'working', primaryMuscles: ['triceps'], secondaryMuscles: [], category: 'isolation' },
    ]).get('2026-01-05');
    expect(v?.get('triceps')).toEqual({ direct: 1, indirect: 1 });
    expect(v?.get('biceps')).toEqual({ direct: 0, indirect: 0.5 });
    expect(v?.get('chest')).toEqual({ direct: 1, indirect: 0 });
  });
});

describe('personalRecords', () => {
  it('finds best e1RM, heaviest set and a monotonic rep-max table', () => {
    const prs = personalRecords([
      rec({ weight: 100, reps: 5 }),
      rec({ weight: 120, reps: 1 }),
      rec({ weight: 105, reps: 5 }),
      rec({ weight: 90, reps: 3 }),
      rec({ weight: 60, reps: 1, setType: 'warmup' }),
    ]);
    expect(prs.heaviest?.weight).toBe(120);
    expect(prs.bestE1rm?.weight).toBe(105);
    // 3RM at 90 is beaten by the 5RM at 105 → omitted
    expect(prs.repMaxes.map((r) => [r.reps, r.weight])).toEqual([
      [1, 120],
      [5, 105],
    ]);
  });
  it('lists the best top set per week', () => {
    const h = topSetHistory([
      rec({ date: '2026-01-05', weight: 100 }),
      rec({ date: '2026-01-08', weight: 102.5, reps: 4 }),
      rec({ date: '2026-01-12', weight: 105, reps: 4 }),
      rec({ date: '2026-01-12', weight: 80, setType: 'backoff' }),
    ]);
    expect(h.map((x) => [x.week, x.weight])).toEqual([
      ['2026-01-05', 102.5],
      ['2026-01-12', 105],
    ]);
  });
});

describe('rest timer', () => {
  it('applies category floors', () => {
    expect(restSeconds(DEFAULT_REST, 'main', 'hypertrophy', 'top_set')).toBe(300);
    expect(restSeconds(DEFAULT_REST, 'compound', 'hypertrophy', 'working')).toBe(180);
    expect(restSeconds(DEFAULT_REST, 'isolation', 'hypertrophy', 'working')).toBe(120);
    expect(restSeconds(DEFAULT_REST, 'isolation', 'strength', 'working')).toBe(240);
    expect(restSeconds(DEFAULT_REST, 'main', 'power', 'warmup')).toBe(60);
    expect(restSeconds(DEFAULT_REST, 'main', 'power', 'drop')).toBe(0);
  });
});

describe('planning', () => {
  const pattern = [
    { id: 'p1', weekday: 0, templateId: 'A', position: 0 },
    { id: 'p2', weekday: 3, templateId: 'B', position: 0 },
  ];
  it('expands the weekly pattern without touching occupied days', () => {
    // 2026-01-05 is a Monday
    const out = expandPattern(pattern, '2026-01-05', '2026-01-18', new Set(['2026-01-12']));
    expect(out.map((p) => `${p.date}:${p.templateId}`)).toEqual(['2026-01-05:A', '2026-01-08:B', '2026-01-15:B']);
  });
  it('suggests the next pending session from a date', () => {
    const s = [
      { id: '1', date: '2026-01-05', templateId: 'A', title: 'A', position: 0, workoutId: 'w' },
      { id: '2', date: '2026-01-07', templateId: 'B', title: 'B', position: 0, workoutId: null },
      { id: '3', date: '2026-01-04', templateId: 'B', title: 'B', position: 0, workoutId: null },
    ];
    expect(nextPlanned(s, '2026-01-05')?.id).toBe('2');
  });
});
