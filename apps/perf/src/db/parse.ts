/**
 * Runtime guards turning raw SQLite strings into domain unions.
 * The DB is ours, but parsing defensively means a bad value degrades gracefully instead of crashing a screen.
 */
import {
  EQUIPMENTS,
  MUSCLES,
  type BarSpeed,
  type BodyMetric,
  type Equipment,
  type ExerciseCategory,
  type Intention,
  type LoadType,
  type Muscle,
  type ProgressionType,
  type SetType,
  type StrengthWeek,
  type WorkoutStatus,
} from '@/domain/types';

function oneOf<T extends string>(values: readonly T[], fallback: T) {
  return (value: string | null | undefined): T => values.find((v) => v === value) ?? fallback;
}

export const parseProgression = oneOf<ProgressionType>(['top_set_backoff', 'double_progression'], 'double_progression');
export const parseSetType = oneOf<SetType>(['warmup', 'top_set', 'backoff', 'working', 'drop'], 'working');
export const parseIntention = oneOf<Intention>(['power', 'strength', 'hypertrophy'], 'hypertrophy');
export const parseCategory = oneOf<ExerciseCategory>(['main', 'compound', 'isolation'], 'compound');
export const parseLoadType = oneOf<LoadType>(['external', 'bodyweight'], 'external');
export const parseEquipment = oneOf<Equipment>(EQUIPMENTS, 'other');
export const parseStatus = oneOf<WorkoutStatus>(['active', 'completed'], 'completed');
export const BODY_METRICS: readonly BodyMetric[] = [
  'bodyweight',
  'arm',
  'forearm',
  'chest',
  'shoulders',
  'waist',
  'hips',
  'thigh',
  'calf',
  'neck',
];
export const parseBodyMetric = oneOf<BodyMetric>(BODY_METRICS, 'bodyweight');

const BAR_SPEEDS: readonly BarSpeed[] = ['fast', 'normal', 'slow'];
export function parseBarSpeed(value: string | null): BarSpeed | null {
  return BAR_SPEEDS.find((v) => v === value) ?? null;
}

function isMuscle(value: unknown): value is Muscle {
  return typeof value === 'string' && MUSCLES.some((m) => m === value);
}

export function parseMuscles(json: string): Muscle[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter(isMuscle) : [];
  } catch {
    return [];
  }
}

function num(obj: Record<string, unknown>, key: string, fallback: number): number {
  const v = obj[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * One strength week. Schemes saved before the percent-of-1RM model stored `intensity` (fraction of
 * the reference e1RM, then inverse Epley on the top reps): converted to the same top set load,
 * backoffs 10 points under it.
 */
export function parseStrengthWeek(w: Record<string, unknown>): StrengthWeek {
  const topRepsMin = num(w, 'topRepsMin', 5);
  const legacy = num(w, 'intensity', 0.9) / (topRepsMin <= 1 ? 1 : 1 + topRepsMin / 30);
  const topPercent = num(w, 'topPercent', round2(legacy));
  return {
    topSets: num(w, 'topSets', 1),
    topRepsMin,
    topRepsMax: num(w, 'topRepsMax', topRepsMin),
    topPercent,
    backoffSets: num(w, 'backoffSets', 3),
    backoffReps: num(w, 'backoffReps', 6),
    backoffPercent: num(w, 'backoffPercent', round2(topPercent - 0.1)),
  };
}

export function parseScheme(json: string): StrengthWeek[] {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecord).map(parseStrengthWeek);
  } catch {
    return [];
  }
}

/** Deload shape of the main lifts; null / invalid → the default. */
export function parseDeloadWeek(json: string | null, fallback: StrengthWeek): StrengthWeek {
  if (json === null) return { ...fallback };
  try {
    const parsed: unknown = JSON.parse(json);
    return isRecord(parsed) ? parseStrengthWeek(parsed) : { ...fallback };
  } catch {
    return { ...fallback };
  }
}

export const bool = (v: number): boolean => v !== 0;
export const int = (v: boolean): number => (v ? 1 : 0);
