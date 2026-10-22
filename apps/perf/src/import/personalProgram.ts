/**
 * The user's real program, transcribed from data/programme-reel.md (the single source of truth —
 * the Excel carnet only contributes the sets already done, via historique-seances.csv).
 *
 * Exercise ids reuse the generic library ids when it is the same movement, so the library has no
 * duplicates and history stays attached if the generic seed changes.
 */
import type {
  Equipment,
  ExerciseCategory,
  Intention,
  LoadType,
  Muscle,
  ProgressionType,
} from '@/domain/types';

export interface PersonalExercise {
  id: string;
  name: string;
  primary: Muscle[];
  secondary: Muscle[];
  equipment: Equipment;
  category: ExerciseCategory;
  progression: ProgressionType;
  load: LoadType;
  unilateral?: boolean;
  reps: [number, number];
  increment?: number | null;
  /** Kept for history only (replaced in the program). */
  archived?: boolean;
  notes?: string;
}

export const PERSONAL_EXERCISES: readonly PersonalExercise[] = [
  // Main lifts — top set + backoff 80 %. Lifts with lest: the logged weight is the added load.
  { id: 'ex_weighted_dip', name: 'Dips lesté', primary: ['chest', 'triceps'], secondary: ['shoulders'], equipment: 'bodyweight', category: 'main', progression: 'top_set_backoff', load: 'bodyweight', reps: [2, 8], notes: 'Dips force du mardi. Le volume du samedi est suivi à part (« Dips lesté (volume) »).' },
  // Same movement, tracked on its own: complementary to the heavy dips, never mixed in their stats.
  { id: 'ex_weighted_dip_volume', name: 'Dips lesté (volume)', primary: ['chest', 'triceps'], secondary: ['shoulders'], equipment: 'bodyweight', category: 'compound', progression: 'double_progression', load: 'bodyweight', reps: [8, 10], notes: 'Dips volume du samedi : double progression 4 × 8-10, plus léger que mardi, pas de top set.' },
  { id: 'ex_weighted_pullup', name: 'Pull-up lesté pronation', primary: ['lats', 'back'], secondary: ['biceps', 'forearms', 'rear_delts'], equipment: 'bodyweight', category: 'main', progression: 'top_set_backoff', load: 'bodyweight', reps: [2, 8], notes: 'Remplace le chin-up lesté à partir du 12 oct. 2026.' },
  { id: 'ex_squat', name: 'Back squat', primary: ['quads', 'glutes'], secondary: ['adductors', 'lower_back'], equipment: 'barbell', category: 'main', progression: 'top_set_backoff', load: 'external', reps: [2, 8] },
  { id: 'ex_weighted_chinup', name: 'Chin-up lesté', primary: ['lats', 'biceps'], secondary: ['back', 'forearms'], equipment: 'bodyweight', category: 'main', progression: 'top_set_backoff', load: 'bodyweight', reps: [2, 8], archived: true, notes: 'Remplacé par le pull-up lesté pronation le 12 oct. 2026.' },

  // Mardi
  { id: 'ex_smith_incline_bench', name: 'Bench incliné Smith', primary: ['chest'], secondary: ['shoulders', 'triceps'], equipment: 'machine', category: 'compound', progression: 'double_progression', load: 'external', reps: [8, 10] },
  { id: 'ex_skullcrusher', name: 'Barre au front', primary: ['triceps'], secondary: [], equipment: 'barbell', category: 'isolation', progression: 'double_progression', load: 'external', reps: [8, 12] },
  { id: 'ex_triceps_pushdown', name: 'Pushdown corde', primary: ['triceps'], secondary: [], equipment: 'cable', category: 'isolation', progression: 'double_progression', load: 'external', reps: [8, 12] },
  // Tuesday's lateral raises are done at the machine (confirmed 2026-10-06); the dumbbell version stays separate.
  { id: 'ex_machine_lateral_raise', name: 'Élévations latérales machine', primary: ['shoulders'], secondary: [], equipment: 'machine', category: 'isolation', progression: 'double_progression', load: 'external', reps: [12, 20] },
  { id: 'ex_lateral_raise', name: 'Élévations latérales', primary: ['shoulders'], secondary: [], equipment: 'dumbbell', category: 'isolation', progression: 'double_progression', load: 'external', reps: [12, 20], increment: 1.25, notes: 'Aux haltères.' },

  // Mercredi
  { id: 'ex_ez_curl_wall', name: 'Curl EZ strict (dos au mur)', primary: ['biceps'], secondary: ['forearms'], equipment: 'barbell', category: 'isolation', progression: 'double_progression', load: 'external', reps: [8, 12] },
  { id: 'ex_barbell_row', name: 'Rowing Pendlay', primary: ['back', 'lats'], secondary: ['rear_delts', 'biceps', 'lower_back'], equipment: 'barbell', category: 'compound', progression: 'double_progression', load: 'external', reps: [8, 10] },
  { id: 'ex_lat_pulldown_supine', name: 'Lat pulldown supination', primary: ['lats'], secondary: ['biceps', 'back'], equipment: 'cable', category: 'compound', progression: 'double_progression', load: 'external', reps: [8, 10] },
  { id: 'ex_hammer_curl', name: 'Curl marteau', primary: ['biceps', 'forearms'], secondary: [], equipment: 'dumbbell', category: 'isolation', progression: 'double_progression', load: 'external', reps: [8, 12], increment: 1.25 },

  // Jeudi
  { id: 'ex_hack_squat', name: 'Hack squat', primary: ['quads'], secondary: ['glutes'], equipment: 'machine', category: 'compound', progression: 'double_progression', load: 'external', reps: [8, 10], notes: 'Conditionnel : à sauter si la fatigue est trop haute.' },
  { id: 'ex_rdl', name: 'RDL', primary: ['hamstrings', 'glutes'], secondary: ['lower_back'], equipment: 'barbell', category: 'compound', progression: 'double_progression', load: 'external', reps: [8, 10] },
  { id: 'ex_leg_extension', name: 'Leg extension', primary: ['quads'], secondary: [], equipment: 'machine', category: 'isolation', progression: 'double_progression', load: 'external', reps: [8, 12] },
  { id: 'ex_leg_curl', name: 'Leg curl assis', primary: ['hamstrings'], secondary: [], equipment: 'machine', category: 'isolation', progression: 'double_progression', load: 'external', reps: [8, 12] },

  // Samedi
  { id: 'ex_machine_row', name: 'Rowing machine', primary: ['back', 'lats'], secondary: ['rear_delts', 'biceps'], equipment: 'machine', category: 'compound', progression: 'double_progression', load: 'external', reps: [8, 10] },
  { id: 'ex_incline_db_press', name: 'DI haltères incliné 30°', primary: ['chest'], secondary: ['shoulders', 'triceps'], equipment: 'dumbbell', category: 'compound', progression: 'double_progression', load: 'external', reps: [8, 10], increment: 2 },
  { id: 'ex_cable_lateral', name: 'Élévations latérales câble', primary: ['shoulders'], secondary: [], equipment: 'cable', category: 'isolation', progression: 'double_progression', load: 'external', unilateral: true, reps: [12, 20], increment: 1.25 },
  { id: 'ex_face_pull', name: 'Face pulls', primary: ['rear_delts'], secondary: ['traps'], equipment: 'cable', category: 'isolation', progression: 'double_progression', load: 'external', reps: [12, 20] },

  // Dimanche
  { id: 'ex_db_ohp', name: 'Développé militaire haltères', primary: ['shoulders'], secondary: ['triceps'], equipment: 'dumbbell', category: 'compound', progression: 'double_progression', load: 'external', reps: [8, 10], increment: 2 },
  { id: 'ex_overhead_ext', name: 'Extension overhead un bras', primary: ['triceps'], secondary: [], equipment: 'cable', category: 'isolation', progression: 'double_progression', load: 'external', unilateral: true, reps: [8, 12], increment: 1.25 },
  { id: 'ex_preacher_curl', name: 'Curl pupitre', primary: ['biceps'], secondary: [], equipment: 'machine', category: 'isolation', progression: 'double_progression', load: 'external', reps: [8, 12], increment: 1.25 },
  { id: 'ex_reverse_pec_deck_neutral', name: 'Reverse pec deck prise neutre', primary: ['rear_delts'], secondary: ['traps'], equipment: 'machine', category: 'isolation', progression: 'double_progression', load: 'external', reps: [12, 20], notes: 'Remplace « Arrière épaule poulie » (douleur d’épaule en S4).' },

  // Variants actually done instead of the planned exercise (carnet comments). Separate exercises:
  // different machines mean different loads, so their stats must never mix. Ready for swaps.
  { id: 'ex_cable_row_close', name: 'Tirage horizontal poulie prise serrée', primary: ['back', 'lats'], secondary: ['biceps', 'rear_delts'], equipment: 'cable', category: 'compound', progression: 'double_progression', load: 'external', reps: [8, 10] },
  { id: 'ex_db_row', name: 'Rowing bûcheron haltère unilatéral', primary: ['back', 'lats'], secondary: ['biceps', 'rear_delts'], equipment: 'dumbbell', category: 'compound', progression: 'double_progression', load: 'external', unilateral: true, reps: [8, 10], increment: 2 },
  { id: 'ex_machine_shoulder_press', name: 'Shoulder press guidée', primary: ['shoulders'], secondary: ['triceps'], equipment: 'machine', category: 'compound', progression: 'double_progression', load: 'external', reps: [8, 10] },
  { id: 'ex_triceps_ext_one_arm', name: 'Extension triceps classique un bras', primary: ['triceps'], secondary: [], equipment: 'cable', category: 'isolation', progression: 'double_progression', load: 'external', unilateral: true, reps: [8, 12], increment: 1.25 },
  { id: 'ex_overhead_rope', name: 'Extension overhead corde (2 bras)', primary: ['triceps'], secondary: [], equipment: 'cable', category: 'isolation', progression: 'double_progression', load: 'external', reps: [8, 12] },
  { id: 'ex_v_bar_pushdown', name: 'Pushdown barre en V', primary: ['triceps'], secondary: [], equipment: 'cable', category: 'isolation', progression: 'double_progression', load: 'external', reps: [8, 12] },
  { id: 'ex_lat_pulldown_prone', name: 'Lat pulldown pronation', primary: ['lats'], secondary: ['back', 'biceps'], equipment: 'cable', category: 'compound', progression: 'double_progression', load: 'external', reps: [8, 10] },
  { id: 'ex_hammer_cable_one_arm', name: 'Curl marteau poulie unilatéral', primary: ['biceps', 'forearms'], secondary: [], equipment: 'cable', category: 'isolation', progression: 'double_progression', load: 'external', unilateral: true, reps: [8, 12], increment: 1.25 },
  { id: 'ex_hammer_cable_rope', name: 'Curl marteau poulie corde (2 mains)', primary: ['biceps', 'forearms'], secondary: [], equipment: 'cable', category: 'isolation', progression: 'double_progression', load: 'external', reps: [8, 12] },
  { id: 'ex_hammer_preacher_db', name: 'Curl pupitre haltère prise marteau (unilatéral)', primary: ['biceps', 'forearms'], secondary: [], equipment: 'dumbbell', category: 'isolation', progression: 'double_progression', load: 'external', unilateral: true, reps: [8, 12], increment: 1 },

  { id: 'ex_cable_rear_delt', name: 'Arrière épaule poulie', primary: ['rear_delts'], secondary: [], equipment: 'cable', category: 'isolation', progression: 'double_progression', load: 'external', reps: [12, 20], archived: true, notes: 'Remplacé par le reverse pec deck prise neutre (douleur d’épaule).' },
];

