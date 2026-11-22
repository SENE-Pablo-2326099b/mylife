import type { MesoKind } from './mesoTypes';

/**
 * Core domain types. Pure data — no persistence or UI concerns here.
 * All weights are in kilograms.
 */

export type ProgressionType = 'top_set_backoff' | 'double_progression';
export type SetType = 'warmup' | 'top_set' | 'backoff' | 'working' | 'drop';
export type BarSpeed = 'fast' | 'normal' | 'slow';
export type Intention = 'power' | 'strength' | 'hypertrophy';
/** Drives the rest-timer floor: main lifts 5 min, compounds 3 min, isolation 2 min. */
export type ExerciseCategory = 'main' | 'compound' | 'isolation';
/**
 * `bodyweight`: the logged weight is the ADDED load (weighted pull-ups, dips...).
 * e1RM and backoff maths are then done on total system mass (bodyweight + added),
 * which is how street lifting loads actually scale.
 */
export type LoadType = 'external' | 'bodyweight';
export type Equipment =
  | 'barbell'
  | 'dumbbell'
  | 'machine'
  | 'cable'
  | 'bodyweight'
  | 'kettlebell'
  | 'band'
  | 'other';

export const MUSCLES = [
  'chest',
  'back',
  'lats',
  'traps',
  'shoulders',
  'rear_delts',
  'biceps',
  'triceps',
  'forearms',
  'abs',
  'lower_back',
  'glutes',
  'quads',
  'hamstrings',
  'adductors',
  'calves',
] as const;
export type Muscle = (typeof MUSCLES)[number];

export const EQUIPMENTS: readonly Equipment[] = [
  'barbell',
  'dumbbell',
  'machine',
  'cable',
  'bodyweight',
  'kettlebell',
  'band',
  'other',
];

export interface Exercise {
  id: string;
  name: string;
  primaryMuscles: Muscle[];
  secondaryMuscles: Muscle[];
  equipment: Equipment;
  unilateral: boolean;
  loadType: LoadType;
  category: ExerciseCategory;
  progressionType: ProgressionType;
  /** Backoff / top set ratio (total mass) when no reference 1RM is known yet, e.g. 0.8. */
  backoffPercent: number;
  repRangeMin: number;
  repRangeMax: number;
  /** Per-exercise load step (e.g. 2 kg dumbbells). Null → global setting. */
  weightIncrement: number | null;
  isCustom: boolean;
  archived: boolean;
  notes: string;
}

/**
 * One week of the top set + backoff structure (work week or the deload week of the main lifts).
 * Loads are percentages of the reference 1RM — on total mass for weighted exercises
 * (bodyweight + lest), on the bar otherwise. Pre-filled values only: everything is editable.
 */
export interface StrengthWeek {
  topSets: number;
  /** Top set reps: 1 to 5, never 6. */
  topRepsMin: number;
  topRepsMax: number;
  /** Top set load as a fraction of the reference 1RM, e.g. 0.8. */
  topPercent: number;
  backoffSets: number;
  /** Backoff reps: 3 to 6, never more. */
  backoffReps: number;
  /** Backoff load as a fraction of the reference 1RM, e.g. 0.7 (~10-12 % under the top set). */
  backoffPercent: number;
}

export interface DeloadConfig {
  /** Main lifts (top set + backoff) during the deload week: its own shape, % of the reference 1RM. */
  main: StrengthWeek;
  /** Accessories (double progression): load × this, e.g. 0.6. */
  loadFactor: number;
  /** Accessories: set count × this, e.g. 0.5. */
  volumeFactor: number;
}

/**
 * Per exercise, per week tweak of a mesocycle (weeks 1..workWeeks, then workWeeks+1 = deload).
 * Every field is optional: null inherits from the template, then from the cycle's week scheme.
 * No fixed load: every load is a % of the reference 1RM (the user's rule).
 * Percentages are fractions of the reference 1RM, like the scheme.
 */
export interface WeekOverride {
  weekIndex: number;
  topSets: number | null;
  topRepsMin: number | null;
  topRepsMax: number | null;
  backoffSets: number | null;
  backoffReps: number | null;
  backoffPercent: number | null;
  topPercent: number | null;
}

