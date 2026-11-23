import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
/**
 * « Tout exporter (JSON complet) » et sa fusion (23/11) : programme et cycles avec leurs identifiants, bibliothèque à
 * toi, réglages, 1RM, et l'historique (chaque séance, chaque exercice, chaque série, mesures, décalages). Réimporté
 * (sur un compte neuf, sur le même, retouché par toi ou par une IA) : mis à jour par identifiant, ajouté sinon, rien
 * de dupliqué, rien de l'historique effacé.
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
import { createBackend, type Backend } from '../app/src/modules/perf/data/backend';
import { wrapOo1, type Db, type Oo1Db } from '../app/src/modules/perf/data/sql';

let rows: { tbl: string; rid: string; row: unknown }[] = [];
let sqlite3: Awaited<ReturnType<typeof sqlite3InitModule>>;
// Lundi 19 janvier 2026 : « Force A » est prévue le lundi, « Volume » le jeudi.
const MONDAY = '2026-01-19';

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




type Full = {
  sessions: { id: string; name: string; exercises: { id: string; name: string }[] }[];
  library: { id: string; name: string }[];
  settings: Record<string, unknown>;
  oneRepMaxes: { exercise: string; kg: number; date: string }[];
  history: {
    sessions: { id: string; date: string; day: string; name: string; block?: string; week?: number; form?: number; notes?: string; startedAt: string; exercises: { id: string; exercise: string; exerciseId: string; sets: { id: string; type: string; kg?: number; reps?: number; note?: string }[] }[] }[];
    measures: { id: string; date: string; metric: string; value: number }[];
    moves: { id: string; sessionId: string; from: string; to: string }[];
  };
};
const counts = (x: Db) => ['templates', 'template_exercises', 'workouts', 'workout_exercises', 'sets', 'body_entries', 'session_moves', 'mesocycles'].map((t) => `${t}:${x.first<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)!.n}`);
const ALL = { mode: 'add' as const, days: true, oneRms: true, blocks: true };

function prepared() {
  b.setBase({ increment: 1.25 });
  const muscle = b.createExerciseIn(null, { name: 'Muscle-up', loadType: 'bodyweight', category: 'main', equipment: 'bodyweight', primary: ['lats'] });
  const volume = b.dayView(MONDAY).week[3]!.planned[0]!.id;
  b.moveSession(volume, '2026-01-22', '2026-01-23');
  const last = d.first<{ id: string }>("SELECT id FROM workouts WHERE status = 'completed' ORDER BY date DESC")!.id;
  b.rateSession(last, 4, 'genou ok');
  d.run("UPDATE sets SET note = 'dure' WHERE id = (SELECT s.id FROM sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id WHERE we.workout_id = ? AND s.completed = 1 ORDER BY s.position LIMIT 1)", [last]);
  return { muscle, last };
}

describe('Tout exporter (JSON complet)', () => {
  it('programme et cycles avec identifiants, bibliothèque, réglages, 1RM datés, chaque séance et chaque série, mesures, décalages', () => {
    const { muscle, last } = prepared();
    const f = JSON.parse(b.exportFull()) as Full;
    expect(f.sessions.every((s) => s.id && s.exercises.every((e) => e.id))).toBe(true);
    expect(f.library.find((e) => e.id === muscle)).toMatchObject({ name: 'Muscle-up', bodyweight: true });
    expect(f.library.find((e) => e.id === 'ex_squat')).toMatchObject({ custom: false });
    expect(Object.keys(f.settings).length).toBeGreaterThan(0);
    expect(f.oneRepMaxes.map((r) => r.date)).toEqual(['2026-01-01', '2026-01-01']);
    expect(f.history.sessions).toHaveLength(3);
    const s = f.history.sessions.find((x) => x.id === last)!;
    expect(s).toMatchObject({ date: '2026-01-15', day: 'jeudi', block: 'Accumulation', week: 2, form: 4, notes: 'genou ok' });
    expect(s.exercises[0]!.sets[0]).toMatchObject({ type: expect.any(String), kg: 35, reps: expect.any(Number), note: 'dure' });
    expect(f.history.measures).toEqual([expect.objectContaining({ date: '2026-01-01', metric: 'bodyweight', value: 80 })]);
    expect(f.history.moves).toEqual([expect.objectContaining({ from: '2026-01-22', to: '2026-01-23' })]);
    // Aucune table oubliée : chacune est dans l'export, ou écartée pour une raison dite ici.
    const COVERED = ['settings', 'exercises', 'exercise_one_rm', 'macrocycles', 'mesocycles', 'cycle_week_overrides', 'templates', 'template_exercises', 'week_pattern', 'workouts', 'workout_exercises', 'sets', 'body_entries', 'session_moves'];
    const LEFT: Record<string, string> = {
      sync_queue: 'synchro',
      sync_state: 'synchro',
      planned_sessions: 'planning de l’app d’avant (le module suit la semaine type et les décalages)',
      exercise_substitutions: 'souvenir des remplacements, se refait à l’usage',
      formats: 'repris par les créneaux (EMOM, AMRAP, au temps)',
      cycles: 'cycles libres, pas encore utilisés par le module',
    };
    const tables = d.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").map((t) => t.name);
    expect(tables.filter((t) => !COVERED.includes(t) && !(t in LEFT))).toEqual([]);
  });

  it('vers un compte neuf : tout retrouvé avec les mêmes identifiants ; réimporté : rien de dupliqué', () => {
    prepared();
    const file = b.exportFull();
    const before = counts(d);
    const fresh = wrapOo1(new sqlite3.oo1.DB(':memory:') as unknown as Oo1Db);
    const nb = createBackend(fresh);
    const p = nb.importPreview(file);
    expect(p.full).toMatchObject({ sessions: { added: 3, updated: 0, ignored: 0 }, measures: 1, moves: 1, library: { added: 4, updated: 0 }, settings: true });
    nb.applyImport(file, ALL, MONDAY);
    expect(counts(fresh)).toEqual(before);
    expect(fresh.all('SELECT id, exercise_id, workout_id FROM workout_exercises ORDER BY id')).toEqual(d.all('SELECT id, exercise_id, workout_id FROM workout_exercises ORDER BY id'));
    expect(fresh.all('SELECT id, exercise_id, template_id FROM template_exercises ORDER BY id')).toEqual(d.all('SELECT id, exercise_id, template_id FROM template_exercises ORDER BY id'));
    expect(fresh.all('SELECT id, name, date, rating, notes FROM workouts ORDER BY id')).toEqual(d.all('SELECT id, name, date, rating, notes FROM workouts ORDER BY id'));
    expect(fresh.all('SELECT id, weight, reps, note, set_type FROM sets WHERE completed = 1 ORDER BY id')).toEqual(d.all('SELECT id, weight, reps, note, set_type FROM sets WHERE completed = 1 ORDER BY id'));
    expect(fresh.all("SELECT exercise_id, value FROM exercise_one_rm WHERE mode = 'manual' ORDER BY exercise_id")).toEqual(d.all("SELECT exercise_id, value FROM exercise_one_rm WHERE mode = 'manual' ORDER BY exercise_id"));
    expect(fresh.first("SELECT value FROM settings WHERE key = 'app'")).toEqual(d.first("SELECT value FROM settings WHERE key = 'app'"));
    nb.applyImport(file, ALL, MONDAY);
    nb.applyImport(file, { ...ALL, mode: 'replace' }, MONDAY);
    expect(counts(fresh)).toEqual(before);
  });

  it('retouché (par toi ou une IA) : séances modifiées mises à jour, nouvelle séance ajoutée (même sans identifiant), rien de dupliqué ni d’effacé', () => {
    const { last } = prepared();
    const f = JSON.parse(b.exportFull()) as Full;
    const s = f.history.sessions.find((x) => x.id === last)!;
    s.exercises[0]!.sets[0]!.kg = 37.5;
    s.notes = 'genou parfait';
    // Une séance écrite par une IA : sans identifiants, un exercice connu par son nom, un inconnu.
    f.history.sessions.push({ date: '2026-01-17', day: 'samedi', name: 'Séance libre', startedAt: '2026-01-17T10:00:00Z', exercises: [{ exercise: 'Squat', sets: [{ type: 'working', kg: 100, reps: 5 }, { type: 'working', kg: 100, reps: 5 }] }, { exercise: 'Lancer de pneu', sets: [{ type: 'working', reps: 8 }] }] } as unknown as Full['history']['sessions'][number]);
    // Retirer une séance du fichier ne l'efface pas.
    f.history.sessions = f.history.sessions.filter((x) => x.date !== '2026-01-12');
    const text = JSON.stringify(f);
    expect(b.importPreview(text).full!.sessions).toEqual({ added: 1, updated: 2, ignored: 0 });
    const before = d.first<{ n: number }>('SELECT COUNT(*) AS n FROM workouts')!.n;
    b.applyImport(text, ALL, MONDAY);
    expect(d.first<{ n: number }>('SELECT COUNT(*) AS n FROM workouts')!.n).toBe(before + 1);
    expect(d.first<{ notes: string }>('SELECT notes FROM workouts WHERE id = ?', [last])!.notes).toBe('genou parfait');
    expect(d.first<{ weight: number }>('SELECT weight FROM sets WHERE id = ?', [s.exercises[0]!.sets[0]!.id])!.weight).toBe(37.5);
    const added = d.first<{ id: string }>("SELECT id FROM workouts WHERE date = '2026-01-17'")!.id;
    expect(d.all<{ name: string }>('SELECT e.name FROM workout_exercises we JOIN exercises e ON e.id = we.exercise_id WHERE we.workout_id = ? ORDER BY we.position', [added]).map((r) => r.name)).toEqual(['Squat', 'Lancer de pneu']);
    // La même retouche réimportée une seconde fois : la séance sans identifiant est retrouvée par sa date et son nom.
    b.applyImport(text, ALL, MONDAY);
    expect(d.first<{ n: number }>('SELECT COUNT(*) AS n FROM workouts')!.n).toBe(before + 1);
    expect(d.first<{ n: number }>("SELECT COUNT(*) AS n FROM exercises WHERE name = 'Lancer de pneu'")!.n).toBe(1);
    // Programme réimporté sur le même compte : séances types mises à jour sur place, pas de copie « (2) ».
    expect(b.templatesView().map((t) => t.name).filter((n) => / \(\d\)$/.test(n))).toEqual([]);
  });
});