/**
 * Name variants seen in the history → canonical exercise id.
 * Keys are normalised (see `normalizeName`); canonical names map to themselves automatically.
 */
export const NAME_ALIASES: Readonly<Record<string, string>> = {
  'curl marteau': 'ex_hammer_curl',
  'extension overhead': 'ex_overhead_ext',
  'developpe militaire': 'ex_db_ohp',
  'chin-up leste': 'ex_weighted_chinup',
};

export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export interface TemplateSlot {
  exerciseId: string;
  /** Double progression set count (ignored by top set slots, which follow the cycle). */
  sets: number;
  intention: Intention;
  progression?: ProgressionType;
  /** Slot rep range when it differs from the exercise's (e.g. volume dips 8-10). */
  reps?: [number, number];
  notes?: string;
}

export interface PersonalTemplate {
  id: string;
  name: string;
  /** 0 = Monday … 6 = Sunday. */
  weekday: number;
  slots: TemplateSlot[];
}

const main = (exerciseId: string): TemplateSlot => ({ exerciseId, sets: 1, intention: 'strength' });
const acc = (exerciseId: string, sets: number, notes?: string): TemplateSlot => ({ exerciseId, sets, intention: 'hypertrophy', notes });

export const PERSONAL_TEMPLATES: readonly PersonalTemplate[] = [
  {
    id: 'tpl_mardi',
    name: 'Mardi — Poussée + triceps',
    weekday: 1,
    slots: [main('ex_weighted_dip'), acc('ex_smith_incline_bench', 3), acc('ex_skullcrusher', 4), acc('ex_triceps_pushdown', 4), acc('ex_machine_lateral_raise', 4)],
  },
  {
    id: 'tpl_mercredi',
    name: 'Mercredi — Tirage + biceps',
    weekday: 2,
    slots: [main('ex_weighted_pullup'), acc('ex_ez_curl_wall', 4), acc('ex_barbell_row', 3), acc('ex_lat_pulldown_supine', 3), acc('ex_hammer_curl', 4)],
  },
  {
    id: 'tpl_jeudi',
    name: 'Jeudi — Jambes',
    weekday: 3,
    slots: [
      main('ex_squat'),
      acc('ex_hack_squat', 3, 'Conditionnel : à sauter si la fatigue est trop haute.'),
      acc('ex_rdl', 3),
      acc('ex_leg_extension', 4),
      acc('ex_leg_curl', 4),
    ],
  },
  {
    id: 'tpl_samedi',
    name: 'Samedi — Haut du corps volume + épaules',
    weekday: 5,
    slots: [
      acc('ex_weighted_dip_volume', 4),
      acc('ex_machine_row', 3),
      acc('ex_incline_db_press', 3),
      acc('ex_cable_lateral', 4),
      acc('ex_face_pull', 4),
    ],
  },
  {
    id: 'tpl_dimanche',
    name: 'Dimanche — Épaules + bras',
    weekday: 6,
    // Order alternates triceps / biceps on purpose.
    slots: [acc('ex_db_ohp', 3), acc('ex_overhead_ext', 4), acc('ex_preacher_curl', 4), acc('ex_reverse_pec_deck_neutral', 4), acc('ex_hammer_curl', 4)],
  },
];

export const PROGRAM_START = '2026-09-07';
export const BLOC1 = { id: 'meso_bloc1', name: 'Bloc 1 — Remise en route', startDate: PROGRAM_START };
/** First real 4+1 mesocycle, then looping. Three cycles are generated; all stay editable. */
export const CYCLES = [
  { id: 'meso_cycle1', name: 'Cycle 1', startDate: '2026-10-12' },
  { id: 'meso_cycle2', name: 'Cycle 2', startDate: '2026-11-16' },
  { id: 'meso_cycle3', name: 'Cycle 3', startDate: '2026-12-21' },
];

export const BODYWEIGHT = { date: '2026-09-07', value: 63 };

/** Sessions start around 17:30 (programme-reel.md); used as the start time of imported sessions. */
export const SESSION_TIME = { hours: 17, minutes: 30 };
