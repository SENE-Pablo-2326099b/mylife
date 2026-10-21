import { buildBackup } from '@/db/backup';
import { createTestDb } from '@/db/__tests__/testDb';
import { addBodyEntry } from '@/db/repos/body';
import { getMesocycle, listMesocycles, saveMesocycle, upgradeLegacyS4 } from '@/db/repos/cycles';
import { getOneRm, saveOneRm } from '@/db/repos/oneRm';
import { DEFAULT_SCHEME_4, LEGACY_S4 } from '@/domain/mesocycle';
import { importPersonalData, replaceWithPersonalData } from '@/import/importer';
import { db } from '@/db/db';
import { MIGRATIONS } from '@/db/migrations';
import { listPlanned } from '@/db/repos/planning';
import { getWorkout } from '@/db/repos/workouts';
import { weekOverrides } from '@/db/repos/cyclePlans';

import { loadWorkoutDoc, referenceFor, referenceInfo, refreshActiveTargets, startWorkout, templatePreview } from '../workoutService';

const top = (template: string, date: string, exercise: string) => templatePreview(template, date).find((l) => l.exerciseId === exercise)?.top;

describe('typed 1RM', () => {
  beforeEach(() => {
    createTestDb();
    importPersonalData();
  });

  it('drives the loads: % of (typed lest + bodyweight of the day), given back as lest', () => {
    addBodyEntry('bodyweight', '2026-10-12', 69.5);
    saveOneRm({ exerciseId: 'ex_weighted_dip', value: 57.5, mode: 'manual', setOn: '2026-10-12' });
    expect(referenceFor('ex_weighted_dip', '2026-10-13')?.value).toBe(127);
    // S1 top set 1×5 @80 %: 127 × 0.8 = 101.6 total → +32.1 → +32.5.
    expect(top('tpl_mardi', '2026-10-13', 'ex_weighted_dip')).toMatchObject({ weight: 32.5, reps: 5 });
    // The lest 1RM stays; a heavier bodyweight moves the total with it.
    addBodyEntry('bodyweight', '2026-10-19', 72);
    expect(referenceFor('ex_weighted_dip', '2026-10-20')?.value).toBe(129.5);
  });

  it('bar lifts: the typed value is the total; « Estimation » mode goes back to the history', () => {
    const estimated = referenceFor('ex_squat', '2026-10-15')?.value;
    saveOneRm({ exerciseId: 'ex_squat', value: 110, mode: 'manual', setOn: '2026-10-12' });
    expect(referenceFor('ex_squat', '2026-10-15')?.value).toBe(110);
    expect(top('tpl_jeudi', '2026-10-15', 'ex_squat')).toMatchObject({ weight: 87.5, reps: 5 });
    saveOneRm({ exerciseId: 'ex_squat', value: 110, mode: 'estimated', setOn: '2026-10-12' });
    expect(referenceFor('ex_squat', '2026-10-15')?.value).toBe(estimated);
    const info = referenceInfo('ex_squat', '2026-10-15');
    expect(info.typed?.value).toBe(110);
    expect(info.estimate?.value).toBe(estimated);
  });

  it('is saved in backups and survives « Recharger mon programme »', () => {
    saveOneRm({ exerciseId: 'ex_squat', value: 110, mode: 'manual', setOn: '2026-10-12' });
    expect(buildBackup().tables.exercise_one_rm).toHaveLength(1);
    replaceWithPersonalData();
    expect(getOneRm('ex_squat')).toMatchObject({ value: 110, mode: 'manual' });
  });
});

describe('heavier S4 (one-shot upgrade)', () => {
  beforeEach(() => {
    createTestDb();
    importPersonalData();
  });

  it('moves cycles still on the old pre-filled S4, leaves tuned ones alone', () => {
    const [, c1, c2] = listMesocycles();
    if (c1 === undefined || c2 === undefined) throw new Error('cycles');
    saveMesocycle({ ...c1, scheme: c1.scheme.map((w, i) => (i === 3 ? { ...LEGACY_S4 } : w)) });
    const tuned = { ...LEGACY_S4, backoffSets: 2 };
    saveMesocycle({ ...c2, scheme: c2.scheme.map((w, i) => (i === 3 ? tuned : w)) });
    expect(upgradeLegacyS4()).toBe(1);
    expect(getMesocycle(c1.id)?.scheme[3]).toEqual(DEFAULT_SCHEME_4[3]);
    expect(getMesocycle(c2.id)?.scheme[3]).toEqual(tuned);
    // One shot.
    saveMesocycle({ ...c1, scheme: c1.scheme.map((w, i) => (i === 3 ? { ...LEGACY_S4 } : w)) });
    expect(upgradeLegacyS4()).toBe(0);
  });
});

