/**
 * What the CSV export lost or mislabelled, recovered from the carnet (data/CARNET-Real_2.xlsx,
 * sheet SÉANCES) — every entry cites its row ("r123") and the user's own comment.
 *
 * - Substitutions written in the COMMENTAIRES column: the sets belong to the exercise actually done
 *   (a guided shoulder press is not a dumbbell press: different loads, separate stats).
 * - Sets the CSV dropped: bodyweight sets written "pdc" (stored as 0 kg of lest), and loads Excel
 *   turned into dates because of the "d.m" cell format ("17.5" → 17 May → 17.5 kg).
 * - Reps the comments correct (failed or assisted reps are not counted).
 * Nothing here is guessed beyond what the carnet says; interpretations are spelled out in `source`.
 */
import type { SetType } from '@/domain/types';

/** Moves sets (all, or some series) of an exercise on a date to the exercise really done. */
export interface Reassign {
  date: string;
  /** Exercise name as written in the CSV. */
  exercise: string;
  series?: number[];
  to: string;
  source: string;
}

export interface RepsFix {
  date: string;
  exercise: string;
  serie: number;
  reps: number;
  source: string;
}

/** Sets present in the carnet but missing from the CSV, placed next to an existing CSV set. */
export interface Recovered {
  date: string;
  exerciseId: string;
  anchor: { exercise: string; serie: number; side: 'before' | 'after' };
  sets: { weight: number; reps: number; setType?: SetType; serie?: number }[];
  source: string;
}

export interface Note {
  date: string;
  /** Exercise id after corrections; null = note on the whole session. */
  exerciseId: string | null;
  text: string;
}

export const REASSIGNS: readonly Reassign[] = [
  // Answers given by the user on 2026-10-06 about load jumps the carnet did not explain.
  { date: '2026-09-08', exercise: 'Bench incliné Smith', to: 'ex_incline_db_press', source: 'confirmé par toi : fait aux haltères le 8 sept.' },
  ...['2026-09-15', '2026-09-22', '2026-09-29'].map((date) => ({
    date,
    exercise: 'Élévations latérales',
    to: 'ex_machine_lateral_raise',
    source: 'confirmé par toi : le mardi, élévations latérales à la machine',
  })),
  { date: '2026-09-19', exercise: 'Rowing machine', to: 'ex_cable_row_close', source: 'r190 « Tirage Horizontale poulie prise serré »' },
  { date: '2026-09-20', exercise: 'Développé militaire haltères', to: 'ex_machine_shoulder_press', source: 'r207 « Shoulder Press guidée »' },
  { date: '2026-09-20', exercise: 'Extension overhead un bras', series: [3, 4], to: 'ex_triceps_ext_one_arm', source: 'r217-218 « Extension triceps classique à un bras »' },
  { date: '2026-09-22', exercise: 'Pushdown corde', to: 'ex_v_bar_pushdown', source: 'r245 « push down barre en v »' },
  // "pronation" written on set 1 only: read as the whole exercise of that day (pull-ups instead of chin-ups).
  { date: '2026-09-23', exercise: 'Chin-up lesté', to: 'ex_weighted_pullup', source: 'r256 « pronation » (appliqué aux 4 séries)' },
  { date: '2026-09-23', exercise: 'Lat pulldown supination', to: 'ex_lat_pulldown_prone', source: 'r267 « Pronation » (appliqué aux 3 séries)' },
  { date: '2026-09-23', exercise: 'Curl marteau', to: 'ex_hammer_cable_one_arm', source: 'r270 « poulie unilatéral »' },
  { date: '2026-09-30', exercise: 'Curl marteau', to: 'ex_hammer_preacher_db', source: 'r382 « Preacher curl unilatéral aux haltères prise marteau pour toutes les séries »' },
  { date: '2026-10-03', exercise: 'Rowing machine', to: 'ex_db_row', source: 'r414 « rowing bûcheron haltères unilatéral »' },
  { date: '2026-10-04', exercise: 'Extension overhead', to: 'ex_overhead_rope', source: 'r434 « overhead à la corde deux bras en même temps »' },
  { date: '2026-10-04', exercise: 'Curl marteau', series: [1, 2], to: 'ex_hammer_cable_rope', source: 'r446 « marteau à la poulie 2 mains pour les 2 premières séries »' },
  { date: '2026-10-04', exercise: 'Curl marteau', series: [3, 4], to: 'ex_hammer_cable_one_arm', source: 'r446 « … puis unilatéral »' },
];

