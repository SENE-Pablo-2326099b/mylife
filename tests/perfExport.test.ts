import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
/**
 * « Exporter mes données » : le CSV des séries (lest net, 1RM estimé net). Le JSON complet : tests/perfFull.test.ts.
 */
import { createTestDb } from '@/db/__tests__/testDb';
import { addBodyEntry } from '@/db/repos/body';
import { saveMesocycle } from '@/db/repos/cycles';
import { getExercise } from '@/db/repos/exercises';
import { saveOneRm } from '@/db/repos/oneRm';
import { addPatternEntry, addTemplateExercise, createTemplate } from '@/db/repos/templates';
import { listSetsForWorkout, updateSet } from '@/db/repos/workouts';
import { seedIfEmpty } from '@/db/seed';
import { sqliteStore } from '@/services/cloud/sqliteStore';
import { finishWorkout, startWorkout } from '@/services/workoutService';
import { DEFAULT_DELOAD } from '../packages/training/src/mesocycle';
import { schemeForKind } from '../packages/training/src/mesoTypes';
import type { StrengthWeek } from '../packages/training/src/types';
import { estimate1RM } from '../packages/training/src/math';
import { createBackend, type Backend } from '../app/src/modules/perf/data/backend';
import { wrapOo1, type Db, type Oo1Db } from '../app/src/modules/perf/data/sql';

let rows: { tbl: string; rid: string; row: unknown }[] = [];
let sqlite3: Awaited<ReturnType<typeof sqlite3InitModule>>;

beforeAll(async () => {
  sqlite3 = await sqlite3InitModule();
  createTestDb();
  seedIfEmpty();
  addBodyEntry('bodyweight', '2026-01-01', 80);
  const force = createTemplate('Force A');
  for (const id of ['ex_squat', 'ex_weighted_pullup']) addTemplateExercise(force, getExercise(id)!);
  const volume = createTemplate('Volume');
  addTemplateExercise(volume, getExercise('ex_barbell_curl')!);
  addPatternEntry(0, force);
  addPatternEntry(3, volume);
  saveOneRm({ exerciseId: 'ex_squat', value: 160, mode: 'manual', setOn: '2026-01-01' });
  saveOneRm({ exerciseId: 'ex_weighted_pullup', value: 50.8, mode: 'manual', setOn: '2026-01-01' });
  saveMesocycle({ name: 'Accumulation', kind: 'accumulation', macrocycleId: null, startDate: '2026-01-05', workWeeks: 4, deloadWeeks: 1, scheme: schemeForKind('accumulation', 4) as StrengthWeek[], deload: DEFAULT_DELOAD, notes: '' });
  // Une séance faite il y a une semaine, puis une autre le jeudi 15, avec un record au curl (plus lourd qu'avant).
  for (const [date, template, w] of [['2026-01-12', force, 0], ['2026-01-13', volume, 30], ['2026-01-15', volume, 35]] as const) {
    const id = startWorkout({ date, templateId: template });
    for (const s of listSetsForWorkout(id)) updateSet({ ...s, weight: w > 0 ? w : (s.targetWeight ?? 0), reps: s.targetReps ?? 10, completed: true, completedAt: 1 });
    finishWorkout(id);
  }
  rows = await sqliteStore().snapshot();
});

let b: Backend;
let d: Db;
beforeEach(() => {
  d = wrapOo1(new sqlite3.oo1.DB(':memory:') as unknown as Oo1Db);
  b = createBackend(d);
  b.apply(rows.map((r) => ({ ...r, deleted: false })));
});


describe('Exporter mes données', () => {
  it('CSV des séries : une ligne par série faite, lest net et 1RM estimé net, textes protégés', () => {
    const last = d.first<{ id: string }>("SELECT id FROM workouts WHERE status = 'completed' ORDER BY date DESC")!;
    b.rateSession(last.id, 5, '');
    d.run("UPDATE sets SET note = 'dur, \"vraiment\"' WHERE completed = 1 AND workout_exercise_id IN (SELECT id FROM workout_exercises WHERE workout_id = ?)", [last.id]);
    const csv = b.setsCsv().split('\n');
    expect(csv[0]).toBe('date,seance,exercice,type_serie,charge_kg,reps,duree_s,tours,e1rm_kg,vitesse,bloc,semaine,decharge,poids_corps_kg,forme,note');
    const done = d.first<{ n: number }>("SELECT COUNT(*) AS n FROM sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id JOIN workouts w ON w.id = we.workout_id WHERE s.completed = 1 AND w.status = 'completed'")!.n;
    expect(csv).toHaveLength(done + 1);
    const pull = csv.find((l) => l.startsWith(`2026-01-12,Force A,${getExercise('ex_weighted_pullup')!.name},`))!;
    const cols = pull.split(',');
    const lest = Number(cols[4]);
    const reps = Number(cols[5]);
    // Lesté : la charge est le lest ; le 1RM estimé est net (masse totale estimée, moins le poids du corps).
    expect(Number(cols[8])).toBe(Math.round(estimate1RM(lest, reps, 80) * 10) / 10);
    expect(Number(cols[8])).toBeLessThan(lest + 80);
    expect(cols[13]).toBe('80');
    expect(csv.find((l) => l.startsWith('2026-01-15'))).toMatch(/,5,"dur, ""vraiment"""$/);
    const fresh = createBackend(wrapOo1(new sqlite3.oo1.DB(':memory:') as unknown as Oo1Db));
    expect(fresh.setsCsv().split('\n')).toHaveLength(1);
    expect(JSON.parse(fresh.exportFull()).history.sessions).toEqual([]);
  });
});
