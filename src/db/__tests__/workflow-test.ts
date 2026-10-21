import { estimate1RM } from '@/domain/math';
import { generateScheme, DEFAULT_DELOAD } from '@/domain/mesocycle';
import {
  addExerciseToWorkout,
  finishWorkout,
  loadWorkoutDoc,
  replaceExercise,
  stagnantExerciseIds,
  startWorkout,
} from '@/services/workoutService';

import { addBodyEntry } from '../repos/body';
import { saveMesocycle } from '../repos/cycles';
import { getExercise } from '../repos/exercises';
import { bestE1rm, setRecordsFor } from '../repos/history';
import { addPlanned, listPlanned } from '../repos/planning';
import { loadSettings, parseSettings, saveSettings, DEFAULT_SETTINGS } from '../repos/settings';
import { addTemplateExercise, createTemplate } from '../repos/templates';
import { getWorkout, listSetsForWorkout, updateSet } from '../repos/workouts';
import { seedIfEmpty } from '../seed';
import { createTestDb } from './testDb';

function setup() {
  createTestDb();
  seedIfEmpty();
  const meso = saveMesocycle({
    name: 'Cycle 1',
    kind: 'accumulation',
    macrocycleId: null,
    startDate: '2026-01-05',
    workWeeks: 4,
    deloadWeeks: 1,
    scheme: generateScheme(4),
    deload: DEFAULT_DELOAD,
    notes: '',
  });
  const template = createTemplate('Push');
  const bench = getExercise('ex_bench');
  const curl = getExercise('ex_db_curl');
  if (bench === null || curl === null) throw new Error('seed missing');
  addTemplateExercise(template, bench);
  addTemplateExercise(template, curl);
  return { meso, template };
}

/** Completes every prescribed set, optionally overriding values. */
function doAllSets(workoutId: string, values: (setType: string) => { weight: number; reps: number }) {
  for (const s of listSetsForWorkout(workoutId)) {
    const v = values(s.setType);
    updateSet({ ...s, weight: v.weight, reps: v.reps, completed: true, completedAt: Date.now() });
  }
  finishWorkout(workoutId);
}

describe('workout lifecycle', () => {
  it('starts from a template with the week prescription and finishes cleanly', () => {
    const { template, meso } = setup();
    const id = startWorkout({ date: '2026-01-05', templateId: template });
    const w = getWorkout(id);
    expect(w?.status).toBe('active');
    expect(w?.mesocycleId).toBe(meso);
    expect(w?.weekIndex).toBe(1);

    const doc = loadWorkoutDoc(id);
    expect(doc?.items.map((i) => i.exercise.name)).toEqual(['Développé couché', 'Curl haltères']);
    const bench = doc?.items[0];
    expect(bench?.sets.map((s) => `${s.setType}:${s.targetReps}`)).toEqual(['top_set:5', 'backoff:6', 'backoff:6', 'backoff:6', 'backoff:6']);
    expect(bench?.label).toBe('1×5 @80 % + 4×6 @70 %');
    expect(doc?.items[1]?.sets).toHaveLength(3);

    // Only the top set and one backoff done; untouched sets disappear, typed-but-unticked sets are kept.
    const sets = listSetsForWorkout(id);
    const [top, b1, b2] = sets;
    if (top === undefined || b1 === undefined || b2 === undefined) throw new Error('sets missing');
    updateSet({ ...top, weight: 100, reps: 5, completed: true, completedAt: 1 });
    updateSet({ ...b1, weight: 80, reps: 6, completed: true, completedAt: 2 });
    updateSet({ ...b2, weight: 80, reps: 6 });
    finishWorkout(id);
    expect(getWorkout(id)?.status).toBe('completed');
    const after = listSetsForWorkout(id);
    expect(after).toHaveLength(3);
    expect(after.every((s) => s.completed)).toBe(true);
  });

  it('uses the previous session as ghost and progresses double progression', () => {
    const { template } = setup();
    const w1 = startWorkout({ date: '2026-01-05', templateId: template });
    doAllSets(w1, (t) => (t === 'working' ? { weight: 14, reps: 12 } : t === 'top_set' ? { weight: 100, reps: 5 } : { weight: 80, reps: 6 }));

    const w2 = startWorkout({ date: '2026-01-12', templateId: template });
    const doc = loadWorkoutDoc(w2);
    const curl = doc?.items[1];
    expect(curl?.ghost.map((s) => s.reps)).toEqual([12, 12, 12]);
    expect(curl?.hint).toEqual({ kind: 'increase', from: 14, to: 15 });
    expect(curl?.sets.map((s) => [s.targetWeight, s.targetReps])).toEqual([
      [15, 8],
      [15, 8],
      [15, 8],
    ]);

    // Week 1 had no history (typed by hand): week 2 takes its best ≤ 6 rep set as reference.
    // 100 × 5 → 116.7: 1×4 @83 % → 97.5, 4×6 @73 % → 85.
    const bench = doc?.items[0];
    expect(bench?.reference).toMatchObject({ status: 'valid', basis: { load: 100, reps: 5 } });
    expect(bench?.sets.map((s) => `${s.targetWeight}x${s.targetReps}`)).toEqual(['97.5x4', '85x6', '85x6', '85x6', '85x6']);
    expect(bench?.label).toBe('1×4 @83 % + 4×6 @73 %');
  });

  it('links planned sessions and supports free workouts, adding and replacing exercises', () => {
    const { template } = setup();
    const planned = addPlanned('2026-01-06', template, 'Push');
    const id = startWorkout({ date: '2026-01-06', plannedId: planned });
    expect(listPlanned('2026-01-06', '2026-01-06')[0]?.workoutId).toBe(id);
    expect(getWorkout(id)?.templateId).toBe(template);

    const free = startWorkout({ date: '2026-01-07' });
    expect(loadWorkoutDoc(free)?.items).toHaveLength(0);
    const weId = addExerciseToWorkout(free, 'ex_squat');
    expect(weId).not.toBeNull();
    replaceExercise(weId ?? '', 'ex_front_squat');
    const doc = loadWorkoutDoc(free);
    expect(doc?.items.map((i) => i.exercise.id)).toEqual(['ex_front_squat']);
    expect(doc?.items[0]?.sets.every((s) => s.setType === 'working')).toBe(true);
  });

  it('keeps completed sets when replacing an exercise mid-way', () => {
    setup();
    const id = startWorkout({ date: '2026-01-07' });
    const weId = addExerciseToWorkout(id, 'ex_squat') ?? '';
    const first = listSetsForWorkout(id)[0];
    if (first === undefined) throw new Error('no set');
    updateSet({ ...first, weight: 100, reps: 5, completed: true, completedAt: 1 });
    replaceExercise(weId, 'ex_leg_press');
    const doc = loadWorkoutDoc(id);
    expect(doc?.items.map((i) => [i.exercise.id, i.sets.length])).toEqual([
      ['ex_squat', 1],
      ['ex_leg_press', 3],
    ]);
  });
});

