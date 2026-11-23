import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
/**
 * MyPerf, bilans (maquettes V3-Bilan et V3-Cycle) : le bilan d'une séance (séries, tonnage et écart, records, chaque
 * exercice par rapport au plan, forme et note) et le bilan d'un bloc (séances, records, forme, 1RM proposés, suivant).
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
let force = '';
const DATE = '2026-01-19';
const DATES = ['2025-12-08', '2025-12-22', '2026-01-05', '2026-01-15'];
// Par séance : squat qui monte, tractions lestées qui stagnent, curl qui monte.
const PLAN: Record<string, [number, number][]> = {
  ex_squat: [[120, 5], [125, 5], [130, 5], [135, 5]],
  ex_weighted_pullup: [[40, 4], [40, 4], [40, 4], [40, 4]],
  ex_barbell_curl: [[30, 10], [30, 10], [32.5, 10], [35, 8]],
};

beforeAll(async () => {
  sqlite3 = await sqlite3InitModule();
  createTestDb();
  seedIfEmpty();
  addBodyEntry('bodyweight', '2026-01-10', 80);
  addBodyEntry('bodyweight', '2026-01-17', 79);
  force = createTemplate('Force A');
  for (const id of ['ex_squat', 'ex_weighted_pullup', 'ex_barbell_curl']) addTemplateExercise(force, getExercise(id)!);
  addPatternEntry(0, force);
  saveOneRm({ exerciseId: 'ex_squat', value: 150, mode: 'manual', setOn: '2025-12-01' });
  // Trois cycles de deux semaines : le premier sert de base, les deux suivants sans gain aux tractions.
  for (const [name, start] of [['C1', '2025-12-01'], ['C2', '2025-12-15'], ['C3', '2025-12-29']] as const)
    saveMesocycle({ name, kind: 'accumulation', macrocycleId: null, startDate: start, workWeeks: 2, deloadWeeks: 0, scheme: schemeForKind('accumulation', 2) as StrengthWeek[], deload: DEFAULT_DELOAD, notes: '' });
  for (const date of DATES) {
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
  const blocks = d.all<{ id: string; start_date: string }>('SELECT id, start_date FROM mesocycles ORDER BY start_date');
  d.all<{ id: string; date: string }>("SELECT id, date FROM workouts WHERE status = 'completed' ORDER BY date").forEach((w, k) => {
    const meso = [...blocks].reverse().find((m) => m.start_date <= w.date && w.date < '2026-01-12');
    d.run('UPDATE workouts SET mesocycle_id = ?, started_at = ?, ended_at = ?, bodyweight = 80 WHERE id = ?', [meso?.id ?? null, k, k + 45 * 60_000, w.id]);
    for (const [exerciseId, sets] of Object.entries(PLAN)) {
      const we = d.first<{ id: string }>('SELECT id FROM workout_exercises WHERE workout_id = ? AND exercise_id = ?', [w.id, exerciseId])!;
      d.run('DELETE FROM sets WHERE workout_exercise_id = ?', [we.id]);
      const [weight, reps] = sets[k]!;
      d.run("INSERT INTO sets (id, workout_exercise_id, position, set_type, type_manual, weight, reps, completed, note) VALUES (?, ?, 0, 'working', 0, ?, ?, 1, '')", [`${we.id}-0`, we.id, weight, reps]);
    }
  });
});

describe('Bilan de séance', () => {
  it('séries, tonnage et écart avec la dernière fois, records, chaque exercice par rapport au plan ; forme et note', () => {
    const last = d.first<{ id: string }>("SELECT id FROM workouts WHERE date = '2026-01-15'")!.id;
    const r = b.sessionReport(last)!;
    expect(r).toMatchObject({ name: 'Force A', date: '2026-01-15' });
    expect(r.sets.done).toBe(3);
    expect(r.sets.planned).toBeGreaterThan(3);
    expect(r.tonnage.delta).toMatch(/^[+-]\d+ %$/);
    // Squat 135 × 5 bat 130 × 5 ; le curl 35 × 8 bat 32,5 × 10 ; les tractions restent à +40 × 4.
    expect(r.records.map((x) => x.name).sort()).toEqual([getExercise('ex_barbell_curl')!.name, getExercise('ex_squat')!.name].sort());
    expect(r.exercises.find((x) => x.exerciseId === 'ex_squat')!.verdict).toBe('record');
    expect(r.exercises.find((x) => x.exerciseId === 'ex_weighted_pullup')).toMatchObject({ summary: '1×4 à +40', verdict: 'partiel' });
    expect(r.share).toContain('Force A');
    b.rateSession(last, 4, '  genou ok ');
    expect(b.sessionReport(last)).toMatchObject({ rating: 4, notes: 'genou ok' });
    expect(() => b.rateSession(last, 9, '')).toThrow(/1 à 5/);
    expect(b.sessionReport('inconnue')).toBeNull();
  });
});

describe('Bilan de bloc', () => {
  it('séances faites sur prévues, records, forme moyenne, 1RM proposés, le bloc suivant ; proposé sur Jour deux semaines', () => {
    const id = (name: string) => d.first<{ id: string }>('SELECT id FROM mesocycles WHERE name = ?', [name])!.id;
    const c3 = b.cycleReport(id('C3'), DATE)!;
    expect(c3).toMatchObject({ name: 'C3', ended: true, sessions: { done: 1, planned: 2 }, next: null });
    expect(c3.records).toBeGreaterThan(0);
    // Squat : référence saisie à 150, l'estimé est en dessous : elle reste. Tractions : pas de référence, l'estimé est proposé.
    expect(c3.proposals.find((p) => p.exerciseId === 'ex_squat')).toMatchObject({ from: '150', to: '150 kg', value: 150, changed: false });
    expect(c3.proposals.find((p) => p.exerciseId === 'ex_weighted_pullup')).toMatchObject({ from: null, changed: true, to: expect.stringMatching(/^\+\d/) });
    expect(b.cycleReport(id('C1'), DATE)!.next).toMatchObject({ name: 'C2' });
    const w = d.first<{ id: string }>("SELECT id FROM workouts WHERE date = '2026-01-05'")!.id;
    b.rateSession(w, 3, '');
    expect(b.cycleReport(id('C3'), DATE)!.rating).toBe(3);
    expect(b.justEnded(DATE)).toMatchObject({ name: 'C3' });
    expect(b.justEnded('2026-02-10')).toBeNull();
  });
});
