/**
 * Application layer for workouts: glues repositories and pure domain logic.
 * Everything here is synchronous and transactional, so a workout on disk is always consistent.
 */
import { detectStagnation } from '@/domain/analytics';
import { addDays } from '@/domain/dates';
import { DEFAULT_DELOAD, DEFAULT_SCHEME_4, mesocycleForDate, phaseFor, type CyclePhase } from '@/domain/mesocycle';
import { prescribe, type Prescription } from '@/domain/prescription';
import { manualReference, RELIABLE_MAX_REPS, referenceAt, suggestManualUpdate, type ManualSuggestion, type Reference } from '@/domain/reference';
import type {
  Exercise,
  Mesocycle,
  ProgressionType,
  TemplateExercise,
  WeekOverride,
  Workout,
  WorkoutExercise,
  WorkoutSet,
} from '@/domain/types';

import { db, newId } from '@/db/db';
import { latestBodyweight } from '@/db/repos/body';
import { weekOverrides } from '@/db/repos/cyclePlans';
import { listMesocycles } from '@/db/repos/cycles';
import { createExercise, getExercise, listExercises } from '@/db/repos/exercises';
import { getOneRm, type OneRm } from '@/db/repos/oneRm';
import { bestE1rm, cycleBestsAll, lastSessionFor, refSetsFor, toHistorySets, type LastSession } from '@/db/repos/history';
import { getPlanned, linkPlannedWorkout, listPlanned } from '@/db/repos/planning';
import { loadSettings, type AppSettings } from '@/db/repos/settings';
import { getTemplate, getTemplateExercise, listTemplateExercises, templateSlotsForExercise, updateTemplateExercise } from '@/db/repos/templates';
import { recordSubstitution } from '@/db/repos/substitutions';
import {
  deleteSet,
  deleteWorkout,
  deleteWorkoutExercise,
  getActiveWorkout,
  getWorkout,
  insertSet,
  insertWorkout,
  insertWorkoutExercise,
  listSetsForWorkout,
  listWorkoutExercises,
  settleSetsOnFinish,
  updateSet,
  updateWorkoutExercise,
  updateWorkoutMeta,
} from '@/db/repos/workouts';

interface CycleContext {
  settings: AppSettings;
  meso: Mesocycle | null;
  previousMeso: Mesocycle | null;
  phase: CyclePhase | null;
}

function cycleContextForDate(date: string): CycleContext {
  const mesos = listMesocycles();
  const meso = mesocycleForDate(mesos, date);
  const phase = meso === null ? null : phaseFor(meso, date);
  const active = phase !== null && (phase.kind === 'work' || phase.kind === 'deload');
  const idx = meso === null ? -1 : mesos.indexOf(meso);
  return {
    settings: loadSettings(),
    meso: active ? meso : null,
    previousMeso: idx > 0 ? (mesos[idx - 1] ?? null) : null,
    phase: active ? phase : null,
  };
}

/** Rebuilds the cycle context of an existing workout from its snapshot (week index / deload flag). */
function cycleContextForWorkout(w: Workout): CycleContext {
  const settings = loadSettings();
  const mesos = listMesocycles();
  const meso = w.mesocycleId === null ? null : (mesos.find((m) => m.id === w.mesocycleId) ?? null);
  if (meso === null || w.weekIndex === null) return { settings, meso: null, previousMeso: null, phase: null };
  const idx = mesos.indexOf(meso);
  const strength = meso.scheme[w.weekIndex - 1];
  const phase: CyclePhase | null = w.isDeload
    ? { kind: 'deload', week: w.weekIndex }
    : strength === undefined
      ? null
      : { kind: 'work', week: w.weekIndex, strength };
  return { settings, meso, previousMeso: idx > 0 ? (mesos[idx - 1] ?? null) : null, phase };
}

interface ExerciseOverrides {
  progressionType: ProgressionType | null;
  targetSets: number;
  repMin: number | null;
  repMax: number | null;
  topSets: number | null;
  backoffSets: number | null;
  backoffPercent: number | null;
}

const NO_OVERRIDES: ExerciseOverrides = {
  progressionType: null,
  targetSets: 3,
  repMin: null,
  repMax: null,
  topSets: null,
  backoffSets: null,
  backoffPercent: null,
};

