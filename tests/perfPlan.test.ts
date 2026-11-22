import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
/**
 * MyPerf, réglages d'entraînement (maquettes E1 à E4) : un seul endroit pour toutes les métriques. Le bloc (semaine par
 * semaine pour tous les lifts au %), chaque lift (semaines ajustées, « Auto », 1RM de référence en lest net), les blocs
 * (type, durée, décalage des suivants, création, suppression), les valeurs de base, un nouvel exercice de force. Tout
 * change réellement ce que la séance prescrit, et s'écrit au format de l'app d'avant.
 */
import { createTestDb } from '@/db/__tests__/testDb';
import { addBodyEntry } from '@/db/repos/body';
import { saveMesocycle } from '@/db/repos/cycles';
import { getExercise } from '@/db/repos/exercises';
import { saveOneRm } from '@/db/repos/oneRm';
import { addPatternEntry, addTemplateExercise, createTemplate } from '@/db/repos/templates';
import { seedIfEmpty } from '@/db/seed';
import { sqliteStore } from '@/services/cloud/sqliteStore';
import { DEFAULT_DELOAD } from '../packages/training/src/mesocycle';
import { schemeForKind } from '../packages/training/src/mesoTypes';
import type { StrengthWeek } from '../packages/training/src/types';
import { createBackend, type Backend } from '../app/src/modules/perf/data/backend';
import { wrapOo1, type Db, type Oo1Db } from '../app/src/modules/perf/data/sql';

let rows: { tbl: string; rid: string; row: unknown }[] = [];
let sqlite3: Awaited<ReturnType<typeof sqlite3InitModule>>;
let force = '';
// Lundi 19 janvier 2026 : semaine 3 du bloc « Accumulation » (5 janvier → 8 février) ; « Transmutation » suit.
const MONDAY = '2026-01-19';

beforeAll(async () => {
  sqlite3 = await sqlite3InitModule();
  createTestDb();
  seedIfEmpty();
  addBodyEntry('bodyweight', '2026-01-01', 80);
  force = createTemplate('Force A');
  for (const id of ['ex_squat', 'ex_weighted_pullup', 'ex_barbell_curl']) addTemplateExercise(force, getExercise(id)!);
  addPatternEntry(0, force);
  saveOneRm({ exerciseId: 'ex_squat', value: 160, mode: 'manual', setOn: '2026-01-01' });
  saveMesocycle({ name: 'Accumulation', kind: 'accumulation', macrocycleId: null, startDate: '2026-01-05', workWeeks: 4, deloadWeeks: 1, scheme: schemeForKind('accumulation', 4) as StrengthWeek[], deload: DEFAULT_DELOAD, notes: '' });
  saveMesocycle({ name: 'Transmutation', kind: 'transmutation', macrocycleId: null, startDate: '2026-02-09', workWeeks: 3, deloadWeeks: 1, scheme: schemeForKind('transmutation', 3) as StrengthWeek[], deload: DEFAULT_DELOAD, notes: '' });
  rows = await sqliteStore().snapshot();
});

let d: Db;
let b: Backend;
beforeEach(() => {
  d = wrapOo1(new sqlite3.oo1.DB(':memory:') as unknown as Oo1Db);
  b = createBackend(d);
  b.apply(rows.map((r) => ({ ...r, deleted: false })));
});
const blockId = (name: string) => d.first<{ id: string }>('SELECT id FROM mesocycles WHERE name = ?', [name])!.id;
const squatToday = () => b.sessionDoc(b.startSession(force, MONDAY))!.items.find((i) => i.exerciseId === 'ex_squat')!;

describe('Réglages : la vue', () => {
  it('le bloc en cours, ses semaines (décharge comprise), les lifts au % avec leur 1RM, les autres progressions, les valeurs de base', () => {
    const v = b.settingsView(MONDAY, null);
    expect(v.blocks.map((x) => [x.name, x.current])).toEqual([['Accumulation', true], ['Transmutation', false]]);
    expect(v.block).toMatchObject({ name: 'Accumulation', currentWeek: 3 });
    expect(v.block!.weeks.map((w) => w.label)).toEqual(['S1', 'S2', 'S3', 'S4', 'Déch.']);
    expect(v.block!.weeks[4]).toMatchObject({ deload: true, top: '1×3', topPct: '65 %' });
    expect(v.lifts.find((l) => l.exerciseId === 'ex_squat')).toMatchObject({ reference: '160 kg', source: 'saisi', adjusted: [] });
    expect(v.others.map((o) => o.exerciseId)).toEqual(['ex_barbell_curl']);
    expect(v.others[0]!.detail).toMatch(/^double progression · /);
    expect(v.base).toMatchObject({ increment: '2,5 kg', bodyweight: '80 kg' });
    // Un autre bloc se choisit.
    expect(b.settingsView(MONDAY, blockId('Transmutation')).block).toMatchObject({ name: 'Transmutation', currentWeek: null });
  });
});

