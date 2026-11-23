import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
/**
 * MyPerf, page Exercices et fiche (maquettes V3-Exercices, V3-Fiche) : la bibliothèque et ses repères (1RM de
 * référence, meilleure série), les variantes et formats à soi, la fiche (référence et estimé côte à côte en lest net,
 * proposition, courbe, charges de travail, records, historique), modifier, archiver, créer une variante.
 */
import { createTestDb } from '@/db/__tests__/testDb';
import { addBodyEntry } from '@/db/repos/body';
import { getExercise } from '@/db/repos/exercises';
import { saveOneRm } from '@/db/repos/oneRm';
import { addPatternEntry, addTemplateExercise, createTemplate } from '@/db/repos/templates';
import { listSetsForWorkout, updateSet } from '@/db/repos/workouts';
import { seedIfEmpty } from '@/db/seed';
import { sqliteStore } from '@/services/cloud/sqliteStore';
import { finishWorkout, startWorkout } from '@/services/workoutService';
import { createBackend, type Backend } from '../app/src/modules/perf/data/backend';
import { wrapOo1, type Db, type Oo1Db } from '../app/src/modules/perf/data/sql';

let rows: { tbl: string; rid: string; row: unknown }[] = [];
let sqlite3: Awaited<ReturnType<typeof sqlite3InitModule>>;
let force = '';
const DATE = '2026-01-19';

beforeAll(async () => {
  sqlite3 = await sqlite3InitModule();
  createTestDb();
  seedIfEmpty();
  addBodyEntry('bodyweight', '2026-01-01', 80);
  force = createTemplate('Force A');
  for (const id of ['ex_squat', 'ex_weighted_pullup', 'ex_barbell_curl']) addTemplateExercise(force, getExercise(id)!);
  addPatternEntry(0, force);
  // 1RM saisi des tractions lestées : +30 kg ; les séries faites montrent bien mieux (+40 × 4).
  saveOneRm({ exerciseId: 'ex_weighted_pullup', value: 30, mode: 'manual', setOn: '2026-01-01' });
  // Deux séances faites ; leurs séries précises sont posées dans chaque base de test (plus bas).
  for (const date of ['2026-01-05', '2026-01-12']) {
    const id = startWorkout({ date, templateId: force });
    for (const s of listSetsForWorkout(id)) updateSet({ ...s, completed: true, completedAt: 1 });
    finishWorkout(id);
  }
  rows = await sqliteStore().snapshot();
});

let d: Db;
let b: Backend;
beforeEach(() => {
  d = wrapOo1(new sqlite3.oo1.DB(':memory:') as unknown as Oo1Db);
  b = createBackend(d);
  b.apply(rows.map((r) => ({ ...r, deleted: false })));
  // Des séries précises, notées par exercice et par séance (comme en salle).
  const plan: Record<string, [number, number][][]> = {
    ex_squat: [[[120, 5]], [[140, 3]]],
    ex_weighted_pullup: [[[35, 5]], [[40, 4]]],
    ex_barbell_curl: [[[30, 10]], [[35, 8]]],
  };
  const workouts = d.all<{ id: string }>("SELECT id FROM workouts WHERE status = 'completed' ORDER BY date");
  workouts.forEach((w, k) => {
    for (const [exerciseId, perWorkout] of Object.entries(plan)) {
      const we = d.first<{ id: string }>('SELECT id FROM workout_exercises WHERE workout_id = ? AND exercise_id = ?', [w.id, exerciseId])!;
      d.run('DELETE FROM sets WHERE workout_exercise_id = ?', [we.id]);
      perWorkout[k]!.forEach(([weight, reps], i) =>
        d.run("INSERT INTO sets (id, workout_exercise_id, position, set_type, type_manual, weight, reps, completed, note) VALUES (?, ?, ?, 'working', 0, ?, ?, 1, '')", [`${we.id}-${i}`, we.id, i, weight, reps]),
      );
    }
  });
});