function overridesFrom(te: TemplateExercise): ExerciseOverrides {
  return {
    progressionType: te.progressionType,
    targetSets: te.targetSets,
    repMin: te.repMin,
    repMax: te.repMax,
    topSets: te.topSets,
    backoffSets: te.backoffSets,
    backoffPercent: te.backoffPercent,
  };
}

/** Estimated reference 1RM (total mass) of a lift on `date`, from every other workout: see domain/reference. */
function estimatedReference(exerciseId: string, date: string, excludeWorkoutId: string | null): Reference | null {
  // Cycles are read in order so end-of-cycle calibrations (S4) chain.
  const cycles = listMesocycles().map((m) => ({ id: m.id, startDate: m.startDate, workWeeks: m.workWeeks }));
  return referenceAt(refSetsFor(exerciseId, excludeWorkoutId), cycles, date);
}

/** Bodyweight added to a typed 1RM: the session's for weighted lifts (latest known otherwise), 0 on the bar. */
function oneRmBodyweight(exerciseId: string, date: string, bodyweight: number | null | undefined): number {
  if (getExercise(exerciseId)?.loadType !== 'bodyweight') return 0;
  return bodyweight ?? latestBodyweight(date) ?? 0;
}

/**
 * Reference 1RM (total mass) the loads of a lift are a percentage of, on `date`: the 1RM the user
 * typed when it is in manual mode, otherwise the estimate from the history.
 * `bodyweight`: the session's, for weighted lifts (defaults to the latest one known).
 */
export function referenceFor(exerciseId: string, date: string, excludeWorkoutId: string | null = null, bodyweight?: number | null): Reference | null {
  const typed = getOneRm(exerciseId);
  if (typed !== null && typed.mode === 'manual') return manualReference(typed.value, oneRmBodyweight(exerciseId, date, bodyweight), typed.setOn);
  return estimatedReference(exerciseId, date, excludeWorkoutId);
}

export interface ReferenceInfo {
  /** What the loads use. */
  reference: Reference | null;
  /** The estimate from the history (Epley on sets ≤ 6 reps), shown as a guide. */
  estimate: Reference | null;
  /** The typed 1RM, if any (in manual or estimated mode). */
  typed: OneRm | null;
  /** Bodyweight included in the totals (0 on the bar). */
  bodyweight: number;
  /** In manual mode: an S4 / test after the typed value suggests a new one. */
  suggestion: ManualSuggestion | null;
}

export function referenceInfo(exerciseId: string, date: string): ReferenceInfo {
  const typed = getOneRm(exerciseId);
  const bodyweight = oneRmBodyweight(exerciseId, date, undefined);
  const estimate = estimatedReference(exerciseId, date, null);
  const manual = typed !== null && typed.mode === 'manual' ? manualReference(typed.value, bodyweight, typed.setOn) : null;
  const suggestion =
    manual === null || typed === null
      ? null
      : suggestManualUpdate(
          manual.value,
          typed.setOn,
          refSetsFor(exerciseId, null),
          listMesocycles().map((m) => ({ startDate: m.startDate, workWeeks: m.workWeeks })),
        );
  return { reference: manual ?? estimate, estimate, typed, bodyweight, suggestion };
}

interface Prescribed {
  prescription: Prescription;
  /** Reference the loads were derived from (top set + backoff only). */
  reference: Reference | null;
}