export const REPS_FIXES: readonly RepsFix[] = [
  { date: '2026-09-22', exercise: 'Dips lesté', serie: 2, reps: 9, source: 'r235 « 10e rep tentée mais partie haute pas réussie » → 9 reps validées' },
  { date: '2026-09-29', exercise: 'Bench incliné Smith', serie: 3, reps: 9, source: 'r352 « jusqu’à 9 tout seul, jusqu’à 11 avec l’aide d’un passant » → 9 sans aide' },
];

export const RECOVERED: readonly Recovered[] = [
  {
    date: '2026-09-19',
    exerciseId: 'ex_incline_db_press',
    anchor: { exercise: 'DI haltères incliné 30°', serie: 2, side: 'after' },
    sets: [{ weight: 18, reps: 5, setType: 'drop' }],
    source: 'r194 « ça + 5 × 18 kg » (dégressif)',
  },
  {
    date: '2026-09-19',
    exerciseId: 'ex_incline_db_press',
    anchor: { exercise: 'DI haltères incliné 30°', serie: 3, side: 'after' },
    sets: [{ weight: 16, reps: 5, setType: 'drop' }],
    source: 'r195 « ça + 5 × 16 » (dégressif)',
  },
  {
    date: '2026-09-23',
    exerciseId: 'ex_weighted_pullup',
    anchor: { exercise: 'Chin-up lesté', serie: 2, side: 'after' },
    sets: [
      { weight: 0, reps: 6, serie: 3 },
      { weight: 0, reps: 6, serie: 4 },
    ],
    source: 'r258-259 charge « pdc » (poids du corps) absente du CSV',
  },
  {
    date: '2026-09-29',
    exerciseId: 'ex_triceps_pushdown',
    anchor: { exercise: 'Pushdown corde', serie: 1, side: 'after' },
    sets: [{ weight: 17.5, reps: 8, serie: 2 }],
    source: 'r358 charge « 17.5 » convertie en date (17 mai) par Excel',
  },
  {
    date: '2026-09-30',
    exerciseId: 'ex_weighted_pullup',
    anchor: { exercise: 'Curl EZ strict (dos au mur)', serie: 1, side: 'before' },
    sets: [
      { weight: 0, reps: 11 },
      { weight: 0, reps: 9 },
      { weight: 0, reps: 7 },
    ],
    source: 'r368-370 « Pull-ups » au poids du corps (« pdc »), absents du CSV',
  },
  {
    date: '2026-09-30',
    exerciseId: 'ex_weighted_chinup',
    anchor: { exercise: 'Curl EZ strict (dos au mur)', serie: 1, side: 'before' },
    sets: [
      { weight: 0, reps: 6 },
      { weight: 0, reps: 5 },
    ],
    source: 'r371 chin-up « pdc » × 6 + « une deuxième série pdc mais que 5 reps »',
  },
  {
    date: '2026-09-30',
    exerciseId: 'ex_ez_curl_wall',
    anchor: { exercise: 'Curl EZ strict (dos au mur)', serie: 3, side: 'after' },
    sets: [{ weight: 27.5, reps: 8, serie: 4 }],
    source: 'r375 charge « 27.5 » convertie en date (27 mai) par Excel',
  },
  {
    date: '2026-10-03',
    exerciseId: 'ex_cable_lateral',
    anchor: { exercise: 'DI haltères incliné 30°', serie: 3, side: 'after' },
    sets: [
      { weight: 7.5, reps: 12 },
      { weight: 7.5, reps: 12 },
      { weight: 7.5, reps: 12 },
      { weight: 7.5, reps: 12 },
    ],
    source: 'r420-423 charge « 7.5 » convertie en date (7 mai) par Excel',
  },
];

/** Load jumps the user confirmed as real (same exercise): not reported as anomalies. */
export const CONFIRMED_JUMPS: readonly { exerciseId: string; from: string; to: string; source: string }[] = [
  { exerciseId: 'ex_triceps_pushdown', from: '2026-09-15', to: '2026-09-29', source: 'confirmé par toi : le 29 sept. c’était bien à la corde' },
];

