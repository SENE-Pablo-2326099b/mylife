import { beforeAll, describe, expect, it } from 'vitest';
/**
 * Test de référence de la phase 4 : sur un programme fictif complet (trois blocs, lift au barre avec 1RM saisi, lesté
 * avec 1RM saisi en lest, lift au 1RM estimé sur l'historique, accessoires en double progression avec historique,
 * réglages de séance type et de semaine, poids du corps qui change), le nouveau moteur prescrit exactement ce que
 * prescrit l'app MyPerf d'avant, semaine par semaine, décharges comprises. Le côté « avant » est le vrai code de
 * l'app (apps/perf/src) sur une vraie base SQLite ; le côté « après » lit les mêmes tables comme le fera le module.
 */
import { createTestDb } from '@/db/__tests__/testDb';
import { db } from '@/db/db';
import { addBodyEntry } from '@/db/repos/body';
import { saveWeekOverride, emptyOverride } from '@/db/repos/cyclePlans';
import { saveMesocycle } from '@/db/repos/cycles';
import { getExercise } from '@/db/repos/exercises';
import { lastSessionFor, refSetsFor, toHistorySets } from '@/db/repos/history';
import { getOneRm, saveOneRm } from '@/db/repos/oneRm';
import { addTemplateExercise, createTemplate, listTemplateExercises, updateTemplateExercise } from '@/db/repos/templates';
import { latestBodyweight } from '@/db/repos/body';
import { listSetsForWorkout, listWorkoutExercises, updateSet } from '@/db/repos/workouts';
import { seedIfEmpty } from '@/db/seed';
import { discardWorkout, finishWorkout, startWorkout } from '@/services/workoutService';
import { addDays } from '../src/dates';
import { DEFAULT_DELOAD } from '../src/mesocycle';
import { schemeForKind } from '../src/mesoTypes';
import { planSession, programFromLegacy, type HistoryView, type LegacyTables } from '../src';
import type { Exercise, StrengthWeek } from '../src/types';

const TABLES = ['exercises', 'mesocycles', 'cycle_week_overrides', 'templates', 'template_exercises', 'week_pattern', 'settings'] as const;
const rows = (): LegacyTables => Object.fromEntries(TABLES.map((t) => [t, db().all<Record<string, unknown>>(`SELECT * FROM ${t}`)])) as unknown as LegacyTables;

const history: HistoryView = {
  lastSets: (exerciseId, key) => toHistorySets(lastSessionFor(exerciseId, null, key)?.sets ?? []),
  refSets: (exerciseId) => refSetsFor(exerciseId, null),
  typedOneRm: (exerciseId) => getOneRm(exerciseId),
  bodyweight: (date) => latestBodyweight(date),
};

const ex = (id: string): Exercise => {
  const e = getExercise(id);
  if (!e) throw new Error(id);
  return e;
};

/** Une séance faite à la main (l'historique) : chaque série prévue, faite avec `values`. */
function doSession(templateId: string, date: string, values: (exerciseId: string, setType: string) => { weight: number; reps: number }) {
  const id = startWorkout({ date, templateId });
  const wes = listWorkoutExercises(id);
  for (const s of listSetsForWorkout(id)) {
    const we = wes.find((w) => w.id === s.workoutExerciseId)!;
    const v = values(we.exerciseId, s.setType);
    updateSet({ ...s, weight: v.weight, reps: v.reps, completed: true, completedAt: 1 });
  }
  finishWorkout(id);
}

let forceA = '';
let volume = '';
const dates: string[] = [];