function prescriptionFor(
  ctx: CycleContext,
  workout: Pick<Workout, 'id' | 'date' | 'bodyweight'>,
  exercise: Exercise,
  o: ExerciseOverrides,
  params?: Pick<WorkoutExercise, 'repMin' | 'repMax' | 'backoffPercent'>,
  lastSession?: LastSession | null,
): Prescribed {
  const bodyweight = exercise.loadType === 'bodyweight' ? workout.bodyweight : null;
  const scheme = ctx.meso?.scheme ?? DEFAULT_SCHEME_4;
  const progressionType = o.progressionType ?? exercise.progressionType;
  const last = lastSession === undefined ? lastSessionFor(exercise.id, workout.id, progressionType) : lastSession;

  let reference: Reference | null = null;
  let overrides = new Map<number, WeekOverride>();
  if (progressionType === 'top_set_backoff') {
    if (ctx.meso !== null) overrides = weekOverrides(ctx.meso.id, exercise.id);
    reference = referenceFor(exercise.id, workout.date, workout.id === '' ? null : workout.id, workout.bodyweight);
  }

  const prescription = prescribe({
    progressionType,
    repMin: params?.repMin ?? o.repMin ?? exercise.repRangeMin,
    repMax: params?.repMax ?? o.repMax ?? exercise.repRangeMax,
    targetSets: o.targetSets,
    topSetsOverride: o.topSets,
    backoffSetsOverride: o.backoffSets,
    backoffPercent: params?.backoffPercent ?? o.backoffPercent ?? exercise.backoffPercent,
    increment: exercise.weightIncrement ?? ctx.settings.increment,
    bodyweight,
    phase: ctx.phase,
    scheme,
    deload: ctx.meso?.deload ?? DEFAULT_DELOAD,
    lastSets: last === null ? [] : toHistorySets(last.sets),
    referenceE1rm: reference?.value ?? null,
    weekOverrides: overrides,
  });
  return { prescription, reference };
}

function insertExerciseWithSets(
  ctx: CycleContext,
  workout: Workout,
  exercise: Exercise,
  position: number,
  te: TemplateExercise | null,
  replacesExerciseId: string | null = null,
): void {
  const o = te === null ? NO_OVERRIDES : overridesFrom(te);
  const progressionType = o.progressionType ?? exercise.progressionType;
  const { prescription: p, reference } = prescriptionFor(ctx, workout, exercise, o);
  const we: WorkoutExercise = {
    id: newId(),
    workoutId: workout.id,
    exerciseId: exercise.id,
    position,
    progressionType,
    intention: te?.intention ?? (progressionType === 'top_set_backoff' ? 'strength' : 'hypertrophy'),
    repMin: o.repMin ?? exercise.repRangeMin,
    repMax: o.repMax ?? exercise.repRangeMax,
    // Snapshot of the ratio really used this week (deload / per-week tweak) so live recalculation agrees.
    backoffPercent: p.backoffPercent,
    templateExerciseId: te?.id ?? null,
    referenceE1rm: reference?.value ?? null,
    replacesExerciseId,
    notes: '',
  };
  insertWorkoutExercise(we);
  insertPrescribedSets(we.id, p);
}

function insertPrescribedSets(workoutExerciseId: string, p: Prescription): void {
  p.sets.forEach((ps, i) =>
    insertSet({
      id: newId(),
      workoutExerciseId,
      position: i,
      setType: ps.setType,
      typeManual: false,
      weight: null,
      reps: null,
      targetWeight: ps.targetWeight,
      targetReps: ps.targetReps,
      targetRepsMax: ps.targetRepsMax,
      barSpeed: null,
      isTest: false,
      note: '',
      completed: false,
      completedAt: null,
    }),
  );
}

export interface StartOptions {
  date: string;
  templateId?: string | null;
  plannedId?: string | null;
  name?: string;
}

/**
 * Creates an active workout with prescribed sets. Returns its id.
 * A planned session keeps the cycle week of its planned day (the one its preview shows), even when
 * done earlier or later; the workout itself is dated the day it is really done.
 */
export function startWorkout(opts: StartOptions): string {
  // A session type started on a day it is planned is that planned session (ticked off, same week).
  const planned = opts.plannedId
    ? getPlanned(opts.plannedId)
    : opts.templateId
      ? (listPlanned(opts.date, opts.date).find((p) => p.templateId === opts.templateId && p.workoutId === null) ?? null)
      : null;
  const templateId = opts.templateId ?? planned?.templateId ?? null;
  const template = templateId === null ? null : getTemplate(templateId);
  const ctx = cycleContextForDate(planned?.date ?? opts.date);

  const workout: Workout = {
    id: newId(),
    name: opts.name ?? template?.name ?? 'Séance libre',
    date: opts.date,
    templateId: template?.id ?? null,
    plannedId: planned?.id ?? null,
    mesocycleId: ctx.meso?.id ?? null,
    weekIndex: ctx.phase !== null && ctx.phase.kind !== 'before' ? ctx.phase.week : null,
    isDeload: ctx.phase?.kind === 'deload',
    bodyweight: latestBodyweight(opts.date),
    startedAt: Date.now(),
    endedAt: null,
    status: 'active',
    notes: '',
  };

  db().transaction(() => {
    insertWorkout(workout);
    if (template !== null) {
      const tes = listTemplateExercises(template.id);
      let position = 0;
      for (const te of tes) {
        const ex = getExercise(te.exerciseId);
        if (ex === null) continue;
        insertExerciseWithSets(ctx, workout, ex, position, te);
        position += 1;
      }
    }
    if (planned !== null) linkPlannedWorkout(planned.id, workout.id);
  });
  return workout.id;
}

