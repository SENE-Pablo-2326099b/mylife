import { estimate1RM } from '@mylife/training';
import { SCHEMA_VERSION } from './schema';
import type { Db } from './sql';

/**
 * « Exporter mes données » (23/11) : la sauvegarde complète de MyPerf (toutes les tables, toutes les colonnes, y
 * compris ce que l'app d'avant ne connaît pas : décalages, formats, progressions, variantes, forme notée) et le CSV
 * des séries pour un tableur. Seulement tes données d'entraînement : ni l'état de la synchro, ni aucune clé.
 */

/** Ordre des clés étrangères (l'app d'avant restaure dans cet ordre) ; les tables du moteur composable à la suite. */
export const EXPORT_TABLES = [
  'settings',
  'exercises',
  'exercise_one_rm',
  'exercise_substitutions',
  'macrocycles',
  'mesocycles',
  'cycle_week_overrides',
  'templates',
  'template_exercises',
  'week_pattern',
  'workouts',
  'planned_sessions',
  'workout_exercises',
  'sets',
  'body_entries',
  'formats',
  'cycles',
  'session_moves',
] as const;

export interface PerfBackup {
  app: 'myperf';
  schemaVersion: number;
  exportedAt: string;
  tables: Record<string, Record<string, unknown>[]>;
}

export function exportAll(d: Db, now = new Date()): PerfBackup {
  const tables: PerfBackup['tables'] = {};
  for (const t of EXPORT_TABLES) tables[t] = d.all<Record<string, unknown>>(`SELECT * FROM ${t} ORDER BY rowid`);
  return { app: 'myperf', schemaVersion: SCHEMA_VERSION, exportedAt: now.toISOString(), tables };
}

const cell = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'number' ? String(v) : String(v);
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Une ligne par série faite (charges des lestés en lest net, 1RM estimé net aussi), prête pour un tableur. */
export function setsCsv(d: Db): string {
  const rows = d.all<{
    date: string;
    workout: string;
    exercise: string;
    load_type: string;
    set_type: string;
    weight: number | null;
    reps: number | null;
    duration_s: number | null;
    rounds: number | null;
    speed: number | null;
    bar_speed: string | null;
    note: string;
    block: string | null;
    week_index: number | null;
    is_deload: number;
    bodyweight: number | null;
    rating: number | null;
  }>(
    `SELECT w.date, w.name AS workout, e.name AS exercise, e.load_type, s.set_type, s.weight, s.reps, s.duration_s, s.rounds, s.speed, s.bar_speed, s.note,
            m.name AS block, w.week_index, w.is_deload, w.bodyweight, w.rating
     FROM sets s
     JOIN workout_exercises we ON we.id = s.workout_exercise_id
     JOIN workouts w ON w.id = we.workout_id
     JOIN exercises e ON e.id = we.exercise_id
     LEFT JOIN mesocycles m ON m.id = w.mesocycle_id
     WHERE s.completed = 1 AND w.status = 'completed'
     ORDER BY w.date, w.started_at, we.position, s.position`,
  );
  const header = ['date', 'seance', 'exercice', 'type_serie', 'charge_kg', 'reps', 'duree_s', 'tours', 'e1rm_kg', 'vitesse', 'bloc', 'semaine', 'decharge', 'poids_corps_kg', 'forme', 'note'];
  const lines = rows.map((r) => {
    const bw = r.load_type === 'bodyweight' ? (r.bodyweight ?? 0) : null;
    const e1rm = r.weight !== null && r.reps !== null && r.reps > 0 ? Math.round(estimate1RM(r.weight, r.reps, bw) * 10) / 10 : null;
    return [r.date, r.workout, r.exercise, r.set_type, r.weight, r.reps, r.duration_s, r.rounds, e1rm, r.speed ?? r.bar_speed, r.block, r.week_index, r.is_deload ? 1 : 0, r.bodyweight, r.rating, r.note].map(cell).join(',');
  });
  return [header.join(','), ...lines].join('\n');
}