describe('Réglages : un lift', () => {
  it('ajuster une semaine change la séance ; « Auto » revient au bloc ; colonnes de l’app d’avant', () => {
    const before = squatToday().sets.find((s) => s.setType === 'top_set')!.targetWeight!;
    b.discardSession(b.activeSession()!);
    const acc = blockId('Accumulation');
    b.setLiftWeek(acc, 'ex_squat', 3, { topSets: 1, topRepsMin: 2, topPercent: 0.9, backoffSets: 4, backoffReps: 4, backoffPercent: 0.8 });
    expect(d.first('SELECT top_sets, top_reps_min, top_reps_max, intensity, backoff_sets, backoff_reps, backoff_percent FROM cycle_week_overrides WHERE mesocycle_id = ? AND exercise_id = ? AND week_index = 3', [acc, 'ex_squat'])).toEqual({ top_sets: 1, top_reps_min: 2, top_reps_max: 2, intensity: 0.9, backoff_sets: 4, backoff_reps: 4, backoff_percent: 0.8 });
    const lift = b.liftView('ex_squat', null, MONDAY)!;
    expect(lift.weeks[2]).toMatchObject({ adjusted: true, current: true, top: '1×2', topPct: '90 %', back: '4×4', backPct: '80 %' });
    expect(b.settingsView(MONDAY, null).lifts.find((l) => l.exerciseId === 'ex_squat')!.adjusted).toEqual(['S3']);
    const item = squatToday();
    expect(item.sets.find((s) => s.setType === 'top_set')).toMatchObject({ targetReps: 2, targetWeight: 145 });
    expect(item.sets.filter((s) => s.setType === 'backoff')).toHaveLength(4);
    expect(before).not.toBe(145);
    b.discardSession(b.activeSession()!);
    b.setLiftWeek(acc, 'ex_squat', 3, null);
    expect(b.liftView('ex_squat', null, MONDAY)!.weeks[2]!.adjusted).toBe(false);
    expect(squatToday().sets.find((s) => s.setType === 'top_set')!.targetWeight).toBe(before);
    expect(() => b.setLiftWeek(acc, 'ex_squat', 9, {})).toThrow(/invalide/);
  });

  it('1RM de référence saisi en lest net pour un lesté (comme l’app d’avant) ; revenir à l’estimation', () => {
    b.setReference('ex_weighted_pullup', 42.5, MONDAY);
    expect(d.first('SELECT value, mode FROM exercise_one_rm WHERE exercise_id = ?', ['ex_weighted_pullup'])).toEqual({ value: 42.5, mode: 'manual' });
    const lift = b.liftView('ex_weighted_pullup', null, MONDAY)!;
    expect(lift.reference).toMatchObject({ value: 42.5, text: '+42,5 kg', source: 'saisi' });
    // La séance prescrit en lest net, au % de la masse totale (80 + 42,5).
    const pull = b.sessionDoc(b.startSession(force, MONDAY))!.items.find((i) => i.exerciseId === 'ex_weighted_pullup')!;
    expect(pull.reference).toBe(42.5);
    b.discardSession(b.activeSession()!);
    b.setReference('ex_weighted_pullup', null, MONDAY);
    expect(d.first('SELECT 1 FROM exercise_one_rm WHERE exercise_id = ?', ['ex_weighted_pullup'])).toBeNull();
  });
});