export function addExerciseToWorkout(workoutId: string, exerciseId: string): string | null {
  const workout = getWorkout(workoutId);
  const exercise = getExercise(exerciseId);
  if (workout === null || exercise === null) return null;
  const ctx = cycleContextForWorkout(workout);
  const position = listWorkoutExercises(workoutId).reduce((m, we) => Math.max(m, we.position + 1), 0);
  let id: string | null = null;
  db().transaction(() => {
    insertExerciseWithSets(ctx, workout, exercise, position, null);
    id = listWorkoutExercises(workoutId).find((we) => we.position === position)?.id ?? null;
  });
  return id;
}

/**
 * Swaps the exercise of a slot (machine taken, pain, other gym…). The substitute keeps the slot's
 * shape (set count, intention) but its own loads and history. If sets were already done on the old
 * exercise they stay on it, and the new exercise is inserted right after.
 * The swap is remembered, so it is offered first next time; `alsoTemplate` makes it permanent.
 */
export function replaceExercise(workoutExerciseId: string, newExerciseId: string, opts: { alsoTemplate?: boolean } = {}): void {
  const workoutId = workoutIdOf(workoutExerciseId);
  const workout = workoutId === null ? null : getWorkout(workoutId);
  const we = workout === null ? undefined : listWorkoutExercises(workout.id).find((x) => x.id === workoutExerciseId);
  const exercise = getExercise(newExerciseId);
  if (we === undefined || workout === null || exercise === null || we.exerciseId === exercise.id) return;
  const ctx = cycleContextForWorkout(workout);
  const sets = listSetsForWorkout(workout.id).filter((s) => s.workoutExerciseId === we.id);
  const hasDone = sets.some((s) => s.completed);
  const te = we.templateExerciseId === null ? null : getTemplateExercise(we.templateExerciseId);
  // The slot's shape carries over; exercise-specific settings (reps, %, progression) come from the substitute.
  const slot: TemplateExercise | null =
    te === null ? null : { ...te, exerciseId: exercise.id, repMin: null, repMax: null, backoffPercent: null, progressionType: null };
  // What was planned in the slot, kept through successive swaps; swapping back clears it.
  const origin = we.replacesExerciseId ?? we.exerciseId;
  const replaces = origin === exercise.id ? null : origin;

  db().transaction(() => {
    recordSubstitution(we.exerciseId, exercise.id);
    if (opts.alsoTemplate === true && slot !== null) updateTemplateExercise(slot);
    if (hasDone) {
      // Keep history intact: drop only the pending sets and add the new exercise right after.
      sets.filter((s) => !s.completed).forEach((s) => deleteSet(s.id));
      listWorkoutExercises(workout.id)
        .filter((x) => x.position > we.position)
        .forEach((x) => updateWorkoutExercise({ ...x, position: x.position + 1 }));
      insertExerciseWithSets(ctx, workout, exercise, we.position + 1, slot, replaces);
      return;
    }
    sets.forEach((s) => deleteSet(s.id));
    const o = slot === null ? NO_OVERRIDES : overridesFrom(slot);
    const { prescription: p, reference } = prescriptionFor(ctx, workout, exercise, o);
    updateWorkoutExercise({
      ...we,
      exerciseId: exercise.id,
      progressionType: exercise.progressionType,
      intention: slot?.intention ?? (exercise.progressionType === 'top_set_backoff' ? 'strength' : we.intention),
      repMin: exercise.repRangeMin,
      repMax: exercise.repRangeMax,
      backoffPercent: p.backoffPercent,
      referenceE1rm: reference?.value ?? null,
      replacesExerciseId: replaces,
    });
    insertPrescribedSets(we.id, p);
  });
}

