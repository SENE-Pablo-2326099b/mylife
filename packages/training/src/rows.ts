/**
 * Les lignes de la base SQLite de MyPerf (celles que la synchro `perf` transporte, colonnes en snake_case) lues en
 * types du métier. Lecture défensive : une valeur inattendue retombe sur une valeur sûre au lieu de casser un écran.
 * Même lecture que les dépôts de l'app d'avant (apps/perf/src/db), pour que le module lise les mêmes données.
 */
import { DEFAULT_DELOAD } from './mesocycle';
import { parseMesoKind } from './mesoTypes';
import {
  EQUIPMENTS,
  MUSCLES,
  type BarSpeed,
  type Equipment,
  type Exercise,
  type ExerciseCategory,
  type Intention,
  type LoadType,
  type Mesocycle,
  type Muscle,
  type ProgressionType,
  type SetType,
  type StrengthWeek,
  type Template,
  type TemplateExercise,
  type WeekOverride,
  type WeekPatternEntry,
} from './types';

export type Row = Record<string, unknown>;

function oneOf<T extends string>(values: readonly T[], fallback: T) {
  return (value: unknown): T => values.find((v) => v === value) ?? fallback;
}

export const parseProgression = oneOf<ProgressionType>(['top_set_backoff', 'double_progression'], 'double_progression');
export const parseSetType = oneOf<SetType>(['warmup', 'top_set', 'backoff', 'working', 'drop'], 'working');
export const parseIntention = oneOf<Intention>(['power', 'strength', 'hypertrophy'], 'hypertrophy');
export const parseCategory = oneOf<ExerciseCategory>(['main', 'compound', 'isolation'], 'compound');
export const parseLoadType = oneOf<LoadType>(['external', 'bodyweight'], 'external');
export const parseEquipment = oneOf<Equipment>(EQUIPMENTS, 'other');

const BAR_SPEEDS: readonly BarSpeed[] = ['fast', 'normal', 'slow'];
export function parseBarSpeed(value: unknown): BarSpeed | null {
  return BAR_SPEEDS.find((v) => v === value) ?? null;
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);
export const bool = (v: unknown): boolean => v !== 0 && v !== null && v !== undefined && v !== false && v !== '0';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isMuscle = (v: unknown): v is Muscle => typeof v === 'string' && MUSCLES.some((m) => m === v);

function parseJson(v: unknown): unknown {
  if (typeof v !== 'string') return null;
  try {
    return JSON.parse(v) as unknown;
  } catch {
    return null;
  }
}