describe('Exercices : la bibliothèque', () => {
  it('le programme séance par séance, chaque ligne avec sa pastille et un repère ; le reste par muscle ; filtres', () => {
    const v = b.exercisesView(DATE);
    expect(v.inProgram).toBe(3);
    expect(v.sessions).toMatchObject([{ day: 'lun', name: 'Force A' }]);
    const lines = v.sessions[0]!.lines;
    const pull = lines.find((l) => l.id === 'ex_weighted_pullup')!;
    expect(pull).toMatchObject({ tile: 'DOS', region: 'pull', value: '+30 kg', valueLabel: '1RM réf.' });
    expect(pull.kinds).toEqual(expect.arrayContaining(['program', 'bodyweight', 'weighted']));
    // Sans 1RM, la dernière série et quand (séance du 12, aujourd'hui le 19).
    expect(lines.find((l) => l.id === 'ex_barbell_curl')).toMatchObject({ tile: 'BI', value: '35 × 8', valueLabel: 'il y a 7 j' });
    expect(lines.find((l) => l.id === 'ex_squat')).toMatchObject({ tile: 'QUAD', region: 'legs' });
    // Un exercice jamais fait le dit.
    const never = v.all.find((l) => !l.kinds.includes('program'))!;
    expect(never).toMatchObject({ value: null, valueLabel: 'jamais fait' });
    expect(v.library.map((g) => g.label)).toEqual(expect.arrayContaining(['Pectoraux', 'Dos', 'Jambes']));
    expect(v.library.flatMap((g) => g.lines).some((l) => l.kinds.includes('program'))).toBe(false);
    expect(v.total).toBe(v.all.length);
  });

  it('une variante va dans « tes exercices » ; un créneau en EMOM porte son étiquette', () => {
    const variant = b.createVariant('ex_squat', 'Squat pause 2 s');
    const slot = b.templateDetail(force, DATE)!.slots.find((s) => s.exerciseId === 'ex_barbell_curl')!;
    b.updateSlot(slot.id, { format: { base: 'emom', everySec: 60, totalSec: 600 }, strategy: { id: 'linear', params: { sets: 1, reps: 5 } } });
    const v = b.exercisesView(DATE);
    expect(v.library.find((g) => g.id === 'mine')!.lines.map((l) => l.id)).toEqual([variant]);
    expect(v.sessions[0]!.lines.find((l) => l.id === 'ex_barbell_curl')).toMatchObject({ tag: 'EMOM' });
  });
});

describe('Exercices : la fiche', () => {
  it('lesté : référence et estimé en lest net, proposition, courbe, charges de travail, records, historique', () => {
    const e = b.exerciseDetail('ex_weighted_pullup', DATE)!;
    expect(e).toMatchObject({ weighted: true, usesReference: true, context: 'Force A · au % du 1RM', inTemplates: ['Force A'] });
    expect(e.reference).toMatchObject({ value: 30, text: '+30 kg', source: 'saisi' });
    // Estimé : (80 + 40) × (1 + 4/30) − 80 = 56 kg de lest.
    expect(e.estimate!.value).toBe(56);
    expect(e.estimate!.delta).toMatch(/^\+\d/);
    expect(e.proposal).toMatchObject({ value: 56, text: '+56 kg' });
    expect(e.curve.map((p) => p.date)).toEqual(['2026-01-05', '2026-01-12']);
    expect(e.loads.map((l) => l.reps)).toEqual([1, 3, 5, 8, 10]);
    expect(e.loads[0]!.text).toBe('+30');
    expect(e.records[0]).toMatchObject({ label: 'Meilleure série', value: '+40 × 4' });
    expect(e.records.at(-1)).toMatchObject({ label: 'Poids du corps' });
    expect(e.history.map((h) => h.date)).toEqual(['2026-01-12', '2026-01-05']);
    expect(e.history[0]!.summary).toBe('1×4 à +40');
    expect(e.sessions).toBe(2);
    // Appliquer la proposition : la référence devient l'estimé.
    b.setReference('ex_weighted_pullup', e.proposal!.value, DATE);
    expect(b.exerciseDetail('ex_weighted_pullup', DATE)!.proposal).toBeNull();
  });
});

