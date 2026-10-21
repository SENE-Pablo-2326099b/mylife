import { estimate1RM } from '@/domain/math';

import { db, type SqlValue } from './db';
import { SCHEMA_VERSION } from './migrations';

/** Insert order respects foreign keys; deletion runs in reverse. */
export const TABLES = [
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
] as const;

type Row = Record<string, SqlValue>;

export interface Backup {
  app: 'myperf';
  schemaVersion: number;
  exportedAt: string;
  tables: Record<string, Row[]>;
}

export function buildBackup(): Backup {
  const tables: Record<string, Row[]> = {};
  for (const table of TABLES) tables[table] = db().all<Row>(`SELECT * FROM ${table}`);
  return { app: 'myperf', schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), tables };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isSqlValue(v: unknown): v is SqlValue {
  return v === null || typeof v === 'string' || typeof v === 'number';
}

/**
 * Replaces all data with a backup, atomically: on any error nothing changes.
 * Only columns that exist in the current schema are restored (forward compatible).
 * Returns the number of restored rows.
 */
export function restoreBackup(raw: unknown): number {
  if (!isRecord(raw) || raw.app !== 'myperf' || !isRecord(raw.tables)) throw new Error('Fichier de sauvegarde invalide');
  const version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;
  if (version > SCHEMA_VERSION) throw new Error('Sauvegarde créée par une version plus récente de l’app');
  const tables = raw.tables;
  let count = 0;
  db().transaction(() => {
    for (const table of [...TABLES].reverse()) db().run(`DELETE FROM ${table}`);
    for (const table of TABLES) {
      const rows = tables[table];
      if (!Array.isArray(rows)) continue;
      const columns = new Set(db().all<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name));
      for (const row of rows) {
        if (!isRecord(row)) continue;
        const keys = Object.keys(row).filter((k) => columns.has(k) && isSqlValue(row[k]));
        if (keys.length === 0) continue;
        const values = keys.map((k) => {
          const v = row[k];
          return isSqlValue(v) ? v : null;
        });
        db().run(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, values);
        count += 1;
      }
    }
  });
  return count;
}

/** Deletes every row of every table, settings included unless `keepSettings`. */
export function clearAllData(keepSettings = true): void {
  db().transaction(() => {
    for (const table of [...TABLES].reverse()) {
      if (keepSettings && table === 'settings') continue;
      db().run(`DELETE FROM ${table}`);
    }
  });
}

const csvCell = (v: SqlValue): string => {
  if (v === null) return '';
  const s = String(v);
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One line per completed set — ready for a spreadsheet. */
export function setsCsv(): string {
  const rows = db().all<{
    date: string;
    workout: string;
    exercise: string;
    load_type: string;
    position: number;
    set_type: string;
    weight: number;
    reps: number;
    bar_speed: string | null;
    mesocycle: string | null;
    week_index: number | null;
    is_deload: number;
    bodyweight: number | null;
  }>(
    `SELECT w.date, w.name AS workout, e.name AS exercise, e.load_type, s.position, s.set_type, s.weight, s.reps, s.bar_speed,
            m.name AS mesocycle, w.week_index, w.is_deload, w.bodyweight
     FROM sets s
     JOIN workout_exercises we ON we.id = s.workout_exercise_id
     JOIN workouts w ON w.id = we.workout_id
     JOIN exercises e ON e.id = we.exercise_id
     LEFT JOIN mesocycles m ON m.id = w.mesocycle_id
     WHERE s.completed = 1 AND s.weight IS NOT NULL AND s.reps IS NOT NULL
     ORDER BY w.date, w.started_at, we.position, s.position`,
  );
  const header = ['date', 'seance', 'exercice', 'type_serie', 'poids_kg', 'reps', 'e1rm_kg', 'vitesse', 'mesocycle', 'semaine', 'deload', 'poids_corps_kg'];
  const lines = rows.map((r) => {
    const bw = r.load_type === 'bodyweight' ? r.bodyweight : null;
    const e1rm = Math.round(estimate1RM(r.weight, r.reps, bw) * 10) / 10;
    return [r.date, r.workout, r.exercise, r.set_type, r.weight, r.reps, e1rm, r.bar_speed, r.mesocycle, r.week_index, r.is_deload, r.bodyweight]
      .map(csvCell)
      .join(',');
  });
  return [header.join(','), ...lines].join('\n');
}
