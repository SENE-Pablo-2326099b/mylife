import {
  BUILTIN_FORMATS,
  capabilities,
  formatErrors,
  dayContext,
  parseBarSpeed,
  parseSetType,
  programFromLegacy,
  referenceFor,
  toOneRm,
  type HistorySet,
  type HistoryView,
  type LegacyTables,
  type Format,
  type Program,
  type RefSet,
  type Slot,
  type StrategyId,
} from '@mylife/training';
import type { Db } from './sql';

/**
 * Lectures de la base de MyPerf, côté Worker : l'historique tel que le moteur le lit (mêmes requêtes que l'app
 * d'avant, apps/perf/src/db/repos/history.ts), le programme, et le bilan de vérification de l'étape P1.
 */

const PROGRAM_TABLES = ['exercises', 'mesocycles', 'cycle_week_overrides', 'templates', 'template_exercises', 'week_pattern', 'settings'] as const;

export function readProgram(d: Db): Program {
  const t = Object.fromEntries(PROGRAM_TABLES.map((name) => [name, d.all<Record<string, unknown>>(`SELECT * FROM ${name}`)]));
  const legacy = programFromLegacy(t as unknown as LegacyTables);
  // Les colonnes du moteur composable (migration 10), que l'app d'avant ignore : format, progression autre que les
  // deux d'avant, groupe, repos du créneau ; et les formats à soi.
  const formats = readFormats(d);
  const extra = new Map(
    d.all<{ id: string; format_id: string | null; strategy: string | null; group_json: string | null; rest_sec: number | null }>('SELECT id, format_id, strategy, group_json, rest_sec FROM template_exercises').map((r) => [r.id, r]),
  );
  const known = new Set([...BUILTIN_FORMATS, ...formats].map((f) => f.id));
  return {
    ...legacy,
    formats,
    sessions: legacy.sessions.map((session) => ({
      ...session,
      slots: session.slots.map((slot): Slot => {
        const x = extra.get(slot.id);
        if (!x) return slot;
        const strategy = parseJson<Slot['strategy']>(x.strategy);
        const group = parseJson<Slot['group']>(x.group_json);
        return {
          ...slot,
          formatId: x.format_id && known.has(x.format_id) ? x.format_id : slot.formatId,
          // Les deux progressions d'avant restent lues dans leurs colonnes (l'app d'avant peut les modifier) ;
          // les autres viennent de la colonne du moteur.
          strategy: strategy && OWN_STRATEGIES.includes(strategy.id) && strategy.params && typeof strategy.params === 'object' ? strategy : slot.strategy,
          group: group && typeof group.id === 'string' && (group.kind === 'superset' || group.kind === 'circuit') ? { id: group.id, kind: group.kind, rounds: Math.max(1, Math.min(20, Number(group.rounds) || 3)) } : null,
          restSec: typeof x.rest_sec === 'number' && x.rest_sec > 0 ? x.rest_sec : null,
        };
      }),
    })),
  };
}

const OWN_STRATEGIES: readonly StrategyId[] = ['linear', 'free', 'autoregulated'];

function parseJson<T>(v: string | null): T | null {
  if (!v) return null;
  try {
    return JSON.parse(v) as T;
  } catch {
    return null;
  }
}

/** Les formats à soi (table `formats`), seulement ceux qui sont valides. */
export function readFormats(d: Db): Format[] {
  return d.all<{ id: string; spec: string }>('SELECT id, spec FROM formats ORDER BY created_at').flatMap((r) => {
    const f = parseJson<Format>(r.spec);
    return f && f.id === r.id && formatErrors(f).length === 0 ? [f] : [];
  });
}

interface SetRow {
  set_type: string;
  weight: number | null;
  reps: number | null;
  bar_speed: string | null;
  completed: number;
}

