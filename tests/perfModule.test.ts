import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { beforeAll, describe, expect, it } from 'vitest';
/**
 * Phase 4, P1 : la base du module MyPerf (le même SQLite que dans le navigateur, ici en mémoire) lit les lignes que
 * l'app d'avant envoie au compte (synchro `perf`) : toutes ses séances, ses références (en lest net pour un lesté) et
 * ses mesures sont retrouvées, et le moteur prescrit depuis cette base exactement comme l'app d'avant. La synchro
 * (suivi des modifications, oubli d'un autre compte) se comporte comme celle de l'app d'avant.
 */
import { createTestDb } from '@/db/__tests__/testDb';
import { addBodyEntry } from '@/db/repos/body';
import { saveMesocycle } from '@/db/repos/cycles';
import { getExercise } from '@/db/repos/exercises';
import { saveOneRm } from '@/db/repos/oneRm';
import { addTemplateExercise, createTemplate } from '@/db/repos/templates';
import { listSetsForWorkout, listWorkoutExercises, updateSet } from '@/db/repos/workouts';
import { seedIfEmpty } from '@/db/seed';
import { sqliteStore } from '@/services/cloud/sqliteStore';
import { discardWorkout, finishWorkout, startWorkout } from '@/services/workoutService';
import { planSession } from '@mylife/training';
import { DEFAULT_DELOAD } from '../packages/training/src/mesocycle';
import { schemeForKind } from '../packages/training/src/mesoTypes';
import type { StrengthWeek } from '../packages/training/src/types';
import { createBackend, type Backend } from '../app/src/modules/perf/data/backend';
import { historyView, readProgram } from '../app/src/modules/perf/data/queries';
import { wrapOo1, type Db, type Oo1Db } from '../app/src/modules/perf/data/sql';

let rows: { tbl: string; rid: string; row: unknown }[] = [];
let template = '';
let oldPrescription: unknown;
let sqlite3: Awaited<ReturnType<typeof sqlite3InitModule>>;

function memoryDb(): Db {
  return wrapOo1(new sqlite3.oo1.DB(':memory:') as unknown as Oo1Db);
}

const prescriptionOf = (wes: { exerciseId: string; id: string }[], sets: { workoutExerciseId: string; setType: string; targetWeight: number | null; targetReps: number | null }[]) =>
  wes.map((we) => ({ exerciseId: we.exerciseId, sets: sets.filter((s) => s.workoutExerciseId === we.id).map((s) => [s.setType, s.targetWeight, s.targetReps]) }));

beforeAll(async () => {
  sqlite3 = await sqlite3InitModule();
  // L'app d'avant, avec un programme fictif et deux séances faites.
  createTestDb();
  seedIfEmpty();
  addBodyEntry('bodyweight', '2026-01-01', 80);
  template = createTemplate('Force A');
  for (const id of ['ex_squat', 'ex_weighted_pullup', 'ex_barbell_curl']) addTemplateExercise(template, getExercise(id)!);
  saveOneRm({ exerciseId: 'ex_squat', value: 160, mode: 'manual', setOn: '2026-01-01' });
  saveOneRm({ exerciseId: 'ex_weighted_pullup', value: 50.8, mode: 'manual', setOn: '2026-01-01' });
  saveMesocycle({ name: 'Accumulation', kind: 'accumulation', macrocycleId: null, startDate: '2026-01-05', workWeeks: 4, deloadWeeks: 1, scheme: schemeForKind('accumulation', 4) as StrengthWeek[], deload: DEFAULT_DELOAD, notes: '' });
  for (const date of ['2026-01-05', '2026-01-12']) {
    const id = startWorkout({ date, templateId: template });
    for (const s of listSetsForWorkout(id)) updateSet({ ...s, weight: s.targetWeight ?? 30, reps: s.targetReps ?? 10, completed: true, completedAt: 1 });
    finishWorkout(id);
  }
  // Ce que l'app d'avant prescrit pour la séance suivante.
  const next = startWorkout({ date: '2026-01-19', templateId: template });
  oldPrescription = prescriptionOf(listWorkoutExercises(next), listSetsForWorkout(next));
  discardWorkout(next);
  rows = await sqliteStore().snapshot();
});