describe('no fixed loads (migration 7)', () => {
  beforeEach(() => {
    createTestDb();
    importPersonalData();
  });

  it('clears old pinned top sets: the week follows the 1RM and the bodyweight again', () => {
    db().run(
      `INSERT INTO cycle_week_overrides (id, mesocycle_id, exercise_id, week_index, top_reps_min, top_reps_max, top_weight)
       VALUES ('o1', 'meso_cycle1', 'ex_weighted_dip', 2, NULL, NULL, 40), ('o2', 'meso_cycle1', 'ex_weighted_dip', 4, 2, 2, 47.5)`,
    );
    db().exec(MIGRATIONS[6] ?? '');
    const left = weekOverrides('meso_cycle1', 'ex_weighted_dip');
    expect([...left.keys()]).toEqual([4]);
    addBodyEntry('bodyweight', '2026-10-12', 69.5);
    saveOneRm({ exerciseId: 'ex_weighted_dip', value: 57.5, mode: 'manual', setOn: '2026-10-12' });
    // 127 × 92.5 % = 117.5 total − 69.5 → +48 → +47.5 (2.5 kg steps) ; S2 127 × 83 % → +35.
    expect(top('tpl_mardi', '2026-11-03', 'ex_weighted_dip')).toMatchObject({ weight: 47.5, reps: 2 });
    expect(top('tpl_mardi', '2026-10-20', 'ex_weighted_dip')).toMatchObject({ weight: 35, reps: 4 });
  });
});

describe('session loads = % of the day × 1RM', () => {
  beforeEach(() => {
    createTestDb();
    importPersonalData();
    addBodyEntry('bodyweight', '2026-10-12', 69.5);
    saveOneRm({ exerciseId: 'ex_weighted_dip', value: 57.5, mode: 'manual', setOn: '2026-10-12' });
  });

  const dips = (workoutId: string) => {
    const item = loadWorkoutDoc(workoutId)?.items.find((i) => i.exercise.id === 'ex_weighted_dip');
    if (item === undefined) throw new Error('no dips');
    return item;
  };

  it('shows the % of each set and takes a new 1RM on the sets still to do', () => {
    const id = startWorkout({ date: '2026-10-20', templateId: 'tpl_mardi' });
    const before = dips(id);
    expect(before.percents).toEqual({ top: 0.83, backoff: 0.73 });
    // S2: 127 × 83 % − 69.5 → +35 ; backoffs 127 × 73 % − 69.5 → +22.5.
    expect(before.sets.map((s) => s.targetWeight)).toEqual([35, 22.5, 22.5, 22.5, 22.5]);
    saveOneRm({ exerciseId: 'ex_weighted_dip', value: 62.5, mode: 'manual', setOn: '2026-10-20' });
    expect(refreshActiveTargets('ex_weighted_dip')).toEqual([id]);
    // 132 × 83 % − 69.5 = 40.06 → +40 ; 132 × 73 % − 69.5 = 26.86 → +27.5.
    expect(dips(id).sets.map((s) => s.targetWeight)).toEqual([40, 27.5, 27.5, 27.5, 27.5]);
  });

  it('a planned session started on another day keeps the week of its planned day', () => {
    const nov3 = listPlanned('2026-11-03', '2026-11-03').find((p) => p.templateId === 'tpl_mardi');
    if (nov3 === undefined) throw new Error('no planned session on Nov 3');
    const id = startWorkout({ date: '2026-10-20', plannedId: nov3.id });
    expect(getWorkout(id)).toMatchObject({ date: '2026-10-20', weekIndex: 4, isDeload: false });
    const item = dips(id);
    expect(item.percents).toEqual({ top: 0.925, backoff: 0.78 });
    expect(item.sets.map((s) => `${s.setType}:${s.targetWeight}x${s.targetReps}`)).toEqual([
      'top_set:47.5x2',
      ...Array(3).fill('backoff:30x5'),
    ]);
  });
});

describe('starting a session type on a planned day', () => {
  beforeEach(() => {
    createTestDb();
    importPersonalData();
  });

  it('is that planned session: ticked off, one session per planned day', () => {
    const id = startWorkout({ date: '2026-10-20', templateId: 'tpl_mardi' });
    const planned = listPlanned('2026-10-20', '2026-10-20').find((p) => p.templateId === 'tpl_mardi');
    expect(planned?.workoutId).toBe(id);
    expect(getWorkout(id)?.weekIndex).toBe(2);
  });
});
