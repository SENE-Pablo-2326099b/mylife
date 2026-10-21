import type {
  BarSpeed,
  BodyMetric,
  Equipment,
  ExerciseCategory,
  Intention,
  LoadType,
  Muscle,
  ProgressionType,
  SetType,
} from '@/domain/types';
import type { MesoKind } from '@/domain/mesoTypes';

import type { Palette } from './theme';

export const MUSCLE_LABEL: Record<Muscle, string> = {
  chest: 'Pectoraux',
  back: 'Dos',
  lats: 'Grand dorsal',
  traps: 'Trapèzes',
  shoulders: 'Épaules',
  rear_delts: 'Arrière d’épaule',
  biceps: 'Biceps',
  triceps: 'Triceps',
  forearms: 'Avant-bras',
  abs: 'Abdos',
  lower_back: 'Lombaires',
  glutes: 'Fessiers',
  quads: 'Quadriceps',
  hamstrings: 'Ischios',
  adductors: 'Adducteurs',
  calves: 'Mollets',
};

export const EQUIPMENT_LABEL: Record<Equipment, string> = {
  barbell: 'Barre',
  dumbbell: 'Haltères',
  machine: 'Machine',
  cable: 'Poulie',
  bodyweight: 'Poids du corps',
  kettlebell: 'Kettlebell',
  band: 'Élastique',
  other: 'Autre',
};

export const SET_TYPE_SHORT: Record<SetType, string> = {
  warmup: 'É',
  top_set: 'T',
  backoff: 'B',
  working: '',
  drop: 'D',
};

export const SET_TYPE_LABEL: Record<SetType, string> = {
  warmup: 'Échauffement',
  top_set: 'Top set',
  backoff: 'Backoff',
  working: 'Série',
  drop: 'Drop set',
};

export const SPEED_LABEL: Record<BarSpeed, string> = { fast: 'Rapide', normal: 'Normal', slow: 'Lent' };

export const PROGRESSION_LABEL: Record<ProgressionType, string> = {
  top_set_backoff: 'Top set + backoff',
  double_progression: 'Double progression',
};

export const INTENTION_LABEL: Record<Intention, string> = {
  power: 'Puissance',
  strength: 'Force',
  hypertrophy: 'Hypertrophie',
};

export const CATEGORY_LABEL: Record<ExerciseCategory, string> = {
  main: 'Principal',
  compound: 'Polyarticulaire',
  isolation: 'Isolation',
};

export const LOAD_TYPE_LABEL: Record<LoadType, string> = {
  external: 'Charge externe',
  bodyweight: 'Lest (poids du corps +)',
};

export const BODY_METRIC_LABEL: Record<BodyMetric, string> = {
  bodyweight: 'Poids de corps',
  arm: 'Bras',
  forearm: 'Avant-bras',
  chest: 'Poitrine',
  shoulders: 'Épaules',
  waist: 'Taille',
  hips: 'Hanches',
  thigh: 'Cuisse',
  calf: 'Mollet',
  neck: 'Cou',
};

export const BODY_METRIC_UNIT: Record<BodyMetric, string> = {
  bodyweight: 'kg',
  arm: 'cm',
  forearm: 'cm',
  chest: 'cm',
  shoulders: 'cm',
  waist: 'cm',
  hips: 'cm',
  thigh: 'cm',
  calf: 'cm',
  neck: 'cm',
};

/** "Mardi — Poussée + triceps" → { day: "Mardi", focus: "Poussée + triceps" }. */
export function splitTemplateName(name: string): { day: string; focus: string } {
  const [day, ...rest] = name.split(' — ');
  return rest.length === 0 ? { day: '', focus: name } : { day: day ?? '', focus: rest.join(' — ') };
}

/** One colour per block type, used by the cycle editor, the planning list and Today. */
export const MESO_KIND_COLOR: Record<MesoKind, (t: Palette) => string> = {
  accumulation: (t) => t.accent,
  transmutation: (t) => t.gold,
  realization: (t) => t.danger,
  transition: (t) => t.info,
  custom: (t) => t.textSecondary,
};
