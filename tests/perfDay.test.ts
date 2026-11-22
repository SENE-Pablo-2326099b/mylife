import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
/**
 * MyPerf, page Jour (module de la coquille) : la séance du jour avec ses charges (même moteur que le démarrage, donc
 * les mêmes que l'app d'avant), la prochaine séance un jour de repos, la semaine, la dernière séance et ses records,
 * et les saisies du « + » (poids du jour, nouvel exercice).
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
import { wrapOo1, type Oo1Db } from '../app/src/modules/perf/data/sql';

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
beforeEach(() => {
  b = createBackend(wrapOo1(new sqlite3.oo1.DB(':memory:') as unknown as Oo1Db));
  b.apply(rows.map((r) => ({ ...r, deleted: false })));
});

describe('MyPerf, Jour', () => {
  it('la séance du jour avec ses charges (lest net pour un lesté), sa durée, et le bloc en cours', () => {
    const v = b.dayView(MONDAY);
    expect(v.block).toEqual({ name: 'Accumulation', week: 3, of: 5, deload: false });
    expect(v.today.map((s) => s.name)).toEqual(['Force A']);
    const [squat, pullup] = v.today[0]!.lines;
    expect(squat!.detail).toMatch(/@ \d+(,\d)? %/);
    expect(squat!.load).toMatch(/^\d+(,\d+)? kg$/);
    expect(pullup!.load).toMatch(/^\+\d+(,\d+)? kg$/);
    expect(v.today[0]!.minutes).toBeGreaterThanOrEqual(5);
    // Les charges sont celles que la séance prescrira en la démarrant.
    const doc = b.sessionDoc(b.startSession(v.today[0]!.id, MONDAY))!;
    expect(squat!.load).toBe(`${String(doc.items[0]!.sets[0]!.targetWeight).replace('.', ',')} kg`);
    expect(b.dayView(MONDAY).active).toMatchObject({ name: 'Force A', done: 0 });
  });

  it('un jour de repos : la prochaine séance de la semaine type ; et la semaine (faites, prévues)', () => {
    const v = b.dayView('2026-01-20');
    expect(v.today).toEqual([]);
    expect(v.next).toMatchObject({ date: '2026-01-22', session: { name: 'Volume' } });
    const week = b.dayView('2026-01-15').week;
    expect(week.map((d) => d.date)).toEqual(['2026-01-12', '2026-01-13', '2026-01-14', '2026-01-15', '2026-01-16', '2026-01-17', '2026-01-18']);
    expect(week[0]).toEqual({ date: '2026-01-12', done: ['Force A'], planned: ['Force A'] });
    expect(week[1]!.done).toEqual(['Volume']);
    expect(week[3]).toEqual({ date: '2026-01-15', done: ['Volume'], planned: ['Volume'] });
  });

  it('la dernière séance, ses chiffres et ses records', () => {
    const last = b.dayView(MONDAY).last!;
    expect(last).toMatchObject({ name: 'Volume', date: '2026-01-15' });
    expect(last.sets).toBeGreaterThan(0);
    expect(last.tonnage).toBeGreaterThan(0);
    expect(last.records.map((r) => r.name)).toEqual([getExercise('ex_barbell_curl')!.name]);
  });

  it('le « + » : poids du jour (borné), nouvel exercice (pas de doublon), aussitôt utilisables', () => {
    b.addBodyweight(MONDAY, 81.3);
    expect(b.overview(MONDAY).bodyweight).toBe(81.3);
    expect(() => b.addBodyweight(MONDAY, 5)).toThrow();
    const id = b.createExercise({ name: 'Planche', loadType: 'bodyweight', category: 'compound', equipment: 'bodyweight', primary: ['abs'] });
    expect(b.exerciseChoices(null).some((e) => e.id === id)).toBe(true);
    expect(() => b.createExercise({ name: 'planche', loadType: 'external', category: 'isolation', equipment: 'other', primary: ['abs'] })).toThrow(/existe déjà/);
  });

  it('un compte neuf : rien de prévu, pas de programme', () => {
    const fresh = createBackend(wrapOo1(new sqlite3.oo1.DB(':memory:') as unknown as Oo1Db));
    expect(fresh.dayView(MONDAY)).toMatchObject({ today: [], next: null, last: null, hasProgram: false, block: null, active: null });
  });
});