/** Creates a variant of an exercise (e.g. the machine version) that inherits its muscles and settings. */
export function createVariant(base: Exercise, name: string, equipment: Exercise['equipment']): string {
  const { id: _id, archived: _archived, ...rest } = base;
  return createExercise({ ...rest, name, equipment, isCustom: true, notes: `Variante de ${base.name}.` });
}

function workoutIdOf(workoutExerciseId: string): string | null {
  return db().first<{ workout_id: string }>('SELECT workout_id FROM workout_exercises WHERE id = ?', [workoutExerciseId])
    ?.workout_id ?? null;
}

/**
 * After the 1RM of a lift changed: the sets still to do in the running session take the new
 * loads (same % of the day). Done sets and loads the user typed stay. Returns the workout ids touched.
 */
export function refreshActiveTargets(exerciseId: string): string[] {
  const workout = getActiveWorkout();
  const exercise = getExercise(exerciseId);
  if (workout === null || exercise === null) return [];
  const ctx = cycleContextForWorkout(workout);
  const sets = listSetsForWorkout(workout.id);
  let touched = false;
  db().transaction(() => {
    for (const we of listWorkoutExercises(workout.id)) {
      if (we.exerciseId !== exerciseId || we.progressionType !== 'top_set_backoff') continue;
      const te = we.templateExerciseId === null ? null : getTemplateExercise(we.templateExerciseId);
      const o = te === null ? NO_OVERRIDES : overridesFrom(te);
      const { prescription: p, reference } = prescriptionFor(ctx, workout, { ...exercise, progressionType: we.progressionType }, o, we);
      updateWorkoutExercise({ ...we, referenceE1rm: reference?.value ?? null, backoffPercent: p.backoffPercent });
      const own = sets.filter((s) => s.workoutExerciseId === we.id);
      for (const type of ['top_set', 'backoff'] as const) {
        const target = p.sets.find((ps) => ps.setType === type)?.targetWeight ?? null;
        for (const s of own) {
          if (s.setType !== type || s.completed || s.weight !== null || s.targetWeight === target) continue;
          updateSet({ ...s, targetWeight: target });
        }
      }
      touched = true;
    }
  });
  return touched ? [workout.id] : [];
}

export function removeWorkoutExercise(id: string): void {
  deleteWorkoutExercise(id);
}

export function finishWorkout(id: string): void {
  db().transaction(() => {
    const now = Date.now();
    settleSetsOnFinish(id, now);
    updateWorkoutMeta(id, { status: 'completed', endedAt: now });
  });
}

export interface WeekPreview {
  weekIndex: number;
  isDeload: boolean;
  date: string;
  prescription: Prescription;
  reference: Reference | null;
  /** Bodyweight used for that week (weighted exercises), to show the reference as lest. */
  bodyweight: number | null;
}

/**
 * What each week of a cycle would prescribe for one main lift, given today's history and the
 * per-week tweaks — the preview shown while adjusting the cycle. Uses the exercise's top set slot
 * in the templates (its overrides) when there is one.
 */
export function cyclePlanPreview(mesocycleId: string, exerciseId: string): WeekPreview[] {
  const meso = listMesocycles().find((m) => m.id === mesocycleId);
  const exercise = getExercise(exerciseId);
  if (meso === undefined || exercise === null) return [];
  const slot = templateSlotsForExercise(exerciseId).find(
    (te) => (te.progressionType ?? exercise.progressionType) === 'top_set_backoff',
  );
  const o: ExerciseOverrides = { ...(slot === undefined ? NO_OVERRIDES : overridesFrom(slot)), progressionType: 'top_set_backoff' };
  const last = lastSessionFor(exerciseId, null, 'top_set_backoff');
  const out: WeekPreview[] = [];
  for (let w = 1; w <= meso.workWeeks + meso.deloadWeeks; w++) {
    const date = addDays(meso.startDate, (w - 1) * 7);
    const ctx = cycleContextForDate(date);
    const workout = { id: '', date, bodyweight: latestBodyweight(date) };
    const { prescription, reference } = prescriptionFor(ctx, workout, exercise, o, undefined, last);
    out.push({ weekIndex: w, isDeload: w > meso.workWeeks, date, prescription, reference, bodyweight: workout.bodyweight });
  }
  return out;
}

