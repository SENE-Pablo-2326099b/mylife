import fs from 'node:fs';
import path from 'node:path';

import { estimate1RM } from '@/domain/math';
import { createTestDb } from '@/db/__tests__/testDb';
import { db } from '@/db/db';
import { addBodyEntry } from '@/db/repos/body';
import { listMesocycles } from '@/db/repos/cycles';
import { emptyOverride, saveWeekOverride } from '@/db/repos/cyclePlans';
import { getExercise, listExercises } from '@/db/repos/exercises';
import { bestE1rm } from '@/db/repos/history';
import { listPlanned } from '@/db/repos/planning';
import { setKv } from '@/db/repos/settings';
import { alternativesFor } from '@/db/repos/substitutions';
import { listTemplateExercises, listTemplates } from '@/db/repos/templates';
import { listSetsForWorkout, listWorkoutExercises, listWorkouts, updateSet } from '@/db/repos/workouts';
import { exerciseStats, weekVolume } from '@/services/statsService';
import { createVariant, finishWorkout, loadWorkoutDoc, referenceFor, replaceExercise, startWorkout } from '@/services/workoutService';

import { HISTORY_CSV } from '../historyCsv';
import {
  importPersonalData,
  parseHistoryCsv,
  replaceWithPersonalData,
  seedPersonalIfFresh,
  tagSets,
  upgradePersonalData,
} from '../importer';

const count = (sql: string, params: (string | number)[] = []) => db().first<{ n: number }>(sql, params)?.n ?? 0;

/** "type:weight×reps" for the sets of one exercise in a workout. */
function setsOf(workoutId: string, exerciseId: string): string[] {
  return db()
    .all<{ set_type: string; weight: number; reps: number }>(
      `SELECT s.set_type, s.weight, s.reps FROM sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id
       WHERE we.workout_id = ? AND we.exercise_id = ? ORDER BY we.position, s.position`,
      [workoutId, exerciseId],
    )
    .map((r) => `${r.set_type}:${r.weight}x${r.reps}`);
}

const workoutOn = (date: string) => listWorkouts(date, date)[0]?.id ?? '';

/** Prescribed targets of a fresh session: "type:weight×reps". */
function prescribed(date: string, templateId: string, exerciseId: string): string[] {
  const id = startWorkout({ date, templateId });
  const item = loadWorkoutDoc(id)?.items.find((i) => i.exercise.id === exerciseId);
  db().run('DELETE FROM workouts WHERE id = ?', [id]);
  return (item?.sets ?? []).map((s) => `${s.setType}:${s.targetWeight}x${s.targetReps}`);
}