export const NOTES: readonly Note[] = [
  { date: '2026-09-08', exerciseId: 'ex_incline_db_press', text: 'Fait aux haltères à la place du bench incliné Smith.' },
  { date: '2026-09-19', exerciseId: 'ex_cable_row_close', text: 'Fait à la place du rowing machine.' },
  { date: '2026-09-19', exerciseId: 'ex_incline_db_press', text: 'S2 + 5 × 18 kg, S3 + 5 × 16 kg en dégressif.' },
  { date: '2026-09-20', exerciseId: 'ex_machine_shoulder_press', text: 'Fait à la place du développé militaire haltères.' },
  { date: '2026-09-20', exerciseId: 'ex_triceps_ext_one_arm', text: 'S3-S4 en extension triceps classique à un bras (S1-S2 en overhead).' },
  { date: '2026-09-22', exerciseId: 'ex_weighted_dip', text: 'S2 : 10e rep tentée, partie haute ratée → 9 reps comptées.' },
  { date: '2026-09-22', exerciseId: 'ex_v_bar_pushdown', text: 'Barre en V à la place de la corde.' },
  { date: '2026-09-23', exerciseId: 'ex_weighted_pullup', text: 'Pronation à la place du chin-up. S3-S4 au poids du corps.' },
  { date: '2026-09-23', exerciseId: 'ex_lat_pulldown_prone', text: 'Prise pronation à la place de la supination.' },
  { date: '2026-09-23', exerciseId: 'ex_hammer_cable_one_arm', text: 'Curl marteau à la poulie, unilatéral.' },
  { date: '2026-09-24', exerciseId: null, text: 'Hack squat sauté : pas de hack dans la salle, manque d’énergie.' },
  { date: '2026-09-24', exerciseId: 'ex_leg_curl', text: 'Arrêt après 1 série : crampe mollet et adducteur.' },
  { date: '2026-09-29', exerciseId: 'ex_smith_incline_bench', text: 'S3 : 9 reps seul, 11 avec une aide légère d’un passant → 9 comptées.' },
  { date: '2026-09-29', exerciseId: 'ex_skullcrusher', text: 'S2 : 7 reps + 3 après 30 s de pause. S3 : charge baissée (perte de contrôle). S4 en dégressif 17,5 → 15 → 10 kg (~20 reps au total).' },
  { date: '2026-09-29', exerciseId: 'ex_triceps_pushdown', text: 'Après la S4 (15 kg × 8) : unilatéral à 7,5 kg (reps non notées).' },
  { date: '2026-09-30', exerciseId: 'ex_weighted_pullup', text: 'Pull-ups au poids du corps (fin de bloc 1).' },
  { date: '2026-09-30', exerciseId: 'ex_weighted_chinup', text: 'Chin-up au poids du corps après les pull-ups.' },
  { date: '2026-09-30', exerciseId: 'ex_ez_curl_wall', text: 'S4 : 20 s de pause puis encore 2 reps.' },
  { date: '2026-09-30', exerciseId: 'ex_barbell_row', text: 'S1 contrôlé, 2 dernières reps moyennes.' },
  { date: '2026-09-30', exerciseId: 'ex_lat_pulldown_supine', text: 'S2 : 9e rep tentée, menton pas passé.' },
  { date: '2026-09-30', exerciseId: 'ex_hammer_preacher_db', text: 'Fait à la place du curl marteau.' },
  { date: '2026-10-03', exerciseId: 'ex_db_row', text: 'Rowing bûcheron haltère unilatéral à la place du rowing machine.' },
  { date: '2026-10-04', exerciseId: 'ex_overhead_rope', text: 'Overhead à la corde, deux bras en même temps.' },
  { date: '2026-10-04', exerciseId: 'ex_cable_rear_delt', text: 'Arrêt après 2 séries : douleur d’épaule en rotation externe (surtout gauche).' },
  { date: '2026-10-04', exerciseId: 'ex_hammer_cable_rope', text: 'Poulie à 2 mains (S1-S2), puis unilatéral.' },
];