export interface TemplatePreviewLine {
  exerciseId: string;
  name: string;
  main: boolean;
  /** Weighted lifts: the top set load is the lest. */
  lest: boolean;
  /** Same summary as the logging screen ("3×8-12", "1×4 + 3×5 @80%"), deload included. */
  label: string;
  /** Top set target of a main lift (load as logged, reps), when a reference exists. */
  top: { weight: number; reps: number } | null;
}

/**
 * What a session template will prescribe on `date`, with the same engine as starting it: Today
 * can show the real top set load and the deload volume before the session begins.
 */
export function templatePreview(templateId: string, date: string): TemplatePreviewLine[] {
  const ctx = cycleContextForDate(date);
  const workout = { id: '', date, bodyweight: latestBodyweight(date) };
  return listTemplateExercises(templateId).flatMap((te) => {
    const exercise = getExercise(te.exerciseId);
    if (exercise === null) return [];
    const o = overridesFrom(te);
    const main = (o.progressionType ?? exercise.progressionType) === 'top_set_backoff';
    const { prescription } = prescriptionFor(ctx, workout, exercise, o);
    const topSet = main ? prescription.sets.find((x) => x.setType === 'top_set') : undefined;
    return [
      {
        exerciseId: exercise.id,
        name: exercise.name,
        main,
        lest: exercise.loadType === 'bodyweight',
        label: prescription.label,
        top: topSet?.targetWeight != null && topSet.targetReps !== null ? { weight: topSet.targetWeight, reps: topSet.targetReps } : null,
      },
    ];
  });
}

export interface NextSession {
  /** "3×12-20", "Deload · 2×12-20"… as the logging screen will show it. */
  label: string;
  /** Load of the first work set (as logged: lest for weighted work), null without history. */
  weight: number | null;
  repMin: number;
  repMax: number;
  hint: Prescription['hint'];
  increment: number;
}

/**
 * Next session of an accessory (double progression) as the app will prescribe it on `date`: load,
 * rep range and whether the load goes up. Null for main lifts (their plan is the cycle).
 */
export function nextSessionFor(exerciseId: string, date: string): NextSession | null {
  const exercise = getExercise(exerciseId);
  if (exercise === null) return null;
  const slot = templateSlotsForExercise(exerciseId)[0];
  const o = slot === undefined ? NO_OVERRIDES : overridesFrom(slot);
  if ((o.progressionType ?? exercise.progressionType) !== 'double_progression') return null;
  const { prescription } = prescriptionFor(cycleContextForDate(date), { id: '', date, bodyweight: latestBodyweight(date) }, exercise, o);
  const first = prescription.sets.find((x) => x.setType !== 'warmup');
  return {
    label: prescription.label,
    weight: first?.targetWeight ?? null,
    repMin: o.repMin ?? exercise.repRangeMin,
    repMax: o.repMax ?? exercise.repRangeMax,
    hint: prescription.hint,
    increment: exercise.weightIncrement ?? loadSettings().increment,
  };
}

/** Re-opens a finished workout (e.g. finished by mistake). */
export function resumeWorkout(id: string): void {
  updateWorkoutMeta(id, { status: 'active', endedAt: null });
}

export function discardWorkout(id: string): void {
  deleteWorkout(id);
}

// ---------- read model for the logging screen ----------

export interface ExerciseItem {
  we: WorkoutExercise;
  exercise: Exercise;
  sets: readonly WorkoutSet[];
  /** Sets of the previous session of this exercise, shown in grey for reference. */
  ghost: readonly WorkoutSet[];
  ghostDate: string | null;
  label: string;
  hint: Prescription['hint'];
  stagnant: boolean;
  /** Best e1RM ever outside this workout — a set above it is a PR. */
  historicBest: number | null;
  /** Main lifts: the reference 1RM behind the loads (provisional → badge). */
  reference: Reference | null;
  /** Main lifts with a reference: the day's % of the 1RM per set type, shown on each set. */
  percents: Prescription['percents'];
  /** Name of the slot's planned exercise when this one was done instead of it. */
  replaces: string | null;
}