export function parseMuscles(json: unknown): Muscle[] {
  const parsed = parseJson(json);
  return Array.isArray(parsed) ? parsed.filter(isMuscle) : [];
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Une semaine de force ; les anciens schémas (champ `intensity`) sont convertis comme dans l'app d'avant. */
export function parseStrengthWeek(w: Record<string, unknown>): StrengthWeek {
  const topRepsMin = num(w.topRepsMin, 5);
  const legacy = num(w.intensity, 0.9) / (topRepsMin <= 1 ? 1 : 1 + topRepsMin / 30);
  const topPercent = num(w.topPercent, round2(legacy));
  return {
    topSets: num(w.topSets, 1),
    topRepsMin,
    topRepsMax: num(w.topRepsMax, topRepsMin),
    topPercent,
    backoffSets: num(w.backoffSets, 3),
    backoffReps: num(w.backoffReps, 6),
    backoffPercent: num(w.backoffPercent, round2(topPercent - 0.1)),
  };
}

export function parseScheme(json: unknown): StrengthWeek[] {
  const parsed = parseJson(json);
  return Array.isArray(parsed) ? parsed.filter(isRecord).map(parseStrengthWeek) : [];
}

function parseDeloadWeek(json: unknown, fallback: StrengthWeek): StrengthWeek {
  const parsed = parseJson(json);
  return isRecord(parsed) ? parseStrengthWeek(parsed) : { ...fallback };
}

export function toExercise(r: Row): Exercise {
  return {
    id: str(r.id),
    name: str(r.name),
    primaryMuscles: parseMuscles(r.primary_muscles),
    secondaryMuscles: parseMuscles(r.secondary_muscles),
    equipment: parseEquipment(r.equipment),
    unilateral: bool(r.unilateral),
    loadType: parseLoadType(r.load_type),
    category: parseCategory(r.category),
    progressionType: parseProgression(r.progression_type),
    backoffPercent: num(r.backoff_percent, 0.8),
    repRangeMin: num(r.rep_range_min, 8),
    repRangeMax: num(r.rep_range_max, 12),
    weightIncrement: numOrNull(r.weight_increment),
    isCustom: bool(r.is_custom),
    archived: bool(r.archived),
    notes: str(r.notes),
  };
}

export function toMesocycle(r: Row): Mesocycle {
  return {
    id: str(r.id),
    name: str(r.name),
    kind: parseMesoKind(str(r.kind)),
    macrocycleId: strOrNull(r.macrocycle_id),
    startDate: str(r.start_date),
    workWeeks: num(r.work_weeks, 4),
    deloadWeeks: num(r.deload_weeks, 1),
    scheme: parseScheme(r.scheme),
    deload: {
      main: r.deload_main === null || r.deload_main === undefined ? { ...DEFAULT_DELOAD.main } : parseDeloadWeek(r.deload_main, DEFAULT_DELOAD.main),
      loadFactor: num(r.deload_load_factor, DEFAULT_DELOAD.loadFactor),
      volumeFactor: num(r.deload_volume_factor, DEFAULT_DELOAD.volumeFactor),
    },
    notes: str(r.notes),
  };
}

/** Les mésocycles du plus ancien au plus récent (même ordre que l'app d'avant : début, puis création). */
export function sortMesocycles(rows: readonly Row[]): Mesocycle[] {
  return [...rows]
    .sort((a, b) => str(a.start_date).localeCompare(str(b.start_date)) || num(a.created_at, 0) - num(b.created_at, 0))
    .map(toMesocycle);
}

export function toTemplate(r: Row): Template & { archived: boolean } {
  return { id: str(r.id), name: str(r.name), notes: str(r.notes), position: num(r.position, 0), archived: bool(r.archived) };
}

export function toTemplateExercise(r: Row): TemplateExercise {
  return {
    id: str(r.id),
    templateId: str(r.template_id),
    exerciseId: str(r.exercise_id),
    position: num(r.position, 0),
    intention: parseIntention(r.intention),
    targetSets: num(r.target_sets, 3),
    progressionType: r.progression_type === null || r.progression_type === undefined ? null : parseProgression(r.progression_type),
    repMin: numOrNull(r.rep_min),
    repMax: numOrNull(r.rep_max),
    topSets: numOrNull(r.top_sets),
    backoffSets: numOrNull(r.backoff_sets),
    backoffPercent: numOrNull(r.backoff_percent),
    notes: str(r.notes),
  };
}

/** Réglage d'une semaine pour un exercice d'un mésocycle (colonne `intensity` = % du top set). */
export interface WeekOverrideRow extends WeekOverride {
  mesocycleId: string;
  exerciseId: string;
}

export function toWeekOverride(r: Row): WeekOverrideRow {
  return {
    mesocycleId: str(r.mesocycle_id),
    exerciseId: str(r.exercise_id),
    weekIndex: num(r.week_index, 1),
    topSets: numOrNull(r.top_sets),
    topRepsMin: numOrNull(r.top_reps_min),
    topRepsMax: numOrNull(r.top_reps_max),
    backoffSets: numOrNull(r.backoff_sets),
    backoffReps: numOrNull(r.backoff_reps),
    backoffPercent: numOrNull(r.backoff_percent),
    topPercent: numOrNull(r.intensity),
  };
}

export function toWeekPattern(r: Row): WeekPatternEntry {
  return { id: str(r.id), weekday: num(r.weekday, 0), templateId: str(r.template_id), position: num(r.position, 0) };
}

/** Le 1RM saisi par l'utilisateur, tel que noté (lest pour un lesté). */
export interface TypedOneRm {
  exerciseId: string;
  value: number;
  mode: 'manual' | 'estimated';
  setOn: string;
}

export function toOneRm(r: Row): TypedOneRm {
  return { exerciseId: str(r.exercise_id), value: num(r.value, 0), mode: r.mode === 'estimated' ? 'estimated' : 'manual', setOn: str(r.set_on) };
}

/** L'incrément de charge des réglages de l'app (clé `app` de la table settings, en JSON). */
export function incrementFromSettings(rows: readonly Row[]): number {
  const app = rows.find((r) => r.key === 'app');
  const parsed = parseJson(app?.value);
  return isRecord(parsed) ? num(parsed.increment, 2.5) : 2.5;
}
