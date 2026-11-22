/**
 * Le modèle composable d'un programme (docs/V5-MYPERF-TRAINING.md) : chaque créneau d'une séance combine un exercice,
 * un format (ce qu'on note et le minuteur), une progression (ce qu'on prescrit ensuite) ; la structure dit quand.
 * Rien ici ne connaît une méthode d'entraînement : la sienne est un modèle parmi d'autres (presets.ts).
 */
import type { CyclePhase } from './mesocycle';
import type { DeloadConfig, Exercise, Intention, Mesocycle, StrengthWeek, WeekOverride, WeekPatternEntry } from './types';
import type { WeekOverrideRow } from './rows';

// ---------------------------------------------------------------- grandeurs suivies

export type MetricId = 'load' | 'reps' | 'time' | 'distance' | 'rounds' | 'rpe' | 'rir' | 'speed';

export interface MetricSpec {
  id: MetricId;
  label: string;
  unit: string;
  /** Sens du progrès ; `none` pour ce qui n'est qu'un repère. */
  better: 'more' | 'less' | 'none';
  /** Entre-t-elle dans un calcul de prescription ? La vitesse de barre, jamais. */
  inCalculations: boolean;
}

export const METRICS: Record<MetricId, MetricSpec> = {
  load: { id: 'load', label: 'Charge', unit: 'kg', better: 'more', inCalculations: true },
  reps: { id: 'reps', label: 'Reps', unit: 'reps', better: 'more', inCalculations: true },
  time: { id: 'time', label: 'Temps', unit: 's', better: 'more', inCalculations: true },
  distance: { id: 'distance', label: 'Distance', unit: 'm', better: 'more', inCalculations: true },
  rounds: { id: 'rounds', label: 'Tours', unit: 'tours', better: 'more', inCalculations: true },
  rpe: { id: 'rpe', label: 'RPE', unit: '/10', better: 'none', inCalculations: true },
  rir: { id: 'rir', label: 'RIR', unit: 'reps', better: 'none', inCalculations: true },
  speed: { id: 'speed', label: 'Vitesse', unit: '/5', better: 'none', inCalculations: false },
};

/** Vitesse de barre : les trois niveaux d'avant deviennent 1, 3 et 5 sur l'échelle de 1 à 5. */
export function speedFromLegacy(v: 'slow' | 'normal' | 'fast' | null): 1 | 3 | 5 | null {
  return v === 'slow' ? 1 : v === 'normal' ? 3 : v === 'fast' ? 5 : null;
}

// ---------------------------------------------------------------- formats

export type TimerSpec =
  | { kind: 'rest'; after: 'set' }
  | { kind: 'interval'; everySec: number; totalSec: number }
  | { kind: 'countdown'; workSec: number }
  | { kind: 'cap'; capSec: number }
  | { kind: 'stopwatch' };

export interface Format {
  id: string;
  name: string;
  /** Ce qu'on note à chaque série. */
  metrics: MetricId[];
  scheme: 'sets' | 'interval' | 'amrap' | 'hold' | 'for_time';
  timer: TimerSpec;
}

/** Les formats livrés : des exemples, l'utilisateur crée les siens (mêmes données). */
export const BUILTIN_FORMATS: readonly Format[] = [
  { id: 'sets', name: 'Séries', metrics: ['load', 'reps'], scheme: 'sets', timer: { kind: 'rest', after: 'set' } },
  { id: 'emom', name: 'EMOM', metrics: ['reps'], scheme: 'interval', timer: { kind: 'interval', everySec: 60, totalSec: 600 } },
  { id: 'amrap', name: 'AMRAP', metrics: ['rounds', 'reps'], scheme: 'amrap', timer: { kind: 'cap', capSec: 480 } },
  { id: 'hold', name: 'Au temps', metrics: ['time'], scheme: 'hold', timer: { kind: 'countdown', workSec: 45 } },
  { id: 'for_time', name: 'Pour le temps', metrics: ['time'], scheme: 'for_time', timer: { kind: 'stopwatch' } },
];

const METRIC_IDS = Object.keys(METRICS) as MetricId[];

/** Les fautes d'un format défini par l'utilisateur (vide : il est valide). */
export function formatErrors(f: Format): string[] {
  const errors: string[] = [];
  if (!f.id.trim() || f.id.length > 40) errors.push('identifiant');
  if (!f.name.trim() || f.name.length > 60) errors.push('nom');
  if (f.metrics.length === 0 || f.metrics.length > 6 || f.metrics.some((m) => !METRIC_IDS.includes(m))) errors.push('grandeurs');
  const t = f.timer;
  const sec = (v: number) => Number.isInteger(v) && v > 0 && v <= 4 * 3600;
  if (t.kind === 'interval' && !(sec(t.everySec) && sec(t.totalSec) && t.totalSec >= t.everySec)) errors.push('minuteur');
  if (t.kind === 'countdown' && !sec(t.workSec)) errors.push('minuteur');
  if (t.kind === 'cap' && !sec(t.capSec)) errors.push('minuteur');
  return errors;
}

// ---------------------------------------------------------------- programme

export type StrategyId = 'percent_reference' | 'double_progression' | 'linear' | 'free' | 'autoregulated';

export interface StrategyRef {
  id: StrategyId;
  params: Record<string, unknown>;
}

export interface Slot {
  id: string;
  exerciseId: string;
  formatId: string;
  strategy: StrategyRef;
  /** Superset (alternés) ou circuit : le repos tombe à la fin du groupe. */
  group: { id: string; kind: 'superset' | 'circuit'; rounds: number } | null;
  intention: Intention | null;
  /** Repos voulu (s) ; null : le plancher de la catégorie de l'exercice. */
  restSec: number | null;
  notes: string;
}

export interface SessionTemplate {
  id: string;
  name: string;
  slots: Slot[];
}

/** Semaine type (lundi = 0) : partagée par toutes les structures. */
export type Pattern = readonly WeekPatternEntry[];

export type Structure =
  | { kind: 'routine'; pattern: Pattern }
  | { kind: 'cycle'; name: string; startDate: string; weeks: number; repeat: boolean; pattern: Pattern }
  | { kind: 'periodized'; blocks: readonly Mesocycle[]; overrides: readonly WeekOverrideRow[]; pattern: Pattern };

export interface ReferencePolicy {
  /** Seules les séries de ce nombre de reps au plus servent à estimer le 1RM. */
  reliableMaxReps: number;
  /** Hausse maximale proposée par cycle après une S4 ou un test (fraction). */
  maxCycleGain: number;
}

export interface Program {
  structure: Structure;
  sessions: readonly SessionTemplate[];
  exercises: readonly Exercise[];
  formats: readonly Format[];
  /** Incrément de charge par défaut (une salle, ses disques). */
  increment: number;
  reference: ReferencePolicy;
}

// ---------------------------------------------------------------- contexte du jour

export interface DayContext {
  date: string;
  /** Null pour une routine, ou hors d'un bloc. */
  block: { id: string; name: string; kind: string; index: number; total: number } | null;
  week: { index: number; of: number; deload: boolean } | null;
  /** Ce que les progressions lisent sans savoir d'où ça vient. */
  modifiers: {
    phase: CyclePhase | null;
    scheme: readonly StrengthWeek[] | null;
    deload: DeloadConfig | null;
    overrides: (exerciseId: string) => Map<number, WeekOverride>;
  };
}
