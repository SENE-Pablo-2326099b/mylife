import { finishWorkout, addExerciseToWorkout, startWorkout } from '@/services/workoutService';

import { buildBackup, restoreBackup, setsCsv } from '../backup';
import { addBodyEntry } from '../repos/body';
import { getWorkout, listSetsForWorkout, updateSet } from '../repos/workouts';
import { seedIfEmpty } from '../seed';
import { createTestDb } from './testDb';

function seedWorkout(): string {
  const id = startWorkout({ date: '2026-03-02' });
  addExerciseToWorkout(id, 'ex_weighted_dip');
  const top = listSetsForWorkout(id)[0];
  if (top === undefined) throw new Error('missing set');
  updateSet({ ...top, weight: 30, reps: 5, barSpeed: 'fast', completed: true, completedAt: 1 });
  finishWorkout(id);
  return id;
}

describe('backup', () => {
  it('round-trips every table through JSON', () => {
    createTestDb();
    seedIfEmpty();
    addBodyEntry('bodyweight', '2026-03-01', 78.5);
    const id = seedWorkout();
    const backup = JSON.parse(JSON.stringify(buildBackup()));

    createTestDb(); // fresh, empty database
    const restored = restoreBackup(backup);
    expect(restored).toBeGreaterThan(40);
    expect(getWorkout(id)?.bodyweight).toBe(78.5);
    expect(listSetsForWorkout(id)[0]?.barSpeed).toBe('fast');
  });

  it('rejects garbage and leaves data untouched', () => {
    createTestDb();
    seedIfEmpty();
    const id = seedWorkout();
    expect(() => restoreBackup({ foo: 1 })).toThrow();
    expect(() => restoreBackup({ app: 'myperf', schemaVersion: 999, tables: {} })).toThrow();
    expect(getWorkout(id)).not.toBeNull();
  });

  it('exports completed sets as CSV with e1RM', () => {
    createTestDb();
    seedIfEmpty();
    addBodyEntry('bodyweight', '2026-03-01', 80);
    seedWorkout();
    const [header, line] = setsCsv().split('\n');
    expect(header?.startsWith('date,seance,exercice')).toBe(true);
    // (80 + 30) × (1 + 5/30) − 80 = 48.3
    expect(line).toContain('Dips lestés,top_set,30,5,48.3,fast');
  });
});