describe('Exercices : modifier, archiver, variante', () => {
  it('nom unique, type « Force » qui fait suivre les blocs, muscles, pas de variante en boucle ; archiver refusé tant qu’il sert', () => {
    b.updateExercise('ex_barbell_curl', { name: 'Curl barre EZ', category: 'main', primary: ['biceps'], secondary: ['forearms', 'zzz'] });
    expect(d.first('SELECT name, category, progression_type, secondary_muscles FROM exercises WHERE id = ?', ['ex_barbell_curl'])).toEqual({ name: 'Curl barre EZ', category: 'main', progression_type: 'top_set_backoff', secondary_muscles: '["forearms"]' });
    expect(() => b.updateExercise('ex_barbell_curl', { name: getExercise('ex_squat')!.name })).toThrow(/existe déjà/);
    const v = b.createVariant('ex_squat', 'Squat pause');
    expect(() => b.updateExercise('ex_squat', { variantOf: v })).toThrow(/boucle/);
    expect(() => b.updateExercise('ex_squat', { variantOf: 'ex_squat' })).toThrow(/propre variante/);
    expect(() => b.archiveExercise('ex_squat')).toThrow(/Force A/);
    b.archiveExercise(v);
    expect(b.exercisesView(DATE).all.some((l) => l.id === v)).toBe(false);
  });

  it('une variante reprend les muscles et la charge, avec son propre 1RM', () => {
    const v = b.createVariant('ex_weighted_pullup', 'Tractions lestées pronation');
    const row = d.first<{ load_type: string; category: string; variant_of: string; primary_muscles: string }>('SELECT load_type, category, variant_of, primary_muscles FROM exercises WHERE id = ?', [v])!;
    const parent = d.first<{ load_type: string; category: string; primary_muscles: string }>('SELECT load_type, category, primary_muscles FROM exercises WHERE id = ?', ['ex_weighted_pullup'])!;
    expect(row).toMatchObject({ load_type: parent.load_type, category: parent.category, variant_of: 'ex_weighted_pullup', primary_muscles: parent.primary_muscles });
    expect(b.exerciseDetail(v, DATE)).toMatchObject({ variantOf: { id: 'ex_weighted_pullup' }, reference: null, sessions: 0, context: 'Pas encore au programme', createdOn: expect.any(String) });
    expect(b.exerciseDetail('ex_weighted_pullup', DATE)!.variants.map((x) => x.id)).toEqual([v]);
  });
});

describe('Exercices : le corps et le volume par muscle (comme l’ancien MyPerf)', () => {
  it('séries dures par semaine par zone (principal 1, secondaire ½ ; bras : isolations en direct, le reste en indirect)', () => {
    // Deux séances (5 et 12 janvier), une série par exercice : sur 28 jours, 2 séries = 0,5 par semaine.
    const v = b.bodyVolume(DATE, 28);
    const at = (id: string) => v.regions.find((r) => r.id === id)!;
    expect(at('back')).toMatchObject({ perWeek: 0.5, level: 1 });
    expect(at('biceps')).toMatchObject({ perWeek: 0.5, indirect: 0.3 }); // arrondi au dixième, comme l'ancienne app
    expect(at('rear_delts')).toMatchObject({ perWeek: 0.3 });
    expect(at('chest')).toMatchObject({ perWeek: 0, level: 0 });
    // Sur 7 jours, la séance du 12 est juste en dehors.
    expect(b.bodyVolume(DATE, 7).regions.find((r) => r.id === 'back')!.perWeek).toBe(0);
  });

  it('toucher une zone : son volume et ses exercices, principal d’abord ; la fiche dit ce que l’exercice travaille', () => {
    const back = b.regionDetail('back', DATE, 28)!;
    expect(back).toMatchObject({ label: 'Dos', perWeek: 0.5 });
    expect(back.exercises[0]).toMatchObject({ id: 'ex_weighted_pullup', role: 'principal' });
    expect(back.exercises.every((e, i, a) => i === 0 || a[i - 1]!.role === 'principal' || e.role === 'secondaire')).toBe(true);
    const regions = b.exerciseDetail('ex_weighted_pullup', DATE)!.regions;
    expect(regions.find((r) => r.id === 'back')).toMatchObject({ role: 'principal', perWeek: 0.5, indirect: false, total: 0.5 });
    expect(regions.find((r) => r.id === 'biceps')).toMatchObject({ role: 'secondaire', indirect: true, perWeek: 0.3 });
  });
});
