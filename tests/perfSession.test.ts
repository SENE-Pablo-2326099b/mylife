import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
/**
 * Phase 4, P2 : la séance dans la base du module MyPerf. Démarrer produit exactement les lignes de l'app d'avant (les
 * deux lisent et écrivent le même compte) ; valider, suivre le top set, la vitesse de 1 à 5, remplacer (aujourd'hui ou
 * le programme), une seule séance en cours, terminer sans double effet, abandonner.
 */
import { createTestDb } from '@/db/__tests__/testDb';
import { db as legacyDb } from '@/db/db';
import { addBodyEntry } from '@/db/repos/body';
import { saveMesocycle } from '@/db/repos/cycles';
import { getExercise } from '@/db/repos/exercises';
import { saveOneRm } from '@/db/repos/oneRm';
import { addTemplateExercise, createTemplate } from '@/db/repos/templates';
import { listSetsForWorkout, updateSet } from '@/db/repos/workouts';
import { seedIfEmpty } from '@/db/seed';
import { sqliteStore } from '@/services/cloud/sqliteStore';
import { discardWorkout, finishWorkout, startWorkout } from '@/services/workoutService';
import { DEFAULT_DELOAD } from '../packages/training/src/mesocycle';
import { schemeForKind } from '../packages/training/src/mesoTypes';
import type { StrengthWeek } from '../packages/training/src/types';
import { createBackend, type Backend } from '../app/src/modules/perf/data/backend';
import { wrapOo1, type Db, type Oo1Db } from '../app/src/modules/perf/data/sql';

type Row = Record<string, unknown>;
let rows: { tbl: string; rid: string; row: unknown }[] = [];
let template = '';
let legacyStart: { workout: Row; exercises: Row[]; sets: Row[] };
let sqlite3: Awaited<ReturnType<typeof sqlite3InitModule>>;
const DATE = '2026-01-19';

const strip = (r: Row, ...keys: string[]) => Object.fromEntries(Object.entries(r).filter(([k]) => !keys.includes(k)));
function snapshotOf(read: (sql: string, p?: string[]) => Row[], workoutId: string) {
  const workout = read('SELECT * FROM workouts WHERE id = ?', [workoutId])[0]!;
  const exercises = read('SELECT * FROM workout_exercises WHERE workout_id = ? ORDER BY position', [workoutId]);
  const sets = read('SELECT s.* FROM sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id WHERE we.workout_id = ? ORDER BY we.position, s.position', [workoutId]);
  return {
    workout: strip(workout, 'id', 'started_at'),
    exercises: exercises.map((e) => strip(e, 'id', 'workout_id')),
    sets: sets.map((s) => strip(s, 'id', 'workout_exercise_id', 'duration_s', 'distance_m', 'rounds', 'rpe', 'rir', 'speed')),
  };
}

beforeAll(async () => {
  sqlite3 = await sqlite3InitModule();
  createTestDb();
  seedIfEmpty();
  addBodyEntry('bodyweight', '2026-01-01', 80);
  template = createTemplate('Force A');
  // Squat au 1RM saisi, tractions lestées au 1RM saisi (lest), développé (1RM estimé sur l'historique), curl.
  for (const id of ['ex_squat', 'ex_weighted_pullup', 'ex_bench', 'ex_barbell_curl']) addTemplateExercise(template, getExercise(id)!);
  saveOneRm({ exerciseId: 'ex_squat', value: 160, mode: 'manual', setOn: '2026-01-01' });
  saveOneRm({ exerciseId: 'ex_weighted_pullup', value: 50.8, mode: 'manual', setOn: '2026-01-01' });
  saveMesocycle({ name: 'Accumulation', kind: 'accumulation', macrocycleId: null, startDate: '2026-01-05', workWeeks: 4, deloadWeeks: 1, scheme: schemeForKind('accumulation', 4) as StrengthWeek[], deload: DEFAULT_DELOAD, notes: '' });
  const done = startWorkout({ date: '2026-01-12', templateId: template });
  for (const s of listSetsForWorkout(done)) updateSet({ ...s, weight: s.targetWeight ?? 30, reps: s.targetReps ?? 10, completed: true, completedAt: 1 });
  finishWorkout(done);
  // Soulevé de terre ajouté ensuite : aucun historique, aucun 1RM (backoffs qui suivent le top set).
  addTemplateExercise(template, getExercise('ex_deadlift')!);
  const next = startWorkout({ date: DATE, templateId: template });
  legacyStart = snapshotOf((sql, p) => legacyDb().all<Row>(sql, p ?? []), next);
  discardWorkout(next);
  rows = await sqliteStore().snapshot();
});