describe('module MyPerf : la base du navigateur lit les données de l’app d’avant', () => {
  let d: Db;
  let backend: Backend;
  beforeAll(() => {
    d = memoryDb();
    backend = createBackend(d);
    backend.apply(rows.map((r) => ({ ...r, deleted: false })));
  });

  it('toutes les séances, séries, références et mesures sont retrouvées ; les lestés en lest net', () => {
    const o = backend.overview('2026-01-19');
    expect(o).toMatchObject({ workouts: 2, firstDate: '2026-01-05', lastDate: '2026-01-12', templates: 1, blocks: 1, bodyEntries: 1, bodyweight: 80, structure: 'periodized' });
    expect(o.sets).toBeGreaterThan(10);
    expect(o.currentBlock).toEqual({ name: 'Accumulation', week: 3, of: 5, deload: false });
    expect(o.lifts).toEqual([
      { name: getExercise('ex_squat')!.name, shown: 160, weighted: false, source: 'saisi' },
      { name: getExercise('ex_weighted_pullup')!.name, shown: 50.8, weighted: true, source: 'saisi' },
    ]);
    expect(o.capabilities).toEqual(expect.arrayContaining(['blocks', 'reference', 'percentages', 'weighted']));
  });

  it('le moteur, depuis cette base, prescrit la séance suivante exactement comme l’app d’avant', () => {
    const plan = planSession(readProgram(d), template, '2026-01-19', historyView(d))!;
    expect(plan.items.map((i) => ({ exerciseId: i.exercise.id, sets: i.prescription.sets.map((s) => [s.setType, s.targetWeight, s.targetReps]) }))).toEqual(oldPrescription);
  });

  it('les lignes reçues ne repartent pas ; une fois relié, chaque modification est suivie puis acquittée', () => {
    expect(backend.pendingCount()).toBe(0);
    backend.setState({ device: 'test', cursor: 0, joinedAs: 'alex', lastSyncAt: null });
    // Relié : ce qui vient du compte ne repart toujours pas.
    backend.apply([{ tbl: 'body_entries', rid: 'b1x', deleted: false, row: { id: 'b1x', date: '2026-01-18', metric: 'waist', value: 82, created_at: 1 } }]);
    expect(backend.pendingCount()).toBe(0);
    d.run("INSERT INTO body_entries (id, date, metric, value, created_at) VALUES ('b2', '2026-01-20', 'bodyweight', 80.4, 1)");
    const pending = backend.pending(10);
    expect(pending).toEqual([expect.objectContaining({ tbl: 'body_entries', rid: 'b2', row: expect.objectContaining({ value: 80.4 }) })]);
    backend.ack(pending);
    expect(backend.pendingCount()).toBe(0);
    // Le premier envoi d'un appareil : toutes ses lignes, aucune des réglages propres à l'appareil.
    expect(backend.snapshot().length).toBe(rows.length + 2);
  });

  it('une ligne réécrite par l’app d’avant garde les valeurs des nouvelles colonnes (temps, vitesse 1–5…)', () => {
    const set = rows.find((r) => r.tbl === 'sets')!;
    backend.apply([{ tbl: 'sets', rid: set.rid, deleted: false, row: { ...(set.row as object), duration_s: 45, speed: 4 } }]);
    backend.apply([{ tbl: 'sets', rid: set.rid, deleted: false, row: set.row }]);
    expect(d.first('SELECT duration_s, speed FROM sets WHERE id = ?', [set.rid])).toEqual({ duration_s: 45, speed: 4 });
  });

  it('un autre compte : tout est oublié, réglages propres à l’appareil compris', () => {
    backend.forget();
    expect(backend.overview('2026-01-19')).toMatchObject({ workouts: 0, sets: 0, bodyEntries: 0, lifts: [] });
    expect(backend.snapshot()).toEqual([]);
  });
});

describe('module MyPerf : schéma', () => {
  it('un compte neuf part de zéro, et le schéma est celui de l’app d’avant plus les colonnes du moteur composable', () => {
    const d = memoryDb();
    const backend = createBackend(d);
    expect(backend.hasData()).toBe(false);
    expect(backend.overview('2026-01-19')).toMatchObject({ workouts: 0, structure: 'routine', currentBlock: null, lifts: [] });
    const cols = (t: string) => d.all<{ name: string }>(`PRAGMA table_info(${t})`).map((c) => c.name);
    expect(cols('sets')).toEqual(expect.arrayContaining(['bar_speed', 'is_test', 'note', 'duration_s', 'distance_m', 'rounds', 'rpe', 'rir', 'speed']));
    expect(cols('template_exercises')).toEqual(expect.arrayContaining(['progression_type', 'format_id', 'strategy', 'group_json', 'rest_sec']));
    expect(backend.schemaVersion()).toBe(12);
  });
});