export function historyView(d: Db): HistoryView {
  return {
    lastSets(exerciseId, key) {
      const find = (same: boolean) =>
        d.first<{ id: string }>(
          `SELECT we.id FROM workout_exercises we JOIN workouts w ON w.id = we.workout_id
           WHERE we.exercise_id = ? AND w.status = 'completed' ${same ? 'AND we.progression_type = ?' : ''}
             AND EXISTS (SELECT 1 FROM sets s WHERE s.workout_exercise_id = we.id AND s.completed = 1)
           ORDER BY w.date DESC, w.started_at DESC LIMIT 1`,
          same ? [exerciseId, key] : [exerciseId],
        );
      const we = find(true) ?? find(false);
      if (!we) return [];
      return d
        .all<SetRow>('SELECT set_type, weight, reps, bar_speed, completed FROM sets WHERE workout_exercise_id = ? AND completed = 1 ORDER BY position', [we.id])
        .flatMap((s): HistorySet[] => {
          const setType = parseSetType(s.set_type);
          return s.weight !== null && s.reps !== null && setType !== 'warmup' ? [{ setType, weight: s.weight, reps: s.reps, barSpeed: parseBarSpeed(s.bar_speed) }] : [];
        });
    },
    refSets(exerciseId) {
      return d
        .all<Record<string, number | string | null>>(
          `SELECT w.id AS workout_id, w.date, w.started_at, w.week_index, w.is_deload, s.set_type, s.weight, s.reps,
             s.target_weight, s.target_reps, we.reference_e1rm, s.is_test,
             CASE WHEN e.load_type = 'bodyweight' THEN COALESCE(w.bodyweight, 0) ELSE 0 END AS bodyweight
           FROM sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id JOIN workouts w ON w.id = we.workout_id
             JOIN exercises e ON e.id = we.exercise_id
           WHERE we.exercise_id = ? AND s.completed = 1 AND s.set_type != 'warmup' AND s.weight IS NOT NULL AND s.reps > 0
           ORDER BY w.date, w.started_at, we.position, s.position`,
          [exerciseId],
        )
        .map(
          (r): RefSet => ({
            workoutId: String(r.workout_id),
            date: String(r.date),
            order: Number(r.started_at),
            weekIndex: r.week_index === null ? null : Number(r.week_index),
            isDeload: Number(r.is_deload) !== 0,
            setType: parseSetType(r.set_type),
            load: Number(r.weight) + Number(r.bodyweight),
            reps: Number(r.reps),
            targetLoad: r.target_weight === null ? null : Number(r.target_weight) + Number(r.bodyweight),
            targetReps: r.target_reps === null ? null : Number(r.target_reps),
            plannedRef: r.reference_e1rm === null ? null : Number(r.reference_e1rm),
            isTest: Number(r.is_test) !== 0,
            bodyweight: Number(r.bodyweight),
          }),
        );
    },
    typedOneRm(exerciseId) {
      const r = d.first<Record<string, unknown>>('SELECT exercise_id, value, mode, set_on FROM exercise_one_rm WHERE exercise_id = ?', [exerciseId]);
      return r ? toOneRm(r) : null;
    },
    bodyweight(date) {
      return d.first<{ value: number }>("SELECT value FROM body_entries WHERE metric = 'bodyweight' AND date <= ? ORDER BY date DESC, created_at DESC LIMIT 1", [date])?.value ?? null;
    },
  };
}

export interface LiftReference {
  name: string;
  /** Ce que l'écran montre : lest net pour un lesté, charge sur la barre sinon (jamais la masse totale). */
  shown: number;
  weighted: boolean;
  source: 'saisi' | 'estimé';
}

export interface Overview {
  workouts: number;
  sets: number;
  firstDate: string | null;
  lastDate: string | null;
  exercises: number;
  templates: number;
  blocks: number;
  bodyEntries: number;
  bodyweight: number | null;
  structure: Program['structure']['kind'];
  currentBlock: { name: string; week: number; of: number; deload: boolean } | null;
  capabilities: string[];
  lifts: LiftReference[];
  pending: number;
}

const count = (d: Db, sql: string) => d.first<{ n: number }>(sql)?.n ?? 0;

/** Le bilan de l'étape P1 : retrouve-t-on toutes ses séances, références et mesures ? */
export function overview(d: Db, today: string, pending: number): Overview {
  const program = readProgram(d);
  const history = historyView(d);
  const day = dayContext(program.structure, today);
  const range = d.first<{ a: string | null; b: string | null }>("SELECT MIN(date) AS a, MAX(date) AS b FROM workouts WHERE status = 'completed'");
  const bodyweight = history.bodyweight(today);
  // Les lifts au % du 1RM (ceux dont la référence pilote les charges), avec leur 1RM en lest net pour un lesté.
  const ids = [...new Set(program.sessions.flatMap((s) => s.slots.filter((x) => x.strategy.id === 'percent_reference').map((x) => x.exerciseId)))];
  const lifts = ids.flatMap((id): LiftReference[] => {
    const exercise = program.exercises.find((e) => e.id === id);
    if (!exercise) return [];
    const ref = referenceFor(program, history, exercise, today, bodyweight);
    if (!ref) return [];
    const weighted = exercise.loadType === 'bodyweight';
    const shown = Math.round((weighted ? ref.value - ref.basis.bodyweight : ref.value) * 10) / 10;
    return [{ name: exercise.name, shown, weighted, source: ref.basis.kind === 'manual' ? 'saisi' : 'estimé' }];
  });
  return {
    workouts: count(d, "SELECT COUNT(*) AS n FROM workouts WHERE status = 'completed'"),
    sets: count(d, 'SELECT COUNT(*) AS n FROM sets WHERE completed = 1'),
    firstDate: range?.a ?? null,
    lastDate: range?.b ?? null,
    exercises: count(d, 'SELECT COUNT(*) AS n FROM exercises WHERE archived = 0'),
    templates: count(d, 'SELECT COUNT(*) AS n FROM templates WHERE archived = 0'),
    blocks: count(d, 'SELECT COUNT(*) AS n FROM mesocycles'),
    bodyEntries: count(d, 'SELECT COUNT(*) AS n FROM body_entries'),
    bodyweight,
    structure: program.structure.kind,
    currentBlock: day.block && day.week ? { name: day.block.name, week: day.week.index, of: day.week.of, deload: day.week.deload } : null,
    capabilities: [...capabilities(program)].sort(),
    lifts,
    pending,
  };
}
