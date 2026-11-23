import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
/**
 * MyPerf, page Progrès (maquettes V3-Progres et V3-Progres-libre) : le profil avec des lifts au % (référence, estimé
 * en lest net, tendance, plateau sur deux cycles et « Masquer : voulu »), le profil sans 1RM (ce qui monte dans la
 * grandeur de chaque exercice, chiffres de la période), la régularité sur 14 semaines, le poids du corps.
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
    d.run('UPDATE workouts SET mesocycle_id = ?, started_at = ?, ended_at = ? WHERE id = ?', [meso?.id ?? null, 0, 45 * 60_000, w.id]);
    for (const [exerciseId, sets] of Object.entries(PLAN)) {
      const we = d.first<{ id: string }>('SELECT id FROM workout_exercises WHERE workout_id = ? AND exercise_id = ?', [w.id, exerciseId])!;
      d.run('DELETE FROM sets WHERE workout_exercise_id = ?', [we.id]);
      const [weight, reps] = sets[k]!;
      d.run("INSERT INTO sets (id, workout_exercise_id, position, set_type, type_manual, weight, reps, completed, note) VALUES (?, ?, 0, 'working', 0, ?, ?, 1, '')", [`${we.id}-0`, we.id, weight, reps]);
    }
  });
});

describe('Progrès : avec des lifts au %', () => {
  it('référence et estimé (lest net), tendance ; plateau sur deux cycles ; masqué quand il est voulu', () => {
    const v = b.progressView(DATE, 28, []);
    expect(v.profile).toBe('lifts');
    const squat = v.lifts.find((l) => l.exerciseId === 'ex_squat')!;
    expect(squat).toMatchObject({ reference: '150 kg', rising: true });
    expect(squat.trend).toHaveLength(4);
    const pull = v.lifts.find((l) => l.exerciseId === 'ex_weighted_pullup')!;
    expect(pull.reference).toBeNull();
    expect(pull.estimate).toMatch(/^\+\d/);
    expect(v.plateaus).toEqual([{ exerciseId: 'ex_weighted_pullup', name: getExercise('ex_weighted_pullup')!.name, cycles: 2 }]);
    expect(b.progressView(DATE, 28, ['ex_weighted_pullup:2']).plateaus).toEqual([]);
  });

  it('régularité sur 14 semaines, chiffres de la période, poids du corps', () => {
    const v = b.progressView(DATE, 28, []);
    expect(v.consistency.weeks).toHaveLength(14);
    expect(v.consistency.total).toBe(4);
    expect(v.consistency.weeks.filter((w) => w.sessions > 0).every((w) => w.level === 2)).toBe(true);
    expect(v.stats).toMatchObject({ sessions: 2, planned: 4, minutes: 90 });
    expect(v.window).toMatchObject({ days: 28, from: '2025-12-23', cycle: null });
    expect(v.bodyweight).toMatchObject({ value: 79 });
    expect(b.progressView(DATE, 7, []).stats.sessions).toBe(1);
  });
});

describe('Progrès : sans 1RM', () => {
  it('ce qui monte dans la grandeur de chaque exercice ; séries par muscle', () => {
    for (const s of b.templateDetail(force, DATE)!.slots) b.updateSlot(s.id, { strategy: { id: 'double_progression', params: { sets: 3, repMin: 5, repMax: 10 } } });
    const v = b.progressView(DATE, 28, []);
    expect(v.profile).toBe('free');
    expect(v.lifts).toEqual([]);
    const squat = v.ups.find((u) => u.exerciseId === 'ex_squat')!;
    expect(squat).toMatchObject({ metric: 'charge × reps', now: '135 × 5', before: '125 × 5', better: true });
    expect(v.ups.find((u) => u.exerciseId === 'ex_weighted_pullup')).toMatchObject({ now: '+40 × 4', better: false });
    expect(v.muscles[0]!.sets).toBeGreaterThan(0);
  });
});