describe('Réglages : les blocs', () => {
  it('une semaine du bloc vaut pour tous les lifts ; la décharge a sa forme', () => {
    const acc = blockId('Accumulation');
    b.setBlockWeek(acc, 3, { topSets: 2, topRepsMin: 3, topPercent: 0.85, backoffSets: 3, backoffReps: 5, backoffPercent: 0.75 });
    expect(b.settingsView(MONDAY, acc).block!.weeks[2]).toMatchObject({ top: '2×3', topPct: '85 %', back: '3×5', backPct: '75 %' });
    expect(squatToday().sets.filter((s) => s.setType === 'top_set')).toHaveLength(2);
    b.discardSession(b.activeSession()!);
    b.setBlockWeek(acc, 5, { topSets: 1, topRepsMin: 2, topPercent: 0.6, backoffSets: 1, backoffReps: 5, backoffPercent: 0.5 });
    expect(JSON.parse(d.first<{ deload_main: string }>('SELECT deload_main FROM mesocycles WHERE id = ?', [acc])!.deload_main)).toMatchObject({ topPercent: 0.6, backoffSets: 1 });
  });

  it('autre type : semaines pré-remplies ; plus long : les blocs suivants se décalent ; nouveau bloc enchaîné ; supprimer', () => {
    const acc = blockId('Accumulation');
    b.saveBlock(acc, { workWeeks: 5 }, MONDAY);
    expect(b.blockDetail(acc, MONDAY)).toMatchObject({ workWeeks: 5, dates: '5 janv. → 15 févr.' });
    expect(d.first('SELECT start_date FROM mesocycles WHERE name = ?', ['Transmutation'])).toEqual({ start_date: '2026-02-16' });
    b.saveBlock(acc, { kind: 'realization', name: '  Test  ' }, MONDAY);
    const after = b.blockDetail(acc, MONDAY)!;
    expect(after).toMatchObject({ kind: 'realization', name: 'Test' });
    expect(after.weeks.filter((w) => !w.deload)).toHaveLength(5);
    // Nouveau bloc : après le dernier, même forme, nom suivant.
    const draft = b.blockDetail(null, MONDAY)!;
    expect(draft).toMatchObject({ id: null, name: 'Cycle 3', startDate: '2026-03-16', index: 3, total: 3 });
    const id = b.saveBlock(null, { name: 'Cycle 3' }, MONDAY);
    expect(b.programView(MONDAY).blocks.map((x) => x.name)).toEqual(['Test', 'Transmutation', 'Cycle 3']);
    b.deleteBlock(id);
    expect(b.programView(MONDAY).blocks.map((x) => x.name)).toEqual(['Test', 'Transmutation']);
    expect(() => b.saveBlock(acc, { name: ' ' }, MONDAY)).toThrow(/invalide/);
  });
});

describe('Réglages : valeurs de base et nouvel exercice', () => {
  it('incrément, barre et disques, repos : dans les réglages de l’app d’avant, le reste gardé', () => {
    d.run("INSERT INTO settings (key, value) VALUES ('app', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [JSON.stringify({ increment: 2.5, theme: 'x' })]);
    b.setBase({ increment: 1.25, barWeight: 15, plates: [20, 10, 5, 20], restFloors: { main: 240 } });
    const app = JSON.parse(d.first<{ value: string }>("SELECT value FROM settings WHERE key = 'app'")!.value);
    expect(app).toMatchObject({ increment: 1.25, barWeight: 15, plates: [20, 10, 5], theme: 'x', rest: { floors: { main: 240, compound: 180, isolation: 120 } } });
    expect(b.baseValues()).toMatchObject({ increment: 1.25, barWeight: 15, restFloors: { main: 240 } });
    expect(() => b.setBase({ increment: 0 })).toThrow(/invalide/);
  });

  it('un mouvement de force créé et ajouté d’un geste suit les blocs (au % du 1RM) ; muscles secondaires', () => {
    const id = b.createExerciseIn(force, { name: 'Muscle-up', loadType: 'bodyweight', category: 'main', equipment: 'bodyweight', primary: ['back'], secondary: ['triceps', 'back', 'chest'] });
    expect(d.first('SELECT progression_type, secondary_muscles FROM exercises WHERE id = ?', [id])).toEqual({ progression_type: 'top_set_backoff', secondary_muscles: '["triceps","chest"]' });
    const slot = b.templateDetail(force, MONDAY)!.slots.find((s) => s.exerciseId === id)!;
    expect(b.slotDetail(slot.id, MONDAY)!.strategy.id).toBe('percent_reference');
    expect(b.settingsView(MONDAY, null).lifts.find((l) => l.exerciseId === id)).toMatchObject({ name: 'Muscle-up', reference: null });
    b.setReference(id, 40, MONDAY);
    expect(b.liftView(id, null, MONDAY)!.weeks[2]!.loads.top).toMatch(/^\+\d/);
  });
});
