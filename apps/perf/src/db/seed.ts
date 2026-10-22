import type { Equipment, ExerciseCategory, LoadType, Muscle, ProgressionType } from '@/domain/types';

import { db } from './db';
import { createExercise, exerciseCount } from './repos/exercises';

interface Seed {
  id: string;
  name: string;
  p: Muscle[];
  s?: Muscle[];
  eq: Equipment;
  cat: ExerciseCategory;
  prog?: ProgressionType;
  load?: LoadType;
  uni?: boolean;
  reps?: [number, number];
  inc?: number;
}

/**
 * Default library: street lifting main lifts (weighted pull-up, dip, muscle-up, squat) plus
 * classic gym movements. Stable ids so future migrations can refer to them.
 */
const SEEDS: readonly Seed[] = [
  // Main lifts — top set + backoff
  { id: 'ex_weighted_pullup', name: 'Traction lestée', p: ['lats', 'back'], s: ['biceps', 'forearms', 'rear_delts'], eq: 'bodyweight', cat: 'main', prog: 'top_set_backoff', load: 'bodyweight', reps: [2, 6] },
  { id: 'ex_weighted_dip', name: 'Dips lestés', p: ['chest', 'triceps'], s: ['shoulders'], eq: 'bodyweight', cat: 'main', prog: 'top_set_backoff', load: 'bodyweight', reps: [2, 6] },
  { id: 'ex_weighted_muscleup', name: 'Muscle-up lesté', p: ['lats', 'back'], s: ['triceps', 'chest', 'biceps'], eq: 'bodyweight', cat: 'main', prog: 'top_set_backoff', load: 'bodyweight', reps: [1, 5] },
  { id: 'ex_squat', name: 'Squat', p: ['quads', 'glutes'], s: ['adductors', 'lower_back'], eq: 'barbell', cat: 'main', prog: 'top_set_backoff', reps: [2, 6] },
  { id: 'ex_bench', name: 'Développé couché', p: ['chest'], s: ['triceps', 'shoulders'], eq: 'barbell', cat: 'main', prog: 'top_set_backoff', reps: [2, 6] },
  { id: 'ex_deadlift', name: 'Soulevé de terre', p: ['hamstrings', 'glutes', 'lower_back'], s: ['back', 'traps', 'forearms'], eq: 'barbell', cat: 'main', prog: 'top_set_backoff', reps: [1, 5] },
  { id: 'ex_ohp', name: 'Développé militaire', p: ['shoulders'], s: ['triceps'], eq: 'barbell', cat: 'main', prog: 'top_set_backoff', reps: [3, 6] },
  { id: 'ex_weighted_chinup', name: 'Traction supination lestée', p: ['lats', 'biceps'], s: ['back'], eq: 'bodyweight', cat: 'main', prog: 'top_set_backoff', load: 'bodyweight', reps: [3, 6] },

  // Compounds — double progression
  { id: 'ex_pullup', name: 'Tractions', p: ['lats', 'back'], s: ['biceps'], eq: 'bodyweight', cat: 'compound', load: 'bodyweight', reps: [6, 12] },
  { id: 'ex_dip', name: 'Dips', p: ['chest', 'triceps'], s: ['shoulders'], eq: 'bodyweight', cat: 'compound', load: 'bodyweight', reps: [8, 15] },
  { id: 'ex_pushup', name: 'Pompes', p: ['chest'], s: ['triceps', 'shoulders'], eq: 'bodyweight', cat: 'compound', load: 'bodyweight', reps: [10, 25] },
  { id: 'ex_front_squat', name: 'Front squat', p: ['quads'], s: ['glutes', 'abs'], eq: 'barbell', cat: 'compound', reps: [4, 8] },
  { id: 'ex_rdl', name: 'Soulevé de terre roumain', p: ['hamstrings', 'glutes'], s: ['lower_back'], eq: 'barbell', cat: 'compound', reps: [6, 10] },
  { id: 'ex_barbell_row', name: 'Rowing barre', p: ['back', 'lats'], s: ['biceps', 'rear_delts'], eq: 'barbell', cat: 'compound', reps: [6, 10] },
  { id: 'ex_db_row', name: 'Rowing haltère', p: ['back', 'lats'], s: ['biceps'], eq: 'dumbbell', cat: 'compound', uni: true, reps: [8, 12], inc: 2 },
  { id: 'ex_incline_db_press', name: 'Développé incliné haltères', p: ['chest'], s: ['shoulders', 'triceps'], eq: 'dumbbell', cat: 'compound', reps: [6, 10], inc: 2 },
  { id: 'ex_incline_bench', name: 'Développé incliné barre', p: ['chest'], s: ['shoulders', 'triceps'], eq: 'barbell', cat: 'compound', reps: [5, 8] },
  { id: 'ex_db_press', name: 'Développé haltères', p: ['chest'], s: ['triceps', 'shoulders'], eq: 'dumbbell', cat: 'compound', reps: [6, 10], inc: 2 },
  { id: 'ex_db_ohp', name: 'Développé épaules haltères', p: ['shoulders'], s: ['triceps'], eq: 'dumbbell', cat: 'compound', reps: [6, 10], inc: 2 },
  { id: 'ex_lat_pulldown', name: 'Tirage vertical', p: ['lats'], s: ['biceps', 'back'], eq: 'cable', cat: 'compound', reps: [8, 12] },
  { id: 'ex_cable_row', name: 'Tirage horizontal', p: ['back', 'lats'], s: ['biceps', 'rear_delts'], eq: 'cable', cat: 'compound', reps: [8, 12] },
  { id: 'ex_leg_press', name: 'Presse à cuisses', p: ['quads', 'glutes'], eq: 'machine', cat: 'compound', reps: [8, 15], inc: 5 },
  { id: 'ex_hack_squat', name: 'Hack squat', p: ['quads'], s: ['glutes'], eq: 'machine', cat: 'compound', reps: [6, 12], inc: 5 },
  { id: 'ex_bulgarian', name: 'Fentes bulgares', p: ['quads', 'glutes'], s: ['adductors'], eq: 'dumbbell', cat: 'compound', uni: true, reps: [6, 12], inc: 2 },
  { id: 'ex_hip_thrust', name: 'Hip thrust', p: ['glutes'], s: ['hamstrings'], eq: 'barbell', cat: 'compound', reps: [6, 12] },
  { id: 'ex_inverted_row', name: 'Rowing inversé', p: ['back'], s: ['biceps', 'rear_delts'], eq: 'bodyweight', cat: 'compound', load: 'bodyweight', reps: [8, 15] },

  // Isolation — double progression
  { id: 'ex_barbell_curl', name: 'Curl barre', p: ['biceps'], s: ['forearms'], eq: 'barbell', cat: 'isolation', reps: [8, 12], inc: 1.25 },
  { id: 'ex_db_curl', name: 'Curl haltères', p: ['biceps'], s: ['forearms'], eq: 'dumbbell', cat: 'isolation', reps: [8, 12], inc: 1 },
  { id: 'ex_hammer_curl', name: 'Curl marteau', p: ['biceps', 'forearms'], eq: 'dumbbell', cat: 'isolation', reps: [8, 12], inc: 1 },
  { id: 'ex_preacher_curl', name: 'Curl pupitre', p: ['biceps'], eq: 'machine', cat: 'isolation', reps: [8, 12] },
  { id: 'ex_triceps_pushdown', name: 'Extension triceps poulie', p: ['triceps'], eq: 'cable', cat: 'isolation', reps: [10, 15] },
  { id: 'ex_skullcrusher', name: 'Barre au front', p: ['triceps'], eq: 'barbell', cat: 'isolation', reps: [8, 12], inc: 1.25 },
  { id: 'ex_overhead_ext', name: 'Extension triceps nuque', p: ['triceps'], eq: 'cable', cat: 'isolation', reps: [10, 15] },
  { id: 'ex_lateral_raise', name: 'Élévations latérales', p: ['shoulders'], eq: 'dumbbell', cat: 'isolation', reps: [12, 20], inc: 1 },
  { id: 'ex_cable_lateral', name: 'Élévation latérale poulie', p: ['shoulders'], eq: 'cable', cat: 'isolation', uni: true, reps: [12, 20], inc: 1.25 },
  { id: 'ex_face_pull', name: 'Face pull', p: ['rear_delts'], s: ['traps'], eq: 'cable', cat: 'isolation', reps: [12, 20] },
  { id: 'ex_reverse_fly', name: 'Oiseau', p: ['rear_delts'], eq: 'dumbbell', cat: 'isolation', reps: [12, 20], inc: 1 },
  { id: 'ex_cable_fly', name: 'Écarté poulie', p: ['chest'], eq: 'cable', cat: 'isolation', reps: [10, 15] },
  { id: 'ex_leg_extension', name: 'Leg extension', p: ['quads'], eq: 'machine', cat: 'isolation', reps: [10, 15] },
  { id: 'ex_leg_curl', name: 'Leg curl', p: ['hamstrings'], eq: 'machine', cat: 'isolation', reps: [10, 15] },
  { id: 'ex_standing_calf', name: 'Mollets debout', p: ['calves'], eq: 'machine', cat: 'isolation', reps: [10, 15], inc: 5 },
  { id: 'ex_seated_calf', name: 'Mollets assis', p: ['calves'], eq: 'machine', cat: 'isolation', reps: [12, 20] },
  { id: 'ex_shrug', name: 'Shrugs', p: ['traps'], s: ['forearms'], eq: 'dumbbell', cat: 'isolation', reps: [10, 15], inc: 2 },
  { id: 'ex_cable_crunch', name: 'Crunch poulie', p: ['abs'], eq: 'cable', cat: 'isolation', reps: [10, 20] },
  { id: 'ex_hanging_leg_raise', name: 'Relevés de jambes suspendu', p: ['abs'], eq: 'bodyweight', cat: 'isolation', load: 'bodyweight', reps: [8, 15], inc: 1 },
  { id: 'ex_wrist_curl', name: 'Curl poignets', p: ['forearms'], eq: 'barbell', cat: 'isolation', reps: [12, 20], inc: 1.25 },
  { id: 'ex_adductor', name: 'Adducteurs machine', p: ['adductors'], eq: 'machine', cat: 'isolation', reps: [10, 15], inc: 5 },
];

export function seedIfEmpty(defaultBackoff = 0.8): void {
  if (exerciseCount() > 0) return;
  db().transaction(() => {
    for (const s of SEEDS) {
      createExercise(
        {
          name: s.name,
          primaryMuscles: s.p,
          secondaryMuscles: s.s ?? [],
          equipment: s.eq,
          unilateral: s.uni ?? false,
          loadType: s.load ?? 'external',
          category: s.cat,
          progressionType: s.prog ?? 'double_progression',
          backoffPercent: defaultBackoff,
          repRangeMin: s.reps?.[0] ?? 8,
          repRangeMax: s.reps?.[1] ?? 12,
          weightIncrement: s.inc ?? null,
          isCustom: false,
          notes: '',
        },
        s.id,
      );
    }
  });
}