let d: Db;
let b: Backend;
beforeEach(() => {
  d = wrapOo1(new sqlite3.oo1.DB(':memory:') as unknown as Oo1Db);
  b = createBackend(d);
  b.apply(rows.map((r) => ({ ...r, deleted: false })));
});
const read = (sql: string, p: string[] = []) => d.all<Row>(sql, p);
const itemOf = (id: string, exerciseId: string) => b.sessionDoc(id)!.items.find((i) => i.exerciseId === exerciseId)!;

describe('séance : démarrer', () => {
  it('produit exactement les lignes de l’app d’avant (séance, exercices, séries prescrites)', () => {
    const id = b.startSession(template, DATE);
    expect(snapshotOf(read, id)).toEqual(legacyStart);
  });

  it('une seule séance en cours : démarrer à nouveau rend celle en cours ; séance libre vide', () => {
    const id = b.startSession(template, DATE);
    expect(b.startSession(null, DATE)).toBe(id);
    expect(b.activeSession()).toBe(id);
    b.discardSession(id);
    const free = b.startSession(null, DATE);
    expect(b.sessionDoc(free)).toMatchObject({ name: 'Séance libre', items: [] });
  });

  it('ce que l’écran montre : bloc, % du jour, 1RM en lest net pour un lesté, dernière fois, poids du corps', () => {
    const doc = b.sessionDoc(b.startSession(template, DATE))!;
    expect(doc.block).toEqual({ name: 'Accumulation', week: 3, of: 5, deload: false });
    expect(doc.bodyweight).toBe(80);
    const pullup = doc.items.find((i) => i.exerciseId === 'ex_weighted_pullup')!;
    expect(pullup.reference).toBe(50.8);
    expect(pullup.loadType).toBe('bodyweight');
    expect(pullup.percents).not.toBeNull();
    expect(pullup.lastTime).toMatch(/^\d×\d+ à \+/);
    expect(doc.items.find((i) => i.exerciseId === 'ex_squat')!.reference).toBe(160);
    expect(doc.items.find((i) => i.exerciseId === 'ex_barbell_curl')!.percents).toBeNull();
  });
});

describe('séance : les séries', () => {
  it('valider sans rien saisir accepte la prescription ; sans prescription, la charge est demandée', () => {
    const id = b.startSession(template, DATE);
    const squat = itemOf(id, 'ex_squat');
    const top = squat.sets[0]!;
    expect(b.completeSet(top.id, {})).toBe('ok');
    expect(itemOf(id, 'ex_squat').sets[0]).toMatchObject({ weight: top.targetWeight, reps: top.targetReps, completed: true });
    const deadliftTop = itemOf(id, 'ex_deadlift').sets[0]!;
    expect(deadliftTop.targetWeight).toBeNull();
    expect(b.completeSet(deadliftTop.id, {})).toBe('need-weight');
  });

  it('sans 1RM de référence, les backoffs suivent le top set tapé ; avec un 1RM, rien ne bouge', () => {
    const id = b.startSession(template, DATE);
    const deadlift = itemOf(id, 'ex_deadlift');
    b.updateSet(deadlift.sets[0]!.id, { weight: 100 });
    const backoffs = itemOf(id, 'ex_deadlift').sets.filter((s) => s.setType === 'backoff');
    expect(backoffs.length).toBeGreaterThan(0);
    expect(backoffs.every((s) => s.targetWeight !== null && s.targetWeight < 100 && s.targetWeight > 60)).toBe(true);
    const squatBefore = itemOf(id, 'ex_squat').sets.map((s) => s.targetWeight);
    b.updateSet(itemOf(id, 'ex_squat').sets[0]!.id, { weight: 200 });
    expect(itemOf(id, 'ex_squat').sets.slice(1).map((s) => s.targetWeight)).toEqual(squatBefore.slice(1));
  });

  it('vitesse de 1 à 5 : gardée telle quelle, et traduite pour l’app d’avant (lente, normale, rapide)', () => {
    const id = b.startSession(template, DATE);
    const set = itemOf(id, 'ex_squat').sets[0]!;
    b.updateSet(set.id, { speed: 4 });
    expect(itemOf(id, 'ex_squat').sets[0]!.speed).toBe(4);
    expect(d.first('SELECT speed, bar_speed FROM sets WHERE id = ?', [set.id])).toEqual({ speed: 4, bar_speed: 'fast' });
  });

  it('une série de plus sur le modèle de la dernière ; une série pas faite se retire', () => {
    const id = b.startSession(template, DATE);
    const curl = itemOf(id, 'ex_barbell_curl');
    b.addSet(curl.weId);
    const after = itemOf(id, 'ex_barbell_curl').sets;
    expect(after.length).toBe(curl.sets.length + 1);
    expect(after.at(-1)).toMatchObject({ setType: 'working', targetReps: curl.sets.at(-1)!.targetReps, completed: false });
    b.removeSet(after.at(-1)!.id);
    expect(itemOf(id, 'ex_barbell_curl').sets.length).toBe(curl.sets.length);
  });
});

