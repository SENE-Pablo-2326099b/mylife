import type { Db } from './db';

/**
 * Append-only list of migrations; index + 1 = schema version (PRAGMA user_version).
 * Never edit a shipped migration — add a new one.
 */
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );

  CREATE TABLE exercises (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    primary_muscles TEXT NOT NULL,
    secondary_muscles TEXT NOT NULL,
    equipment TEXT NOT NULL,
    unilateral INTEGER NOT NULL DEFAULT 0,
    load_type TEXT NOT NULL DEFAULT 'external',
    category TEXT NOT NULL,
    progression_type TEXT NOT NULL,
    backoff_percent REAL NOT NULL DEFAULT 0.8,
    rep_range_min INTEGER NOT NULL,
    rep_range_max INTEGER NOT NULL,
    weight_increment REAL,
    is_custom INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE macrocycles (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE mesocycles (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    macrocycle_id TEXT REFERENCES macrocycles(id) ON DELETE SET NULL,
    start_date TEXT NOT NULL,
    work_weeks INTEGER NOT NULL,
    deload_weeks INTEGER NOT NULL,
    scheme TEXT NOT NULL,
    deload_load_factor REAL NOT NULL,
    deload_volume_factor REAL NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE templates (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE template_exercises (
    id TEXT PRIMARY KEY NOT NULL,
    template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    exercise_id TEXT NOT NULL REFERENCES exercises(id),
    position INTEGER NOT NULL,
    intention TEXT NOT NULL,
    target_sets INTEGER NOT NULL,
    rep_min INTEGER,
    rep_max INTEGER,
    top_sets INTEGER,
    backoff_sets INTEGER,
    backoff_percent REAL,
    notes TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX idx_template_exercises_template ON template_exercises(template_id, position);

  CREATE TABLE week_pattern (
    id TEXT PRIMARY KEY NOT NULL,
    weekday INTEGER NOT NULL,
    template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    position INTEGER NOT NULL
  );

  CREATE TABLE workouts (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    date TEXT NOT NULL,
    template_id TEXT REFERENCES templates(id) ON DELETE SET NULL,
    planned_id TEXT,
    mesocycle_id TEXT REFERENCES mesocycles(id) ON DELETE SET NULL,
    week_index INTEGER,
    is_deload INTEGER NOT NULL DEFAULT 0,
    bodyweight REAL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    status TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX idx_workouts_date ON workouts(date);
  CREATE INDEX idx_workouts_status ON workouts(status);
  CREATE INDEX idx_workouts_meso ON workouts(mesocycle_id);

  CREATE TABLE planned_sessions (
    id TEXT PRIMARY KEY NOT NULL,
    date TEXT NOT NULL,
    template_id TEXT REFERENCES templates(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    position INTEGER NOT NULL,
    workout_id TEXT REFERENCES workouts(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_planned_date ON planned_sessions(date);

  CREATE TABLE workout_exercises (
    id TEXT PRIMARY KEY NOT NULL,
    workout_id TEXT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
    exercise_id TEXT NOT NULL REFERENCES exercises(id),
    position INTEGER NOT NULL,
    progression_type TEXT NOT NULL,
    intention TEXT NOT NULL,
    rep_min INTEGER NOT NULL,
    rep_max INTEGER NOT NULL,
    backoff_percent REAL NOT NULL,
    template_exercise_id TEXT,
    notes TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX idx_we_workout ON workout_exercises(workout_id, position);
  CREATE INDEX idx_we_exercise ON workout_exercises(exercise_id);

  CREATE TABLE sets (
    id TEXT PRIMARY KEY NOT NULL,
    workout_exercise_id TEXT NOT NULL REFERENCES workout_exercises(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    set_type TEXT NOT NULL,
    type_manual INTEGER NOT NULL DEFAULT 0,
    weight REAL,
    reps INTEGER,
    target_weight REAL,
    target_reps INTEGER,
    target_reps_max INTEGER,
    bar_speed TEXT,
    completed INTEGER NOT NULL DEFAULT 0,
    completed_at INTEGER
  );
  CREATE INDEX idx_sets_we ON sets(workout_exercise_id, position);

  CREATE TABLE body_entries (
    id TEXT PRIMARY KEY NOT NULL,
    date TEXT NOT NULL,
    metric TEXT NOT NULL,
    value REAL NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_body_metric_date ON body_entries(metric, date);
  `,
  // 2 — per-slot progression, per exercise/week cycle tweaks, deload reps.
  `
  ALTER TABLE template_exercises ADD COLUMN progression_type TEXT;

  ALTER TABLE mesocycles ADD COLUMN deload_top_reps INTEGER NOT NULL DEFAULT 5;
  ALTER TABLE mesocycles ADD COLUMN deload_backoff_reps INTEGER NOT NULL DEFAULT 5;

  CREATE TABLE cycle_week_overrides (
    id TEXT PRIMARY KEY NOT NULL,
    mesocycle_id TEXT NOT NULL REFERENCES mesocycles(id) ON DELETE CASCADE,
    exercise_id TEXT NOT NULL REFERENCES exercises(id),
    week_index INTEGER NOT NULL,
    top_sets INTEGER,
    top_reps_min INTEGER,
    top_reps_max INTEGER,
    backoff_sets INTEGER,
    backoff_reps INTEGER,
    backoff_percent REAL,
    intensity REAL,
    top_weight REAL,
    UNIQUE (mesocycle_id, exercise_id, week_index)
  );
  `,
  // 3 — remembered substitutions ("did X instead of Y"), to offer them first next time.
  `
  CREATE TABLE exercise_substitutions (
    from_exercise_id TEXT NOT NULL REFERENCES exercises(id),
    to_exercise_id TEXT NOT NULL REFERENCES exercises(id),
    uses INTEGER NOT NULL DEFAULT 1,
    last_used_at INTEGER NOT NULL,
    PRIMARY KEY (from_exercise_id, to_exercise_id)
  );
  `,
  // 4 — loads as % of the reference 1RM: test sets, reference snapshot per workout exercise, deload
  // shape of the main lifts. Old per-week % tweaks meant something else (fraction of the e1RM before
  // inverse Epley / of the top set): cleared rather than misread.
  `
  ALTER TABLE sets ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE workout_exercises ADD COLUMN reference_e1rm REAL;
  ALTER TABLE mesocycles ADD COLUMN deload_main TEXT;

  UPDATE cycle_week_overrides SET intensity = NULL, backoff_percent = NULL;
  DELETE FROM cycle_week_overrides WHERE top_sets IS NULL AND top_reps_min IS NULL AND top_reps_max IS NULL
    AND backoff_sets IS NULL AND backoff_reps IS NULL AND top_weight IS NULL;
  `,
  // 5 — mesocycle type (block periodization) and a free note on any set.
  `
  ALTER TABLE mesocycles ADD COLUMN kind TEXT NOT NULL DEFAULT 'accumulation';
  ALTER TABLE sets ADD COLUMN note TEXT NOT NULL DEFAULT '';
  `,
  // 6 — 1RM typed by the user (as logged: lest for weighted lifts), and whether it drives the loads.
  `
  CREATE TABLE exercise_one_rm (
    exercise_id TEXT PRIMARY KEY NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    value REAL NOT NULL,
    mode TEXT NOT NULL DEFAULT 'manual',
    set_on TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  `,
  // 7 — no more fixed top set loads: every load is a % of the 1RM (pins cleared, emptied tweaks dropped).
  `
  UPDATE cycle_week_overrides SET top_weight = NULL;
  DELETE FROM cycle_week_overrides WHERE top_sets IS NULL AND top_reps_min IS NULL AND top_reps_max IS NULL
    AND backoff_sets IS NULL AND backoff_reps IS NULL AND backoff_percent IS NULL AND intensity IS NULL;
  `,
  // 8 — exercise a session exercise was done instead of (swap). Back-filled where the slot's exercise
  // differs and that swap is on record (exercise_substitutions), i.e. swaps made with « Remplacer ».
  `
  ALTER TABLE workout_exercises ADD COLUMN replaces_exercise_id TEXT;
  UPDATE workout_exercises SET replaces_exercise_id = (
    SELECT te.exercise_id FROM template_exercises te WHERE te.id = workout_exercises.template_exercise_id
  )
  WHERE template_exercise_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM template_exercises te JOIN exercise_substitutions es
      ON es.from_exercise_id = te.exercise_id AND es.to_exercise_id = workout_exercises.exercise_id
    WHERE te.id = workout_exercises.template_exercise_id AND te.exercise_id != workout_exercises.exercise_id
  );
  `,
  // 9 — synchro MyLife : file des lignes modifiées sur cet appareil (remplie par des déclencheurs,
  // voir src/services/cloud/sqliteStore.ts) et état de la synchro. Pas dans les sauvegardes.
  `
  CREATE TABLE IF NOT EXISTS sync_queue (
    tbl TEXT NOT NULL,
    rid TEXT NOT NULL,
    ver INTEGER NOT NULL,
    at INTEGER NOT NULL,
    PRIMARY KEY (tbl, rid)
  );
  CREATE TABLE IF NOT EXISTS sync_state (k TEXT PRIMARY KEY NOT NULL, v TEXT NOT NULL);
  INSERT OR IGNORE INTO sync_state (k, v) VALUES ('applying', '0');
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export function migrate(db: Db): void {
  db.exec('PRAGMA foreign_keys = ON;');
  const row = db.first<{ user_version: number }>('PRAGMA user_version');
  const from = row?.user_version ?? 0;
  for (let v = from; v < MIGRATIONS.length; v++) {
    const sql = MIGRATIONS[v];
    if (sql === undefined) continue;
    db.transaction(() => {
      db.exec(sql);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}
