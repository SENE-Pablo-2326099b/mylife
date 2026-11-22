/**
 * Les progressions : une seule interface, plusieurs stratégies. Chacune déclare ses réglages (l'éditeur se construit
 * dessus) et ce dont elle a besoin (`requires`) ; le moteur ne connaît que l'interface. « Au % du 1RM » et la double
 * progression reprennent le calcul éprouvé de l'app d'avant (prescription.ts), à l'identique.
 */
import type { Capability } from './capabilities';
import { DEFAULT_DELOAD, DEFAULT_SCHEME_4 } from './mesocycle';
import { roundToIncrement, weightForReps, estimate1RM } from './math';
import type { DayContext, MetricId, StrategyId } from './model';
import { prescribe, type HistorySet, type PlannedSet, type Prescription } from './prescription';
import type { Exercise, ProgressionType, StrengthWeek } from './types';

export interface PlanContext {
  exercise: Exercise;
  day: DayContext;
  /** Incrément de l'exercice, sinon celui du programme. */
  increment: number;
  /** Poids du corps de la séance, pour un lesté (null sinon). */
  bodyweight: number | null;
  /** Séries faites la dernière fois (hors échauffement), dans l'ordre. */
  lastSets: readonly HistorySet[];
  /** 1RM de référence, masse totale pour un lesté ; seulement si la stratégie en a besoin. */
  reference: number | null;
}

export type ParamKind = 'int' | 'number' | 'percent' | 'boolean' | 'metric';

export interface ParamSpec {
  key: string;
  label: string;
  kind: ParamKind;
  /** Valeur par défaut ; null : celle de l'exercice ou du bloc. */
  fallback: number | boolean | string | null;
  min?: number;
  max?: number;
  /** Réglage avancé : replié dans l'éditeur. */
  advanced?: boolean;
}

export interface ProgressionStrategy {
  id: StrategyId;
  label: string;
  detail: string;
  params: readonly ParamSpec[];
  requires: readonly Capability[];
  /** La grandeur qui progresse. */
  metric: (params: Record<string, unknown>) => MetricId;
  /** Clé de « la dernière fois » : une séance faite avec la même logique l'emporte (comme l'app d'avant). */
  historyKey: ProgressionType;
  prescribe(ctx: PlanContext, params: Record<string, unknown>): Prescription;
}

const n = (v: unknown, fallback: number | null): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const int = (v: unknown, fallback: number) => Math.max(1, Math.round(n(v, fallback) ?? fallback));
const metricOf = (v: unknown, fallback: MetricId): MetricId => (v === 'load' || v === 'reps' || v === 'time' ? v : fallback);

const percentReference: ProgressionStrategy = {
  id: 'percent_reference',
  label: 'Au % du 1RM',
  detail: 'top set et backoffs, % donnés par le bloc',
  params: [
    { key: 'topSets', label: 'Top sets', kind: 'int', fallback: null, min: 0, max: 5 },
    { key: 'backoffSets', label: 'Backoffs', kind: 'int', fallback: null, min: 0, max: 8 },
    { key: 'backoffPercent', label: 'Backoffs sans 1RM (ratio du top set)', kind: 'percent', fallback: null, advanced: true },
  ],
  requires: ['reference', 'percentages'],
  metric: () => 'load',
  historyKey: 'top_set_backoff',
  prescribe(ctx, params) {
    const m = ctx.day.modifiers;
    // Hors de tout bloc : la semaine fixe du créneau si elle existe, sinon la 1re semaine du schéma par défaut.
    const fixed = params.fixedWeek as StrengthWeek | undefined;
    const scheme = m.scheme ?? (fixed ? [fixed] : DEFAULT_SCHEME_4);
    return prescribe({
      progressionType: 'top_set_backoff',
      repMin: ctx.exercise.repRangeMin,
      repMax: ctx.exercise.repRangeMax,
      targetSets: 3,
      topSetsOverride: n(params.topSets, null),
      backoffSetsOverride: n(params.backoffSets, null),
      backoffPercent: n(params.backoffPercent, null) ?? ctx.exercise.backoffPercent,
      increment: ctx.increment,
      bodyweight: ctx.bodyweight,
      phase: m.phase,
      scheme,
      deload: m.deload ?? DEFAULT_DELOAD,
      lastSets: ctx.lastSets,
      referenceE1rm: ctx.reference,
      weekOverrides: m.overrides(ctx.exercise.id),
    });
  },
};

const doubleProgression: ProgressionStrategy = {
  id: 'double_progression',
  label: 'Double progression',
  detail: 'fourchette de reps, puis la charge',
  params: [
    { key: 'sets', label: 'Séries', kind: 'int', fallback: 3, min: 1, max: 10 },
    { key: 'repMin', label: 'Reps min', kind: 'int', fallback: null, min: 1, max: 50 },
    { key: 'repMax', label: 'Reps max', kind: 'int', fallback: null, min: 1, max: 50 },
  ],
  requires: [],
  metric: () => 'load',
  historyKey: 'double_progression',
  prescribe(ctx, params) {
    const m = ctx.day.modifiers;
    return prescribe({
      progressionType: 'double_progression',
      repMin: n(params.repMin, null) ?? ctx.exercise.repRangeMin,
      repMax: n(params.repMax, null) ?? ctx.exercise.repRangeMax,
      targetSets: int(params.sets, 3),
      topSetsOverride: null,
      backoffSetsOverride: null,
      backoffPercent: ctx.exercise.backoffPercent,
      increment: ctx.increment,
      bodyweight: ctx.bodyweight,
      phase: m.phase,
      scheme: m.scheme ?? DEFAULT_SCHEME_4,
      deload: m.deload ?? DEFAULT_DELOAD,
      lastSets: ctx.lastSets,
      referenceE1rm: null,
    });
  },
};