beforeAll(() => {
  createTestDb();
  seedIfEmpty();
  addBodyEntry('bodyweight', '2025-12-01', 78);
  addBodyEntry('bodyweight', '2026-02-12', 79.5);

  forceA = createTemplate('Force A');
  for (const id of ['ex_squat', 'ex_weighted_pullup', 'ex_bench', 'ex_barbell_curl']) addTemplateExercise(forceA, ex(id));
  volume = createTemplate('Volume');
  for (const id of ['ex_weighted_dip', 'ex_lateral_raise', 'ex_squat']) addTemplateExercise(volume, ex(id));
  // Réglages de séance type : séries du top set et des backoffs, dips en double progression le jour de volume,
  // élévations à 4 séries de 12-15, squat léger au ratio fixe.
  const [squatA, , benchA] = listTemplateExercises(forceA);
  updateTemplateExercise({ ...squatA!, topSets: 1, backoffSets: 4 });
  updateTemplateExercise({ ...benchA!, backoffPercent: 0.85 });
  const [dipV, latV, squatV] = listTemplateExercises(volume);
  updateTemplateExercise({ ...dipV!, progressionType: 'double_progression', targetSets: 4, repMin: 6, repMax: 10 });
  updateTemplateExercise({ ...latV!, targetSets: 4, repMin: 12, repMax: 15 });
  updateTemplateExercise({ ...squatV!, progressionType: 'double_progression', targetSets: 3, repMin: 5, repMax: 8 });

  // 1RM saisis : squat à la barre, tractions lestées en lest (le calcul se fait sur la masse totale).
  saveOneRm({ exerciseId: 'ex_squat', value: 150, mode: 'manual', setOn: '2025-12-15' });
  saveOneRm({ exerciseId: 'ex_weighted_pullup', value: 40, mode: 'manual', setOn: '2025-12-15' });

  // Historique avant le premier bloc : le développé couché (1RM estimé), les accessoires (double progression).
  doSession(forceA, '2025-12-15', (id) => (id === 'ex_bench' ? { weight: 100, reps: 5 } : id === 'ex_barbell_curl' ? { weight: 30, reps: 12 } : { weight: 120, reps: 4 }));
  doSession(volume, '2025-12-17', (id) => (id === 'ex_weighted_dip' ? { weight: 20, reps: 10 } : id === 'ex_lateral_raise' ? { weight: 10, reps: 15 } : { weight: 100, reps: 6 }));

  const blocks: [string, 'accumulation' | 'transmutation' | 'realization', number][] = [
    ['2026-01-05', 'accumulation', 4],
    ['2026-02-09', 'transmutation', 3],
    ['2026-03-09', 'realization', 3],
  ];
  const mesoIds: string[] = [];
  for (const [startDate, kind, workWeeks] of blocks) {
    const scheme = schemeForKind(kind, workWeeks) as StrengthWeek[];
    mesoIds.push(saveMesocycle({ name: kind, kind, macrocycleId: null, startDate, workWeeks, deloadWeeks: 1, scheme, deload: DEFAULT_DELOAD, notes: '' }));
    for (let w = 0; w < workWeeks + 1; w++) dates.push(addDays(startDate, w * 7));
  }
  // Réglages de semaine : le squat en S2 du premier bloc, les tractions en décharge du deuxième.
  saveWeekOverride(mesoIds[0]!, 'ex_squat', { ...emptyOverride(2), topPercent: 0.85, backoffSets: 5, backoffReps: 4 });
  saveWeekOverride(mesoIds[1]!, 'ex_weighted_pullup', { ...emptyOverride(4), topSets: 2, backoffPercent: 0.6 });
  // Hors de tout bloc, et entre deux blocs.
  dates.unshift('2025-12-29');
  dates.push('2026-04-20');
});

/** Ce que l'app d'avant prescrit en démarrant la séance, puis on l'abandonne (rien ne reste). */
function legacy(templateId: string, date: string) {
  const id = startWorkout({ date, templateId });
  const wes = listWorkoutExercises(id);
  const sets = listSetsForWorkout(id);
  const out = wes.map((we) => ({
    exerciseId: we.exerciseId,
    reference: we.referenceE1rm,
    backoffPercent: we.backoffPercent,
    sets: sets.filter((s) => s.workoutExerciseId === we.id).map((s) => [s.setType, s.targetWeight, s.targetReps, s.targetRepsMax]),
  }));
  discardWorkout(id);
  return out;
}

function engine(templateId: string, date: string) {
  const plan = planSession(programFromLegacy(rows()), templateId, date, history);
  if (!plan) throw new Error('séance introuvable');
  return plan.items.map((i) => ({
    exerciseId: i.exercise.id,
    reference: i.reference?.value ?? null,
    backoffPercent: i.prescription.backoffPercent,
    sets: i.prescription.sets.map((s) => [s.setType, s.targetWeight, s.targetReps, s.targetRepsMax]),
  }));
}

describe('moteur composable : son modèle prescrit exactement comme l’app d’avant', () => {
  it('chaque semaine des trois blocs (décharges comprises), hors bloc et entre deux blocs, pour les deux séances types', () => {
    expect(dates.length).toBe(15);
    let compared = 0;
    for (const date of dates) {
      for (const template of [forceA, volume]) {
        const before = legacy(template, date);
        expect(before.length).toBeGreaterThan(0);
        expect(engine(template, date), `${template} le ${date}`).toEqual(before);
        compared += before.reduce((n, e) => n + e.sets.length, 0);
      }
    }
    // Des centaines de séries comparées, avec de vraies charges (pas seulement des cases vides).
    expect(compared).toBeGreaterThan(300);
  });

  it('les charges ne sont pas vides : 1RM saisis et estimés, lesté sur la masse totale', () => {
    const e = engine(forceA, '2026-01-12');
    const squat = e.find((x) => x.exerciseId === 'ex_squat')!;
    const pullup = e.find((x) => x.exerciseId === 'ex_weighted_pullup')!;
    const bench = e.find((x) => x.exerciseId === 'ex_bench')!;
    expect(squat.sets[0]?.[1]).toBeGreaterThan(100);
    // 40 kg de lest + 78 kg de poids du corps = 118 kg de masse totale ; la charge prescrite reste un lest.
    expect(pullup.reference).toBe(118);
    expect(pullup.sets[0]?.[1]).toBeLessThan(40);
    expect(bench.reference).toBeGreaterThan(100);
  });
});