describe('personal import', () => {
  let report: ReturnType<typeof importPersonalData>;
  beforeEach(() => {
    createTestDb();
    report = importPersonalData();
  });

  it('embeds exactly data/historique-seances.csv', () => {
    const file = fs.readFileSync(path.join(__dirname, '../../../data/historique-seances.csv'), 'utf8').replace(/\r\n/g, '\n');
    expect(HISTORY_CSV).toBe(file);
    const { rows, errors } = parseHistoryCsv(HISTORY_CSV);
    expect(rows).toHaveLength(266);
    expect(errors).toEqual([]);
  });

  it('imports 17 completed sessions: every CSV set plus the 15 the export lost', () => {
    expect(report.workouts).toBe(17);
    expect(report.csvSets).toBe(266);
    expect(report.recoveredSets).toBe(15);
    expect(count("SELECT COUNT(*) AS n FROM workouts WHERE status = 'completed'")).toBe(17);
    expect(count('SELECT COUNT(*) AS n FROM sets WHERE completed = 1')).toBe(281);
    const ws = listWorkouts('2026-09-01', '2026-10-31');
    expect(ws[0]?.date).toBe('2026-09-08');
    expect(ws[ws.length - 1]?.date).toBe('2026-10-04');
  });

  it('merges name variants into one exercise', () => {
    expect(report.merges).toEqual([
      { from: 'Curl Marteau ', to: 'Curl marteau', rows: 4 },
      { from: 'Développé militaire', to: 'Développé militaire haltères', rows: 3 },
    ]);
    const names = listExercises(true).map((e) => e.name);
    for (const n of ['Curl marteau', 'Dips lesté', 'Dips lesté (volume)', 'Extension overhead un bras', 'Développé militaire haltères']) {
      expect(names.filter((x) => x === n)).toHaveLength(1);
    }
    expect(getExercise('ex_weighted_chinup')?.archived).toBe(true);
    expect(getExercise('ex_cable_rear_delt')?.archived).toBe(true);
    expect(getExercise('ex_reverse_pec_deck_neutral')?.archived).toBe(false);
    expect(getExercise('ex_weighted_dip')?.loadType).toBe('bodyweight');
    expect(getExercise('ex_squat')?.progressionType).toBe('top_set_backoff');
    expect(getExercise('ex_lateral_raise')).toMatchObject({ repRangeMin: 12, repRangeMax: 20, equipment: 'dumbbell' });
    expect(getExercise('ex_machine_lateral_raise')).toMatchObject({ repRangeMin: 12, repRangeMax: 20, equipment: 'machine' });
  });

  it('attaches sessions to their template and Bloc 1 week, with bodyweight', () => {
    const w = listWorkouts('2026-09-29', '2026-09-29')[0];
    expect(w).toMatchObject({ templateId: 'tpl_mardi', mesocycleId: 'meso_bloc1', weekIndex: 4, isDeload: false, bodyweight: 63 });
    expect(listWorkouts('2026-09-08', '2026-09-08')[0]?.weekIndex).toBe(1);
    expect(listWorkouts('2026-10-04', '2026-10-04')[0]?.weekIndex).toBe(4);
  });

  it('tags top set / backoff on main lifts and working elsewhere', () => {
    expect(setsOf(workoutOn('2026-10-01'), 'ex_squat')).toEqual(['top_set:80x10', 'backoff:80x10', 'backoff:80x10', 'backoff:80x10']);
    expect(setsOf(workoutOn('2026-09-08'), 'ex_weighted_dip')).toEqual(['backoff:20x8', 'top_set:25x8', 'backoff:15x8', 'backoff:10x8']);
    // Saturday volume dips: their own exercise, double progression.
    expect(setsOf(workoutOn('2026-10-03'), 'ex_weighted_dip')).toEqual([]);
    expect(setsOf(workoutOn('2026-10-03'), 'ex_weighted_dip_volume')).toEqual(['working:20x10', 'working:20x10', 'working:20x10', 'working:20x10']);
    expect(setsOf(workoutOn('2026-09-30'), 'ex_weighted_pullup')).toEqual(['top_set:0x11', 'backoff:0x9', 'backoff:0x7']);
    expect(setsOf(workoutOn('2026-09-30'), 'ex_weighted_chinup')).toEqual(['top_set:0x6', 'backoff:0x5']);
    expect(setsOf(workoutOn('2026-09-29'), 'ex_triceps_pushdown')).toEqual(['working:20x8', 'working:17.5x8', 'working:15x8', 'working:15x8']);
    expect(tagSets('double_progression', [10, 20])).toEqual(['working', 'working']);
  });

  it('computes e1RM on the imported sets (total mass for lest)', () => {
    expect(bestE1rm('ex_squat', {})).toBeCloseTo(106.67, 1); // 80 × 10
    expect(bestE1rm('ex_weighted_dip', {})).toBeCloseTo(estimate1RM(30, 9, 63), 6); // +30 × 9 (10th rep failed) → +57.9
    expect(bestE1rm('ex_weighted_dip_volume', {})).toBeCloseTo(estimate1RM(20, 10, 63), 6); // Saturday +20 × 10
    // Stats are tracked separately: 4 Tuesdays (force) vs 3 Saturdays (volume).
    expect(exerciseStats('ex_weighted_dip', '2026-10-07').series.map((p) => p.date)).toEqual(['2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29']);
    expect(exerciseStats('ex_weighted_dip_volume', '2026-10-07').series.map((p) => p.date)).toEqual(['2026-09-12', '2026-09-19', '2026-10-03']);
    expect(estimate1RM(35, 7, 63)).toBeCloseTo(57.87, 1); // end-of-bloc +35 × 7
    expect(bestE1rm('ex_weighted_pullup', {})).toBeCloseTo(23.1, 1); // BW × 11
    expect(bestE1rm('ex_weighted_chinup', {})).toBeCloseTo(estimate1RM(10, 7, 63), 6);
    const squat = exerciseStats('ex_squat', '2026-10-07');
    expect(squat.prs.heaviest).toMatchObject({ weight: 80, reps: 10 });
    expect(squat.series).toHaveLength(4);
    expect(squat.cycles.map((c) => c.name)).toEqual(['Bloc 1 — Remise en route']);
    const volume = new Map(weekVolume('2026-09-28').map((v) => [v.muscle, v.sets]));
    expect(volume.get('quads')).toBeGreaterThan(0);
    expect(volume.get('biceps')).toBeGreaterThan(0);
  });

  it('creates the week, the templates and the cycles', () => {
    expect(listTemplates().map((t) => t.name)).toEqual([
      'Mardi — Poussée + triceps',
      'Mercredi — Tirage + biceps',
      'Jeudi — Jambes',
      'Samedi — Haut du corps volume + épaules',
      'Dimanche — Épaules + bras',
    ]);
    const saturday = listTemplateExercises('tpl_samedi');
    expect(saturday[0]).toMatchObject({ exerciseId: 'ex_weighted_dip_volume', progressionType: null, targetSets: 4 });
    expect(getExercise('ex_weighted_dip_volume')).toMatchObject({ progressionType: 'double_progression', repRangeMin: 8, repRangeMax: 10, loadType: 'bodyweight' });
    expect(listTemplateExercises('tpl_mercredi')[0]?.exerciseId).toBe('ex_weighted_pullup');
    expect(listMesocycles().map((m) => [m.name, m.startDate, m.workWeeks, m.deloadWeeks])).toEqual([
      ['Bloc 1 — Remise en route', '2026-09-07', 4, 1],
      ['Cycle 1', '2026-10-12', 4, 1],
      ['Cycle 2', '2026-11-16', 4, 1],
      ['Cycle 3', '2026-12-21', 4, 1],
    ]);
    // Calendar from the Bloc 1 deload week to the end of Cycle 3, no session on Monday / Friday.
    const planned = listPlanned('2026-10-05', '2027-01-24');
    expect(planned).toHaveLength(80);
    expect(planned.some((p) => ['2026-10-12', '2026-10-16'].includes(p.date))).toBe(false);
    expect(report.plannedSessions).toBe(80);
  });

  it('reports the anomalies of the carnet', () => {
    const a = report.anomalies.join('\n');
    expect(a).not.toContain('série 2 absente'); // recovered from the carnet (17.5 turned into a date)
    expect(a).not.toContain('Rowing machine'); // explained by the comments (other machines)
    expect(a).not.toContain('Développé militaire haltères : charge');
    expect(a).not.toContain('Bench incliné Smith'); // 8 Sept was dumbbells
    expect(a).not.toContain('Pushdown corde : charge'); // 29 Sept confirmed at the rope
    expect(a).toContain('Aucune séance enregistrée le mercredi 9 sept.');
    expect(a).not.toContain('Dips lesté'); // force and volume dips are separate exercises now
  });

  it('bases the cycle-1 loads on a reliable (≤ 6 reps) or provisional reference', () => {
    // Squat: nothing ≤ 6 reps in Bloc 1 → 80 × 8 (not 80 × 10), provisional.
    expect(referenceFor('ex_squat', '2026-10-15')).toMatchObject({ status: 'provisional', basis: { load: 80, reps: 8 } });
    expect(referenceFor('ex_squat', '2026-10-15')?.value).toBeCloseTo(101.3, 1);
    // Dips: +35 × 7 (≈ +58 lest on total mass) beats the older +30 × 6 → provisional.
    const dips = referenceFor('ex_weighted_dip', '2026-10-13');
    expect(dips?.status).toBe('provisional');
    expect((dips?.value ?? 0) - 63).toBeCloseTo(57.9, 1);
    // Pull-up: +7.5 × 6 (23 Sept) is ≤ 6 reps and the best → reliable.
    const pullup = referenceFor('ex_weighted_pullup', '2026-10-14');
    expect(pullup?.status).toBe('valid');
    expect((pullup?.value ?? 0) - 63).toBeCloseTo(21.6, 1);
  });

  it('pre-fills cycle 1 as % of the reference 1RM (80/70 … 92.5/78)', () => {
    // Squat, 101.3: S1 1×5 @80 % → 80, 4×6 @70 % → 70 ; S4 1×2 @92.5 % → 92.5, 3×5 @78 % → 80
    expect(prescribed('2026-10-15', 'tpl_jeudi', 'ex_squat')).toEqual(['top_set:80x5', ...Array(4).fill('backoff:70x6')]);
    expect(prescribed('2026-11-05', 'tpl_jeudi', 'ex_squat')).toEqual(['top_set:92.5x2', ...Array(3).fill('backoff:80x5')]);
    // Dips, 63 + 57.9 = 120.9 total: S1 +32.5 × 5, backoffs +22.5 × 6 ; S4 1×2 @92.5 % (111.8 total) → +50, backoffs 78 % (94.3 total) → +32.5
    expect(prescribed('2026-10-13', 'tpl_mardi', 'ex_weighted_dip')).toEqual(['top_set:32.5x5', ...Array(4).fill('backoff:22.5x6')]);
    expect(prescribed('2026-11-03', 'tpl_mardi', 'ex_weighted_dip')).toEqual(['top_set:50x2', ...Array(3).fill('backoff:32.5x5')]);
    // Pull-up, 63 + 21.6: S1 +5 × 5 (programme: "je reprends à +5 kg × 5-6")
    expect(prescribed('2026-10-14', 'tpl_mercredi', 'ex_weighted_pullup')[0]).toBe('top_set:5x5');
    // A newer bodyweight changes the lest, not the total-mass reference.
    addBodyEntry('bodyweight', '2026-10-10', 65);
    expect(prescribed('2026-10-13', 'tpl_mardi', 'ex_weighted_dip')[0]).toBe('top_set:32.5x5'); // 96.7 − 65 = 31.7
    expect(prescribed('2026-10-14', 'tpl_mercredi', 'ex_weighted_pullup')[0]).toBe('top_set:2.5x5');
  });

  it('the first top sets of cycle 1 recalibrate the provisional squat; S4 sets cycle 2', () => {
    const doSession = (date: string, adjust: (setType: string) => { reps?: number; weight?: number } = () => ({})) => {
      const id = startWorkout({ date, templateId: 'tpl_jeudi' });
      const we = listWorkoutExercises(id).find((x) => x.exerciseId === 'ex_squat');
      if (we === undefined) throw new Error('no squat');
      for (const s of listSetsForWorkout(id).filter((x) => x.workoutExerciseId === we.id)) {
        const a = adjust(s.setType);
        updateSet({ ...s, weight: a.weight ?? s.targetWeight, reps: a.reps ?? s.targetReps, completed: true, completedAt: 1 });
      }
      finishWorkout(id);
    };
    doSession('2026-10-15');
    expect(referenceFor('ex_squat', '2026-10-22')).toMatchObject({ status: 'valid', basis: { kind: 'plan' } });
    expect(referenceFor('ex_squat', '2026-10-22')?.value).toBeCloseTo(101.3, 1);
    doSession('2026-10-22');
    doSession('2026-10-29');
    doSession('2026-11-05', (t) => (t === 'top_set' ? { reps: 4 } : {})); // S4 1 rep over
    const c2 = referenceFor('ex_squat', '2026-11-19');
    expect(c2?.value).toBeCloseTo(101.3 * 1.025, 1);
    expect(c2?.calibrations).toHaveLength(1);
    expect(prescribed('2026-11-19', 'tpl_jeudi', 'ex_squat')[0]).toBe('top_set:82.5x5'); // 103.8 × 0.8 = 83.1
  });

  it('runs the Bloc 1 deload this week and follows Saturday volume dips on their own history', () => {
    // Deload = 1×3 @65 % + 2×5 @55 % of the (provisional) 101.3
    expect(prescribed('2026-10-08', 'tpl_jeudi', 'ex_squat')).toEqual(['top_set:65x3', 'backoff:55x5', 'backoff:55x5']);
    // Saturday 17 oct: last Saturday was 4 × 20 × 10 (top of 8-10) → +2.5 kg, back to 8 reps
    expect(prescribed('2026-10-17', 'tpl_samedi', 'ex_weighted_dip_volume')).toEqual([
      'working:22.5x8',
      'working:22.5x8',
      'working:22.5x8',
      'working:22.5x8',
    ]);
  });

  it('lets me tweak a week per exercise; the loads stay % of the 1RM', () => {
    saveWeekOverride('meso_cycle1', 'ex_weighted_pullup', { ...emptyOverride(1), topRepsMin: 6, backoffSets: 2 });
    // Top set reps stay ≤ 5; backoffs at 70 % of 84.6 kg total are below bodyweight → PDC.
    expect(prescribed('2026-10-14', 'tpl_mercredi', 'ex_weighted_pullup')).toEqual(['top_set:5x5', 'backoff:0x6', 'backoff:0x6']);
  });

  it('upgrades an older import: rebuilds only the carnet history, keeps what was done since', () => {
    // Old shape: volume dips under "Dips lesté", no variants, uncorrected history, version 1.
    db().run("UPDATE workout_exercises SET exercise_id = 'ex_weighted_dip' WHERE exercise_id = 'ex_weighted_dip_volume'");
    db().run(
      "UPDATE template_exercises SET exercise_id = 'ex_weighted_dip', progression_type = 'double_progression', rep_min = 8, rep_max = 10 WHERE exercise_id = 'ex_weighted_dip_volume'",
    );
    db().run("DELETE FROM exercises WHERE id = 'ex_weighted_dip_volume'");
    db().run("UPDATE template_exercises SET exercise_id = 'ex_lateral_raise' WHERE exercise_id = 'ex_machine_lateral_raise'");
    db().run("DELETE FROM exercise_substitutions");
    setKv('personal_import_version', '1');
    // A session the user logged after the import must survive.
    const mine = startWorkout({ date: '2026-10-06', templateId: 'tpl_mardi' });
    const before = count('SELECT COUNT(*) AS n FROM sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id WHERE we.workout_id = ?', [mine]);

    expect(upgradePersonalData()).toBe(true);
    expect(upgradePersonalData()).toBe(false);
    expect(listWorkouts('2026-10-06', '2026-10-06').map((w) => w.id)).toEqual([mine]);
    expect(count('SELECT COUNT(*) AS n FROM sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id WHERE we.workout_id = ?', [mine])).toBe(before);
    expect(count("SELECT COUNT(*) AS n FROM workouts WHERE date <= '2026-10-04'")).toBe(17);
    expect(count("SELECT COUNT(*) AS n FROM sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id JOIN workouts w ON w.id = we.workout_id WHERE w.date <= '2026-10-04'")).toBe(281);
    expect(setsOf(workoutOn('2026-10-03'), 'ex_weighted_dip_volume')).toHaveLength(4);
    expect(listTemplateExercises('tpl_samedi')[0]).toMatchObject({ exerciseId: 'ex_weighted_dip_volume', progressionType: null });
    expect(listTemplateExercises('tpl_mardi')[4]?.exerciseId).toBe('ex_machine_lateral_raise');
    // Re-running the import logic never double-counts remembered substitutions.
    setKv('personal_import_version', '1');
    upgradePersonalData();
    const ohp = getExercise('ex_db_ohp');
    if (ohp === null) throw new Error('missing');
    expect(alternativesFor(ohp)[0]?.uses).toBe(1);
  });

  it('applies every carnet comment and keeps substitutes as separate exercises', () => {
    expect(report.corrections).toHaveLength(26);
    // Answers about unexplained jumps: dumbbells on 8 Sept, machine lateral raises on Tuesdays.
    expect(setsOf(workoutOn('2026-09-08'), 'ex_smith_incline_bench')).toEqual([]);
    expect(setsOf(workoutOn('2026-09-08'), 'ex_incline_db_press')).toEqual(['working:16x10', 'working:18x10', 'working:24x10']);
    expect(setsOf(workoutOn('2026-09-29'), 'ex_machine_lateral_raise')).toEqual(['working:25x14', 'working:27.5x12', 'working:27.5x12', 'working:25x12']);
    expect(setsOf(workoutOn('2026-09-13'), 'ex_lateral_raise')).toHaveLength(4);
    expect(listTemplateExercises('tpl_mardi')[4]?.exerciseId).toBe('ex_machine_lateral_raise');
    expect(report.anomalies.filter((a) => a.includes('charge max'))).toEqual([]);
    // Guided shoulder press of 20 Sept is not the dumbbell press.
    expect(setsOf(workoutOn('2026-09-20'), 'ex_db_ohp')).toEqual([]);
    expect(setsOf(workoutOn('2026-09-20'), 'ex_machine_shoulder_press')).toEqual(['working:37.5x7', 'working:32.5x8', 'working:32.5x8']);
    expect(exerciseStats('ex_db_ohp', '2026-10-07').prs.heaviest?.weight).toBe(24);
    // Split inside one exercise: 2 sets rope, then unilateral.
    expect(setsOf(workoutOn('2026-10-04'), 'ex_hammer_cable_rope')).toEqual(['working:22.5x10', 'working:22.5x10']);
    expect(setsOf(workoutOn('2026-10-04'), 'ex_hammer_cable_one_arm')).toEqual(['working:12.5x8', 'working:10x8']);
    expect(setsOf(workoutOn('2026-09-20'), 'ex_overhead_ext')).toEqual(['working:7.75x10', 'working:7.75x10']);
    expect(setsOf(workoutOn('2026-09-20'), 'ex_triceps_ext_one_arm')).toEqual(['working:8.75x10', 'working:8.75x10']);
    // Drop sets written in comments, lost "pdc" and date-mangled loads.
    expect(setsOf(workoutOn('2026-09-19'), 'ex_incline_db_press')).toEqual(['working:24x8', 'working:24x6', 'drop:18x5', 'working:22x8', 'drop:16x5']);
    expect(setsOf(workoutOn('2026-09-23'), 'ex_weighted_pullup')).toEqual(['top_set:7.5x6', 'backoff:7.5x5', 'backoff:0x6', 'backoff:0x6']);
    expect(setsOf(workoutOn('2026-10-03'), 'ex_cable_lateral')).toEqual(Array(4).fill('working:7.5x12'));
    expect(setsOf(workoutOn('2026-09-29'), 'ex_smith_incline_bench')).toEqual(['working:75x9', 'working:70x9', 'working:70x9']);
    // Comments kept as notes on the exercise of that session.
    const note = db().first<{ notes: string }>(
      "SELECT we.notes FROM workout_exercises we WHERE we.workout_id = ? AND we.exercise_id = 'ex_skullcrusher'",
      [workoutOn('2026-09-29')],
    )?.notes;
    expect(note).toContain('dégressif');
  });

  it('remembers substitutions to offer them first in a session', () => {
    const ohp = getExercise('ex_db_ohp');
    const hammer = getExercise('ex_hammer_curl');
    if (ohp === null || hammer === null) throw new Error('missing');
    expect(alternativesFor(ohp)[0]).toMatchObject({ exercise: { id: 'ex_machine_shoulder_press' }, uses: 1 });
    const hammerAlts = alternativesFor(hammer).map((a) => a.exercise.id);
    expect(hammerAlts.slice(0, 3).sort()).toEqual(['ex_hammer_cable_one_arm', 'ex_hammer_cable_rope', 'ex_hammer_preacher_db']);
    // Muscle-based suggestions follow.
    expect(alternativesFor(ohp).some((a) => a.uses === 0 && a.exercise.primaryMuscles.includes('shoulders'))).toBe(true);
  });

  it('swaps mid-session in place: slot shape kept, swap remembered, template optional', () => {
    const id = startWorkout({ date: '2026-10-11', templateId: 'tpl_dimanche' });
    const doc = () => loadWorkoutDoc(id);
    const ohpSlot = doc()?.items.find((i) => i.exercise.id === 'ex_db_ohp');
    if (ohpSlot === undefined) throw new Error('missing slot');
    replaceExercise(ohpSlot.we.id, 'ex_machine_shoulder_press');
    const swapped = doc()?.items.find((i) => i.we.id === ohpSlot.we.id);
    expect(swapped?.exercise.id).toBe('ex_machine_shoulder_press');
    expect(swapped?.sets).toHaveLength(ohpSlot.sets.length); // deload: same reduced count as the slot
    expect(swapped?.ghost.map((s) => s.weight)).toEqual([37.5, 32.5, 32.5]); // its own history, not the dumbbells'
    const ohp = getExercise('ex_db_ohp');
    if (ohp === null) throw new Error('missing');
    expect(alternativesFor(ohp)[0]).toMatchObject({ exercise: { id: 'ex_machine_shoulder_press' }, uses: 2 });
    expect(listTemplateExercises('tpl_dimanche')[0]?.exerciseId).toBe('ex_db_ohp'); // template untouched by default

    const hammerSlot = doc()?.items.find((i) => i.exercise.id === 'ex_hammer_curl');
    if (hammerSlot === undefined) throw new Error('missing slot');
    const variant = createVariant(hammerSlot.exercise, 'Curl marteau machine', 'machine');
    replaceExercise(hammerSlot.we.id, variant, { alsoTemplate: true });
    expect(getExercise(variant)).toMatchObject({ name: 'Curl marteau machine', equipment: 'machine', repRangeMin: 8, repRangeMax: 12, primaryMuscles: ['biceps', 'forearms'] });
    expect(listTemplateExercises('tpl_dimanche')[4]).toMatchObject({ exerciseId: variant, targetSets: 4 });
  });

  it('a swap is a slot done with another exercise: the planned one is remembered, each keeps its own loads', () => {
    const id = startWorkout({ date: '2026-10-11', templateId: 'tpl_dimanche' });
    const item = (weId: string) => loadWorkoutDoc(id)?.items.find((i) => i.we.id === weId);
    const ohpSlot = loadWorkoutDoc(id)?.items.find((i) => i.exercise.id === 'ex_db_ohp');
    if (ohpSlot === undefined) throw new Error('missing slot');
    replaceExercise(ohpSlot.we.id, 'ex_machine_shoulder_press');
    expect(item(ohpSlot.we.id)?.we.replacesExerciseId).toBe('ex_db_ohp');
    expect(item(ohpSlot.we.id)?.replaces).toBe(ohpSlot.exercise.name);
    // Swapped again: still « instead of » what was planned; swapped back: nothing replaced.
    replaceExercise(ohpSlot.we.id, 'ex_smith_incline_bench');
    expect(item(ohpSlot.we.id)?.we.replacesExerciseId).toBe('ex_db_ohp');
    replaceExercise(ohpSlot.we.id, 'ex_db_ohp');
    expect(item(ohpSlot.we.id)?.replaces).toBeNull();
    // Sets already done stay on the planned exercise; the substitute added after replaces it.
    const first = item(ohpSlot.we.id)?.sets[0];
    if (first === undefined) throw new Error('no set');
    updateSet({ ...first, weight: 20, reps: 10, completed: true, completedAt: Date.now() });
    replaceExercise(ohpSlot.we.id, 'ex_machine_shoulder_press');
    const after = loadWorkoutDoc(id)?.items.find((i) => i.exercise.id === 'ex_machine_shoulder_press');
    expect(after?.replaces).toBe(ohpSlot.exercise.name);
    expect(item(ohpSlot.we.id)?.replaces).toBeNull();
  });

  it('rebuilds the history with the same identifiers on every device: no duplicates after a version bump', () => {
    const ids = () => ({
      workouts: db().all<{ id: string }>("SELECT id FROM workouts WHERE date <= '2026-10-04' ORDER BY id").map((r) => r.id),
      sets: db().all<{ id: string }>("SELECT s.id FROM sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id JOIN workouts w ON w.id = we.workout_id WHERE w.date <= '2026-10-04' ORDER BY s.id").map((r) => r.id),
    });
    const first = ids();
    expect(first.workouts).toHaveLength(17);
    expect(first.workouts.every((id) => id.startsWith('hist-'))).toBe(true);
    // Another device imports on its own: same rows, same identifiers.
    createTestDb();
    importPersonalData();
    expect(ids()).toEqual(first);
    // An older import whose history came twice (other identifiers from two devices) is cleaned by the rebuild.
    db().run('PRAGMA foreign_keys = OFF');
    const tables = [['workouts', ['id']], ['workout_exercises', ['id', 'workout_id']], ['sets', ['id', 'workout_exercise_id']]] as const;
    for (const prefix of ['a-', 'b-']) {
      for (const [table, refs] of tables) {
        const cols = db().all<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name);
        const select = cols.map((c) => ((refs as readonly string[]).includes(c) ? `'${prefix}' || ${c}` : c)).join(', ');
        db().run(`INSERT INTO ${table} (${cols.join(', ')}) SELECT ${select} FROM ${table} WHERE id LIKE 'hist-%'`);
      }
    }
    for (const [table] of [...tables].reverse()) db().run(`DELETE FROM ${table} WHERE id LIKE 'hist-%'`);
    db().run('PRAGMA foreign_keys = ON');
    expect(count("SELECT COUNT(*) AS n FROM workouts WHERE date <= '2026-10-04'")).toBe(34);
    setKv('personal_import_version', '4');
    expect(upgradePersonalData()).toBe(true);
    expect(ids()).toEqual(first);
  });

  it('can be replayed and only seeds a fresh database', () => {
    expect(seedPersonalIfFresh()).toBeNull();
    const again = replaceWithPersonalData();
    expect(again.workouts).toBe(17);
    expect(count('SELECT COUNT(*) AS n FROM sets')).toBe(281);
    createTestDb();
    expect(seedPersonalIfFresh()?.csvSets).toBe(266);
  });
});