export interface Mesocycle {
  id: string;
  name: string;
  /** Block type (accumulation, transmutation, réalisation…): pre-fills the structure, shown everywhere. */
  kind: MesoKind;
  macrocycleId: string | null;
  /** Local date YYYY-MM-DD. */
  startDate: string;
  workWeeks: number;
  deloadWeeks: number;
  scheme: StrengthWeek[];
  deload: DeloadConfig;
  notes: string;
}

export interface Macrocycle {
  id: string;
  name: string;
  notes: string;
}

export interface Template {
  id: string;
  name: string;
  notes: string;
  position: number;
}

export interface TemplateExercise {
  id: string;
  templateId: string;
  exerciseId: string;
  position: number;
  intention: Intention;
  /** Double progression: number of working sets. */
  targetSets: number;
  /** Null → exercise default. */
  repMin: number | null;
  repMax: number | null;
  /** Progression used in this slot (e.g. a lighter double-progression day of a main lift). Null → exercise default. */
  progressionType: ProgressionType | null;
  /** Top set + backoff overrides. Null → mesocycle week scheme. */
  topSets: number | null;
  backoffSets: number | null;
  backoffPercent: number | null;
  notes: string;
}

export type WorkoutStatus = 'active' | 'completed';

export interface Workout {
  id: string;
  name: string;
  /** Local date YYYY-MM-DD the workout belongs to. */
  date: string;
  templateId: string | null;
  plannedId: string | null;
  mesocycleId: string | null;
  weekIndex: number | null;
  isDeload: boolean;
  /** Snapshot of the latest known bodyweight when the workout started. */
  bodyweight: number | null;
  startedAt: number;
  endedAt: number | null;
  status: WorkoutStatus;
  notes: string;
}

/** An exercise inside a workout. Prescription params are snapshotted so later edits never rewrite history. */
export interface WorkoutExercise {
  id: string;
  workoutId: string;
  exerciseId: string;
  position: number;
  progressionType: ProgressionType;
  intention: Intention;
  repMin: number;
  repMax: number;
  backoffPercent: number;
  templateExerciseId: string | null;
  /**
   * Reference 1RM (total mass) the prescription was built from. Lets later sets be read against
   * what was planned: a set done as prescribed confirms the reference, more raises it, less lowers it.
   */
  referenceE1rm: number | null;
  /**
   * Exercise of the slot this one was done instead of (swap in session: bar taken, machine busy…),
   * snapshotted at the swap. The slot counts as done; each exercise keeps its own progression.
   */
  replacesExerciseId: string | null;
  notes: string;
}

export interface WorkoutSet {
  id: string;
  workoutExerciseId: string;
  position: number;
  setType: SetType;
  /** True when the user forced the type; auto-detection leaves it alone. */
  typeManual: boolean;
  weight: number | null;
  reps: number | null;
  /**
   * Prescription shown as a grey placeholder; validating a set with an empty field accepts it.
   * Backoff targets are recomputed live from the top set; a value typed by the user always wins.
   */
  targetWeight: number | null;
  targetReps: number | null;
  targetRepsMax: number | null;
  barSpeed: BarSpeed | null;
  /** Free note on this very set (« genou gauche », « prise large »…). */
  note: string;
  /** Max-effort test set: its e1RM is taken as the truth and calibrates the reference. */
  isTest: boolean;
  completed: boolean;
  completedAt: number | null;
}

export type BodyMetric =
  | 'bodyweight'
  | 'arm'
  | 'forearm'
  | 'chest'
  | 'waist'
  | 'hips'
  | 'thigh'
  | 'calf'
  | 'neck'
  | 'shoulders';

export interface BodyEntry {
  id: string;
  date: string;
  metric: BodyMetric;
  value: number;
}

export interface PlannedSession {
  id: string;
  date: string;
  templateId: string | null;
  title: string;
  position: number;
  workoutId: string | null;
}

export interface WeekPatternEntry {
  id: string;
  /** 0 = Monday … 6 = Sunday. */
  weekday: number;
  templateId: string;
  position: number;
}