const working = (sets: readonly HistorySet[]) => sets.filter((s) => s.setType !== 'warmup' && s.setType !== 'drop');

const linear: ProgressionStrategy = {
  id: 'linear',
  label: 'Linéaire',
  detail: '+ x à chaque séance réussie',
  params: [
    { key: 'sets', label: 'Séries', kind: 'int', fallback: 5, min: 1, max: 10 },
    { key: 'reps', label: 'Reps', kind: 'int', fallback: 5, min: 1, max: 50 },
    { key: 'step', label: 'Hausse (kg)', kind: 'number', fallback: null },
    { key: 'metric', label: 'Ce qui progresse', kind: 'metric', fallback: 'load', advanced: true },
  ],
  requires: [],
  metric: (p) => metricOf(p.metric, 'load'),
  historyKey: 'double_progression',
  prescribe(ctx, params) {
    const sets = int(params.sets, 5);
    const reps = int(params.reps, 5);
    const done = working(ctx.lastSets);
    const last = done.length ? Math.max(...done.map((s) => s.weight)) : null;
    const success = done.length >= sets && done.every((s) => s.reps >= reps);
    const step = n(params.step, null) ?? ctx.increment;
    const weight = last === null ? null : success ? roundToIncrement(last + step, ctx.increment) : last;
    const planned: PlannedSet[] = Array.from({ length: sets }, () => ({ setType: 'working', targetWeight: weight, targetReps: reps, targetRepsMax: null }));
    const hint = last !== null && weight !== null && weight > last ? { kind: 'increase' as const, from: last, to: weight } : null;
    return { sets: planned, label: `${sets}×${reps}`, hint, backoffPercent: ctx.exercise.backoffPercent, percents: null };
  },
};

const free: ProgressionStrategy = {
  id: 'free',
  label: 'Libre',
  detail: 'dernière fois affichée',
  params: [{ key: 'sets', label: 'Séries', kind: 'int', fallback: 3, min: 1, max: 10 }],
  requires: [],
  metric: () => 'reps',
  historyKey: 'double_progression',
  prescribe(ctx, params) {
    const done = working(ctx.lastSets);
    const count = done.length || int(params.sets, 3);
    const planned: PlannedSet[] = Array.from({ length: count }, (_, i) => ({
      setType: 'working',
      targetWeight: done[i]?.weight ?? null,
      targetReps: done[i]?.reps ?? null,
      targetRepsMax: null,
    }));
    return { sets: planned, label: `${count} séries`, hint: null, backoffPercent: ctx.exercise.backoffPercent, percents: null };
  },
};

const autoregulated: ProgressionStrategy = {
  id: 'autoregulated',
  label: 'RPE ou RIR',
  detail: 'facultatif : reps cibles à un effort donné',
  params: [
    { key: 'sets', label: 'Séries', kind: 'int', fallback: 3, min: 1, max: 10 },
    { key: 'reps', label: 'Reps', kind: 'int', fallback: 8, min: 1, max: 30 },
    { key: 'rir', label: 'Reps en réserve', kind: 'int', fallback: 2, min: 0, max: 5 },
  ],
  requires: ['rir'],
  metric: () => 'load',
  historyKey: 'double_progression',
  prescribe(ctx, params) {
    const sets = int(params.sets, 3);
    const reps = int(params.reps, 8);
    const rir = Math.max(0, Math.round(n(params.rir, 2) ?? 2));
    // Charge suggérée : la meilleure série d'avant ramenée à ces reps plus les reps en réserve (Epley).
    const done = working(ctx.lastSets);
    const best = done.length ? Math.max(...done.map((s) => estimate1RM(s.weight, s.reps, ctx.bodyweight))) : null;
    const weight = best === null ? null : roundToIncrement(weightForReps(best, reps + rir, ctx.bodyweight), ctx.increment);
    const planned: PlannedSet[] = Array.from({ length: sets }, () => ({ setType: 'working', targetWeight: weight, targetReps: reps, targetRepsMax: null }));
    return { sets: planned, label: `${sets}×${reps} · RIR ${rir}`, hint: null, backoffPercent: ctx.exercise.backoffPercent, percents: null };
  },
};

export const STRATEGIES: Record<StrategyId, ProgressionStrategy> = {
  percent_reference: percentReference,
  double_progression: doubleProgression,
  linear,
  free,
  autoregulated,
};

export const strategyOf = (id: StrategyId): ProgressionStrategy => STRATEGIES[id] ?? doubleProgression;