describe('analytics queries', () => {
  it('computes e1RM in SQL like the domain, including bodyweight loads', () => {
    setup();
    addBodyEntry('bodyweight', '2026-01-01', 80);
    const id = startWorkout({ date: '2026-01-05' });
    addExerciseToWorkout(id, 'ex_weighted_pullup');
    addExerciseToWorkout(id, 'ex_bench');
    const sets = listSetsForWorkout(id);
    const pull = sets.find((s) => s.setType === 'top_set');
    const benchTop = sets.filter((s) => s.setType === 'top_set')[1];
    if (pull === undefined || benchTop === undefined) throw new Error('missing');
    updateSet({ ...pull, weight: 40, reps: 5, completed: true, completedAt: 1 });
    updateSet({ ...benchTop, weight: 100, reps: 1, completed: true, completedAt: 2 });
    finishWorkout(id);

    expect(bestE1rm('ex_weighted_pullup', {})).toBeCloseTo(estimate1RM(40, 5, 80), 6);
    expect(bestE1rm('ex_bench', {})).toBeCloseTo(100, 6);
    const records = setRecordsFor('ex_weighted_pullup');
    expect(records[0]?.bodyweight).toBe(80);
    expect(setRecordsFor('ex_bench')[0]?.bodyweight).toBeNull();
  });

  it('flags stagnation after two cycles without e1RM progress', () => {
    createTestDb();
    seedIfEmpty();
    const starts = ['2026-01-05', '2026-02-09', '2026-03-16'];
    const scheme = generateScheme(4);
    starts.forEach((startDate, i) => saveMesocycle({ name: `C${i}`, kind: 'accumulation', macrocycleId: null, startDate, workWeeks: 4, deloadWeeks: 1, scheme, deload: DEFAULT_DELOAD, notes: '' }));
    for (const date of starts) {
      const id = startWorkout({ date });
      addExerciseToWorkout(id, 'ex_squat');
      const top = listSetsForWorkout(id)[0];
      if (top === undefined) throw new Error('missing');
      updateSet({ ...top, weight: 150, reps: 3, completed: true, completedAt: 1 });
      finishWorkout(id);
    }
    expect(stagnantExerciseIds().has('ex_squat')).toBe(true);
  });
});

describe('settings', () => {
  it('round-trips and falls back to defaults', () => {
    createTestDb();
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    saveSettings({ ...DEFAULT_SETTINGS, increment: 2, theme: 'perle' });
    expect(loadSettings().increment).toBe(2);
    expect(loadSettings().rest.floors.main).toBe(300);
  });

  it('defaults to the dark theme and maps the old light / dark / system choice', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ theme: 'nuit', followSystem: false });
    expect(parseSettings({ theme: 'light' })).toMatchObject({ theme: 'perle', followSystem: false });
    expect(parseSettings({ theme: 'dark' })).toMatchObject({ theme: 'nuit', followSystem: false });
    expect(parseSettings({ theme: 'system' })).toMatchObject({ theme: 'nuit', followSystem: true });
    expect(parseSettings({ theme: 'braise', followSystem: true })).toMatchObject({ theme: 'braise', followSystem: true });
    expect(parseSettings({ theme: 'inconnu' }).theme).toBe('nuit');
  });
});