export interface WorkoutDoc {
  workout: Workout;
  items: readonly ExerciseItem[];
  settings: AppSettings;
  phase: CyclePhase | null;
  mesoName: string | null;
}

export function stagnantExerciseIds(): Set<string> {
  const mesoOrder = listMesocycles().map((m) => m.id);
  const byExercise = new Map<string, Map<string, number>>();
  for (const r of cycleBestsAll()) {
    let m = byExercise.get(r.exerciseId);
    if (m === undefined) {
      m = new Map();
      byExercise.set(r.exerciseId, m);
    }
    m.set(r.mesocycleId, r.best);
  }
  const out = new Set<string>();
  byExercise.forEach((bests, exerciseId) => {
    const ordered = mesoOrder.flatMap((id) => {
      const e1rm = bests.get(id);
      return e1rm === undefined ? [] : [{ e1rm }];
    });
    if (detectStagnation(ordered).stagnant) out.add(exerciseId);
  });
  return out;
}

export function loadWorkoutDoc(workoutId: string): WorkoutDoc | null {
  const workout = getWorkout(workoutId);
  if (workout === null) return null;
  const ctx = cycleContextForWorkout(workout);
  const exercises = new Map(listExercises(true).map((e) => [e.id, e]));
  const sets = listSetsForWorkout(workoutId);
  const stagnant = stagnantExerciseIds();
  const items: ExerciseItem[] = [];
  for (const we of listWorkoutExercises(workoutId)) {
    const exercise = exercises.get(we.exerciseId);
    if (exercise === undefined) continue;
    const last = lastSessionFor(exercise.id, workoutId, we.progressionType);
    const { prescription: p, reference } = prescriptionFor(ctx, workout, { ...exercise, progressionType: we.progressionType }, NO_OVERRIDES, we, last);
    const own = sets.filter((s) => s.workoutExerciseId === we.id);
    items.push({
      we,
      exercise,
      sets: own,
      ghost: last?.sets ?? [],
      ghostDate: last?.date ?? null,
      label: sameShape(own, p) ? p.label : (describeSets(we, own, workout.isDeload) ?? p.label),
      hint: workout.status === 'active' ? p.hint : null,
      stagnant: stagnant.has(exercise.id),
      // Main lifts: records only count on reliable sets (≤ 6 reps), like the reference.
      historicBest: bestE1rm(exercise.id, {
        excludeWorkoutId: workoutId,
        maxReps: we.progressionType === 'top_set_backoff' ? RELIABLE_MAX_REPS : undefined,
      }),
      reference,
      percents: we.referenceE1rm === null ? null : p.percents,
      replaces: we.replacesExerciseId === null ? null : (exercises.get(we.replacesExerciseId)?.name ?? null),
    });
  }
  return { workout, items, settings: ctx.settings, phase: ctx.phase, mesoName: ctx.meso?.name ?? null };
}

const countOf = (sets: readonly { setType: string }[], type: string) => sets.filter((s) => s.setType === type).length;

/** The session still has the prescribed set counts: the prescription's label (with its % of 1RM) applies. */
function sameShape(sets: readonly WorkoutSet[], p: Prescription): boolean {
  return (['top_set', 'backoff', 'working'] as const).every((type) => countOf(sets, type) === countOf(p.sets, type));
}

/** Label from the slot's actual sets (sets added or removed during the session). */
export function describeSets(we: WorkoutExercise, sets: readonly WorkoutSet[], isDeload = false): string | null {
  const range = (min: number | null, max: number | null) =>
    min === null ? '?' : max === null || max === min ? `${min}` : `${min}-${max}`;
  if (we.progressionType === 'double_progression') {
    const n = sets.filter((s) => s.setType === 'working').length;
    if (n === 0) return null;
    return `${isDeload ? 'Deload · ' : ''}${n}×${range(we.repMin, we.repMax)}`;
  }
  const tops = sets.filter((s) => s.setType === 'top_set');
  const backs = sets.filter((s) => s.setType === 'backoff');
  const top = tops[0];
  if (top === undefined) return null;
  const head = `${isDeload ? 'Deload · ' : ''}${tops.length}×${range(top.targetReps, top.targetRepsMax)}`;
  const back = backs[0];
  if (back === undefined) return head;
  return `${head} + ${backs.length}×${range(back.targetReps, null)}`;
}