describe('séance : remplacer, terminer, abandonner', () => {
  it('remplacer aujourd’hui : la séance type ne change pas ; le programme : elle prend le nouvel exercice', () => {
    const id = b.startSession(template, DATE);
    const bench = itemOf(id, 'ex_bench');
    b.completeSet(bench.sets[0]!.id, { weight: 90 });
    b.replaceExercise(bench.weId, 'ex_incline_db_press', 'today');
    const replaced = b.sessionDoc(id)!.items.find((i) => i.weId === bench.weId)!;
    expect(replaced).toMatchObject({ exerciseId: 'ex_incline_db_press', replaces: 'Développé couché' });
    expect(replaced.sets[0]).toMatchObject({ weight: 90, completed: true });
    expect(d.first<{ n: number }>("SELECT COUNT(*) AS n FROM template_exercises WHERE exercise_id = 'ex_bench'")!.n).toBe(1);
    const curl = itemOf(id, 'ex_barbell_curl');
    b.replaceExercise(curl.weId, 'ex_db_curl', 'program');
    expect(d.first<{ n: number }>("SELECT COUNT(*) AS n FROM template_exercises WHERE exercise_id = 'ex_db_curl'")!.n).toBe(1);
    expect(b.exerciseChoices('ex_bench')[0]).toMatchObject({ id: 'ex_incline_db_press', detail: '1 fois à la place' });
  });

  it('terminer : une série saisie sans ✓ compte, les séries pas touchées partent ; deux fois, sans effet', () => {
    const id = b.startSession(template, DATE);
    const squat = itemOf(id, 'ex_squat');
    b.completeSet(squat.sets[0]!.id, {});
    b.updateSet(squat.sets[1]!.id, { weight: 120, reps: 5 });
    expect(b.finishSession(id)).toBe(true);
    const doc = b.sessionDoc(id)!;
    expect(doc.status).toBe('completed');
    expect(doc.items.map((i) => i.exerciseId)).toEqual(['ex_squat']);
    expect(doc.items[0]!.sets.map((s) => s.completed)).toEqual([true, true]);
    const before = JSON.stringify(doc);
    expect(b.finishSession(id)).toBe(false);
    expect(JSON.stringify(b.sessionDoc(id))).toBe(before);
    expect(b.activeSession()).toBeNull();
  });

  it('relié au compte : chaque série validée part à la synchro ; abandonner ne laisse rien', () => {
    b.setState({ device: 't', cursor: 0, joinedAs: 'alex', lastSyncAt: null });
    const id = b.startSession(template, DATE);
    b.completeSet(itemOf(id, 'ex_squat').sets[0]!.id, {});
    const pending = b.pending(500);
    expect(pending.some((p) => p.tbl === 'sets' && (p.row as Row | null)?.completed === 1)).toBe(true);
    b.discardSession(id);
    expect(b.sessionDoc(id)).toBeNull();
    expect(read('SELECT * FROM sets WHERE workout_exercise_id IN (SELECT id FROM workout_exercises WHERE workout_id = ?)', [id])).toEqual([]);
  });
});
