import { estimate1RM } from '@mylife/training';
import type { Db } from './sql';

/**
 * Les séries pour un tableur (23/11). La sauvegarde complète, elle, est « Tout exporter (JSON complet) » (full.ts) :
 * lisible, réimportable, fusionnée sans doublon.
 */

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
