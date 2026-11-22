import {
  BUILTIN_FORMATS,
  DEFAULT_PLATES,
  DEFAULT_REST,
  dayContext,
  planSession,
  recalcBackoffs,
  typeForNewSet,
  weekday,
  type ExerciseCategory,
  type Format,
  type HistoryView,
  type Intention,
  type LoadType,
  type Program,
  type ProgressionType,
  type RestSettings,
  type SetType,
  type WorkoutSet,
} from '@mylife/training';
import { historyView, readFormats, readProgram } from './queries';
import { newId, type Db, type SqlValue } from './sql';

/**
 * La séance, côté Worker : démarrer (même lignes que l'app d'avant, pour que les deux lisent le même compte), lire
 * la séance en cours, écrire chaque série avant que l'écran avance, remplacer un exercice, terminer (sans double
 * effet), abandonner. Les règles sont celles de l'app d'avant : valider sans rien saisir accepte la prescription ; sans
 * 1RM de référence, les backoffs suivent le top set en direct ; à la fin, une série saisie sans ✓ compte comme faite.
 */

export interface SessionSet {
  id: string;
  position: number;
  setType: SetType;
  weight: number | null;
  reps: number | null;
  targetWeight: number | null;
  targetReps: number | null;
  targetRepsMax: number | null;
  /** Vitesse de barre, de 1 à 5 (indicative). */
  speed: number | null;
  durationS: number | null;
  rounds: number | null;
  note: string;
  completed: boolean;
}

export interface SessionItem {
  weId: string;
  exerciseId: string;
  name: string;
  loadType: LoadType;
  category: ExerciseCategory;
  equipment: string;
  intention: Intention;
  progression: ProgressionType;
  format: Format;
  group: { id: string; kind: 'superset' | 'circuit'; rounds: number } | null;
  /** % du 1RM du top set et des backoffs ce jour-là (lifts au % seulement). */
  percents: { top: number; backoff: number } | null;
  /** 1RM de référence tel qu'on le montre : lest net pour un lesté, jamais la masse totale. */
  reference: number | null;
  increment: number;
  backoffPercent: number;
  /** « Dernière fois » en une ligne. */
  lastTime: string | null;
  /** Ton commentaire sur cet exercice la dernière fois qu'il en avait un. */
  lastComment: string | null;
  /** La consigne du programme (créneau ou exercice). */
  note: string;
  /** Ton commentaire sur cet exercice, aujourd'hui. */
  comment: string;
  replaces: string | null;
  restSec: number | null;
  sets: SessionSet[];
}

export interface SessionDoc {
  id: string;
  name: string;
  date: string;
  startedAt: number;
  status: 'active' | 'completed';
  bodyweight: number | null;
  block: { name: string; week: number; of: number; deload: boolean } | null;
  rest: RestSettings;
  barWeight: number;
  plates: number[];
  items: SessionItem[];
}

interface SettingsLite {
  rest: RestSettings;
  barWeight: number;
  plates: number[];
  increment: number;
}

function settingsOf(d: Db): SettingsLite {
  const raw = d.first<{ value: string }>("SELECT value FROM settings WHERE key = 'app'")?.value;
  let s: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object') s = parsed as Record<string, unknown>;
  } catch {
    /* réglages illisibles : valeurs par défaut */
  }
  const num = (v: unknown, f: number) => (typeof v === 'number' && Number.isFinite(v) ? v : f);
  const rest = (s.rest ?? {}) as Partial<RestSettings>;
  return {
    rest: {
      floors: { ...DEFAULT_REST.floors, ...(rest.floors ?? {}) },
      byIntention: { ...DEFAULT_REST.byIntention, ...(rest.byIntention ?? {}) },
      warmup: num(rest.warmup, DEFAULT_REST.warmup),
    },
    barWeight: num(s.barWeight, 20),
    plates: Array.isArray(s.plates) && s.plates.every((p) => typeof p === 'number') ? (s.plates as number[]) : [...DEFAULT_PLATES],
    increment: num(s.increment, 2.5),
  };
}

const bool = (v: unknown) => v !== 0 && v !== null && v !== undefined;
const fmtKg = (v: number, weighted: boolean) => `${weighted && v > 0 ? '+' : ''}${v.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}`;

/** « 1×4 à 100 · 4×6 à 87,5 » : séries identiques regroupées. */
export function summarize(sets: readonly { weight: number; reps: number }[], weighted: boolean): string | null {
  const out: string[] = [];
  let i = 0;
  while (i < sets.length) {
    const s = sets[i]!;
    let n = 1;
    while (sets[i + n] && sets[i + n]!.weight === s.weight && sets[i + n]!.reps === s.reps) n++;
    out.push(`${n}×${s.reps} à ${fmtKg(s.weight, weighted)}`);
    i += n;
  }
  return out.length ? out.join(' · ') : null;
}

/** Vitesse de 1 à 5 → les trois niveaux de l'app d'avant (qui ne connaît que lente, normale, rapide). */
const legacySpeed = (speed: number | null): string | null => (speed === null ? null : speed <= 2 ? 'slow' : speed === 3 ? 'normal' : 'fast');
const speedOf = (speed: unknown, legacy: unknown): number | null =>
  typeof speed === 'number' ? speed : legacy === 'slow' ? 1 : legacy === 'normal' ? 3 : legacy === 'fast' ? 5 : null;

export function sessionOps(d: Db, today: () => string = () => new Date().toISOString().slice(0, 10)) {
  const history = (): HistoryView => historyView(d);

  function active(): string | null {
    return d.first<{ id: string }>("SELECT id FROM workouts WHERE status = 'active' ORDER BY started_at DESC LIMIT 1")?.id ?? null;
  }

  /** Démarre une séance (ou rend celle en cours : une seule à la fois). `templateId` null : séance libre. */
  function start(templateId: string | null, date: string = today()): string {
    const current = active();
    if (current) return current;
    const program = readProgram(d);
    const h = history();
    const id = newId();
    const now = Date.now();
    const day = dayContext(program.structure, date);
    const plan = templateId ? planSession(program, templateId, date, h) : null;
    const session = program.sessions.find((s) => s.id === templateId);
    const phase = day.modifiers.phase;
    d.transaction(() => {
      d.run(
        `INSERT INTO workouts (id, name, date, template_id, planned_id, mesocycle_id, week_index, is_deload, bodyweight, started_at, ended_at, status, notes)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, NULL, 'active', '')`,
        [id, session?.name ?? 'Séance libre', date, templateId, day.block?.id ?? null, phase && phase.kind !== 'before' ? phase.week : null, phase?.kind === 'deload' ? 1 : 0, h.bodyweight(date), now],
      );
      plan?.items.forEach((item, position) => {
        const weId = newId();
        const p = item.prescription;
        const params = item.slot.strategy.params as { repMin?: number | null; repMax?: number | null };
        const progression: ProgressionType = item.slot.strategy.id === 'percent_reference' ? 'top_set_backoff' : 'double_progression';
        d.run(
          `INSERT INTO workout_exercises (id, workout_id, exercise_id, position, progression_type, intention, rep_min, rep_max, backoff_percent, template_exercise_id, reference_e1rm, replaces_exercise_id, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, '')`,
          [
            weId,
            id,
            item.exercise.id,
            position,
            progression,
            item.slot.intention ?? (progression === 'top_set_backoff' ? 'strength' : 'hypertrophy'),
            params.repMin ?? item.exercise.repRangeMin,
            params.repMax ?? item.exercise.repRangeMax,
            p.backoffPercent,
            item.slot.id,
            item.reference?.value ?? null,
          ],
        );
        insertPlanned(weId, p.sets);
      });
    });
    return id;
  }

  function insertPlanned(weId: string, sets: readonly { setType: SetType; targetWeight: number | null; targetReps: number | null; targetRepsMax: number | null }[], from = 0) {
    sets.forEach((s, i) =>
      d.run(
        `INSERT INTO sets (id, workout_exercise_id, position, set_type, type_manual, weight, reps, target_weight, target_reps, target_reps_max, bar_speed, is_test, note, completed, completed_at)
         VALUES (?, ?, ?, ?, 0, NULL, NULL, ?, ?, ?, NULL, 0, '', 0, NULL)`,
        [newId(), weId, from + i, s.setType, s.targetWeight, s.targetReps, s.targetRepsMax],
      ),
    );
  }

  /** La séance telle que l'écran la montre. */
  function doc(id: string): SessionDoc | null {
    const w = d.first<Record<string, unknown>>('SELECT * FROM workouts WHERE id = ?', [id]);
    if (!w) return null;
    const program: Program = readProgram(d);
    const h = history();
    const settings = settingsOf(d);
    const date = String(w.date);
    const day = dayContext(program.structure, date);
    const bodyweight = typeof w.bodyweight === 'number' ? w.bodyweight : null;
    const plan = typeof w.template_id === 'string' ? planSession(program, w.template_id, date, h) : null;
    const wes = d.all<Record<string, unknown>>(
      `SELECT we.*, te.format_id, te.group_json, te.rest_sec, te.notes AS slot_notes FROM workout_exercises we
       LEFT JOIN template_exercises te ON te.id = we.template_exercise_id WHERE we.workout_id = ? ORDER BY we.position`,
      [id],
    );
    const items = wes.flatMap((we): SessionItem[] => {
      const exercise = program.exercises.find((e) => e.id === we.exercise_id);
      if (!exercise) return [];
      const weighted = exercise.loadType === 'bodyweight';
      const progression = we.progression_type === 'top_set_backoff' ? 'top_set_backoff' : 'double_progression';
      const planned = plan?.items.find((i) => i.slot.id === we.template_exercise_id && i.exercise.id === exercise.id);
      const sets = d.all<Record<string, unknown>>('SELECT * FROM sets WHERE workout_exercise_id = ? ORDER BY position', [String(we.id)]).map(
        (s): SessionSet => ({
          id: String(s.id),
          position: Number(s.position),
          setType: String(s.set_type) as SetType,
          weight: s.weight as number | null,
          reps: s.reps as number | null,
          targetWeight: s.target_weight as number | null,
          targetReps: s.target_reps as number | null,
          targetRepsMax: s.target_reps_max as number | null,
          speed: speedOf(s.speed, s.bar_speed),
          durationS: (s.duration_s as number | null) ?? null,
          rounds: (s.rounds as number | null) ?? null,
          note: String(s.note ?? ''),
          completed: bool(s.completed),
        }),
      );
      const last = h.lastSets(exercise.id, progression);
      let group: SessionItem['group'] = null;
      try {
        group = we.group_json ? (JSON.parse(String(we.group_json)) as SessionItem['group']) : null;
      } catch {
        group = null;
      }
      const ref = typeof we.reference_e1rm === 'number' ? we.reference_e1rm : null;
      return [
        {
          weId: String(we.id),
          exerciseId: exercise.id,
          name: exercise.name,
          loadType: exercise.loadType,
          category: exercise.category,
          equipment: exercise.equipment,
          intention: (String(we.intention) as Intention) ?? 'hypertrophy',
          progression,
          format: BUILTIN_FORMATS.find((f) => f.id === we.format_id) ?? program.formats.find((f) => f.id === we.format_id) ?? BUILTIN_FORMATS[0]!,
          group,
          percents: planned?.prescription.percents ?? null,
          reference: ref === null ? null : Math.round((weighted ? ref - (bodyweight ?? 0) : ref) * 10) / 10,
          increment: exercise.weightIncrement ?? settings.increment,
          backoffPercent: Number(we.backoff_percent),
          lastTime: summarize(last.filter((s) => s.setType !== 'warmup'), weighted),
          lastComment:
            d.first<{ notes: string }>(
              `SELECT we.notes FROM workout_exercises we JOIN workouts w ON w.id = we.workout_id
               WHERE we.exercise_id = ? AND w.status = 'completed' AND w.id != ? AND we.notes != '' ORDER BY w.date DESC, w.started_at DESC LIMIT 1`,
              [exercise.id, id],
            )?.notes ?? null,
          note: String(we.slot_notes || exercise.notes || ''),
          comment: String(we.notes ?? ''),
          replaces: typeof we.replaces_exercise_id === 'string' ? (program.exercises.find((e) => e.id === we.replaces_exercise_id)?.name ?? null) : null,
          restSec: typeof we.rest_sec === 'number' ? we.rest_sec : null,
          sets,
        },
      ];
    });
    return {
      id,
      name: String(w.name),
      date,
      startedAt: Number(w.started_at),
      status: w.status === 'active' ? 'active' : 'completed',
      bodyweight,
      block: day.block && day.week ? { name: day.block.name, week: day.week.index, of: day.week.of, deload: day.week.deload } : null,
      rest: settings.rest,
      barWeight: settings.barWeight,
      plates: settings.plates,
      items,
    };
  }

  /** Backoffs d'un lift sans 1RM de référence : ils suivent le top set tapé (règle de l'app d'avant). */
  function followTopSet(weId: string) {
    const we = d.first<Record<string, unknown>>(
      `SELECT we.progression_type, we.reference_e1rm, we.backoff_percent, e.weight_increment, e.load_type, w.bodyweight
       FROM workout_exercises we JOIN exercises e ON e.id = we.exercise_id JOIN workouts w ON w.id = we.workout_id WHERE we.id = ?`,
      [weId],
    );
    if (!we || we.progression_type !== 'top_set_backoff' || we.reference_e1rm !== null) return;
    const rows = d.all<Record<string, unknown>>('SELECT * FROM sets WHERE workout_exercise_id = ? ORDER BY position', [weId]);
    const sets = rows.map(
      (r) =>
        ({
          id: String(r.id),
          workoutExerciseId: weId,
          position: Number(r.position),
          setType: String(r.set_type) as SetType,
          typeManual: bool(r.type_manual),
          weight: r.weight as number | null,
          reps: r.reps as number | null,
          targetWeight: r.target_weight as number | null,
          targetReps: r.target_reps as number | null,
          targetRepsMax: r.target_reps_max as number | null,
          barSpeed: null,
          note: '',
          isTest: false,
          completed: bool(r.completed),
          completedAt: null,
        }) satisfies WorkoutSet,
    );
    const next = recalcBackoffs(sets, {
      percent: Number(we.backoff_percent),
      increment: typeof we.weight_increment === 'number' ? we.weight_increment : settingsOf(d).increment,
      bodyweight: we.load_type === 'bodyweight' ? (we.bodyweight as number | null) : null,
    });
    for (const s of next) if (s !== sets.find((x) => x.id === s.id)) d.run('UPDATE sets SET target_weight = ? WHERE id = ?', [s.targetWeight, s.id]);
  }

  const weOf = (setId: string) => d.first<{ we: string }>('SELECT workout_exercise_id AS we FROM sets WHERE id = ?', [setId])?.we ?? null;

  type SetPatch = Partial<{ weight: number | null; reps: number | null; speed: number | null; durationS: number | null; rounds: number | null; note: string }>;

  function update(setId: string, patch: SetPatch): void {
    const cols: string[] = [];
    const vals: SqlValue[] = [];
    const add = (c: string, v: SqlValue) => {
      cols.push(`${c} = ?`);
      vals.push(v);
    };
    if ('weight' in patch) add('weight', patch.weight ?? null);
    if ('reps' in patch) add('reps', patch.reps ?? null);
    if ('speed' in patch) {
      add('speed', patch.speed ?? null);
      add('bar_speed', legacySpeed(patch.speed ?? null));
    }
    if ('durationS' in patch) add('duration_s', patch.durationS ?? null);
    if ('rounds' in patch) add('rounds', patch.rounds ?? null);
    if ('note' in patch) add('note', (patch.note ?? '').trim().slice(0, 2000));
    if (!cols.length) return;
    d.transaction(() => {
      d.run(`UPDATE sets SET ${cols.join(', ')} WHERE id = ?`, [...vals, setId]);
      const we = weOf(setId);
      if (we && 'weight' in patch) followTopSet(we);
    });
  }

  /**
   * Valide une série : ce qui n'est pas saisi prend la prescription. Rend 'ok', ou ce qui manque (une série sans
   * prescription ni saisie ne se valide pas). Les formats au temps ou aux tours se valident sur leur grandeur.
   */
  function complete(setId: string, patch: SetPatch = {}): 'ok' | 'need-weight' | 'need-reps' | 'missing' {
    const s = d.first<Record<string, unknown>>(
      `SELECT s.*, te.format_id FROM sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id
       LEFT JOIN template_exercises te ON te.id = we.template_exercise_id WHERE s.id = ?`,
      [setId],
    );
    if (!s) return 'missing';
    const format = BUILTIN_FORMATS.find((f) => f.id === s.format_id) ?? readFormats(d).find((f) => f.id === s.format_id) ?? BUILTIN_FORMATS[0]!;
    const needsLoad = format.metrics.includes('load');
    const needsReps = format.metrics.includes('reps');
    const weight = 'weight' in patch ? (patch.weight ?? null) : ((s.weight as number | null) ?? (s.target_weight as number | null));
    const reps = 'reps' in patch ? (patch.reps ?? null) : ((s.reps as number | null) ?? (s.target_reps as number | null));
    if (needsLoad && weight === null) return 'need-weight';
    if (needsReps && reps === null) return 'need-reps';
    d.transaction(() => {
      update(setId, { ...patch, weight: needsLoad ? weight : (patch.weight ?? (s.weight as number | null)), reps: needsReps ? reps : (patch.reps ?? (s.reps as number | null)) });
      d.run('UPDATE sets SET completed = 1, completed_at = ? WHERE id = ?', [Date.now(), setId]);
    });
    return 'ok';
  }

  function uncomplete(setId: string): void {
    d.run('UPDATE sets SET completed = 0, completed_at = NULL WHERE id = ?', [setId]);
  }

  /** Une série de plus, sur le modèle de la dernière (prescription comprise). */
  function addSet(weId: string): void {
    const we = d.first<{ progression_type: string }>('SELECT progression_type FROM workout_exercises WHERE id = ?', [weId]);
    if (!we) return;
    const rows = d.all<Record<string, unknown>>('SELECT * FROM sets WHERE workout_exercise_id = ? ORDER BY position', [weId]);
    const last = rows[rows.length - 1];
    const progression = we.progression_type === 'top_set_backoff' ? 'top_set_backoff' : 'double_progression';
    const setType = typeForNewSet(rows.map((r) => ({ setType: String(r.set_type) as SetType })), progression);
    insertPlanned(weId, [{ setType, targetWeight: (last?.weight ?? last?.target_weight ?? null) as number | null, targetReps: (last?.target_reps ?? null) as number | null, targetRepsMax: (last?.target_reps_max ?? null) as number | null }], rows.length);
  }

  /** Retire une série, faite ou non (une erreur de saisie se corrige) ; les backoffs suivent le top set. */
  function removeSet(setId: string): void {
    const we = weOf(setId);
    d.transaction(() => {
      d.run('DELETE FROM sets WHERE id = ?', [setId]);
      if (we) followTopSet(we);
    });
  }

  const SET_TYPES: readonly SetType[] = ['warmup', 'top_set', 'backoff', 'working', 'drop'];
  /** Change la catégorie d'une série (échauffement, top set, backoff, série, drop) ; gardée comme choisie à la main. */
  function setType(setId: string, type: SetType): void {
    if (!SET_TYPES.includes(type)) throw new Error('Type de série inconnu');
    const we = weOf(setId);
    d.transaction(() => {
      d.run('UPDATE sets SET set_type = ?, type_manual = 1 WHERE id = ?', [type, setId]);
      if (we) followTopSet(we);
    });
  }

  /** Ton commentaire sur un exercice de la séance. */
  function exerciseComment(weId: string, text: string): void {
    d.run('UPDATE workout_exercises SET notes = ? WHERE id = ?', [text.trim().slice(0, 2000), weId]);
  }

  /**
   * Remplace un exercice : « aujourd'hui » (le créneau compte comme fait, le programme ne change pas) ou « le
   * programme » (la séance type prend le nouvel exercice dès la prochaine fois). Les séries faites restent ; les
   * autres prennent la prescription du nouvel exercice. Chaque exercice garde sa propre progression.
   */
  function replace(weId: string, exerciseId: string, scope: 'today' | 'program'): void {
    const we = d.first<Record<string, unknown>>('SELECT we.*, w.date, w.template_id FROM workout_exercises we JOIN workouts w ON w.id = we.workout_id WHERE we.id = ?', [weId]);
    if (!we || we.exercise_id === exerciseId) return;
    const program = readProgram(d);
    const exercise = program.exercises.find((e) => e.id === exerciseId);
    if (!exercise) return;
    d.transaction(() => {
      if (scope === 'program' && typeof we.template_exercise_id === 'string') d.run('UPDATE template_exercises SET exercise_id = ? WHERE id = ?', [exerciseId, we.template_exercise_id]);
      d.run('UPDATE workout_exercises SET exercise_id = ?, replaces_exercise_id = ? WHERE id = ?', [exerciseId, scope === 'today' ? String(we.exercise_id) : null, weId]);
      // La prescription du nouvel exercice pour les séries pas encore faites.
      const slotProgram: Program = {
        ...program,
        sessions: [
          {
            id: '_',
            name: '_',
            slots: [
              {
                id: String(we.template_exercise_id ?? weId),
                exerciseId,
                formatId: 'sets',
                strategy: we.progression_type === 'top_set_backoff' ? { id: 'percent_reference', params: {} } : { id: 'double_progression', params: { repMin: we.rep_min, repMax: we.rep_max } },
                group: null,
                intention: null,
                restSec: null,
                notes: '',
              },
            ],
          },
        ],
      };
      const item = planSession(slotProgram, '_', String(we.date), historyView(d))?.items[0];
      const done = d.first<{ n: number }>('SELECT COUNT(*) AS n FROM sets WHERE workout_exercise_id = ? AND completed = 1', [weId])?.n ?? 0;
      d.run('DELETE FROM sets WHERE workout_exercise_id = ? AND completed = 0', [weId]);
      if (item) {
        d.run('UPDATE workout_exercises SET reference_e1rm = ?, backoff_percent = ? WHERE id = ?', [item.reference?.value ?? null, item.prescription.backoffPercent, weId]);
        insertPlanned(weId, item.prescription.sets.slice(done), done);
      }
      d.run(
        `INSERT INTO exercise_substitutions (from_exercise_id, to_exercise_id, uses, last_used_at) VALUES (?, ?, 1, ?)
         ON CONFLICT(from_exercise_id, to_exercise_id) DO UPDATE SET uses = uses + 1, last_used_at = excluded.last_used_at`,
        [String(we.exercise_id), exerciseId, Date.now()],
      );
    });
  }

  /** Un exercice ajouté à la séance (séance libre, ou en plus du plan). */
  function addExercise(workoutId: string, exerciseId: string): void {
    const program = readProgram(d);
    const exercise = program.exercises.find((e) => e.id === exerciseId);
    const w = d.first<{ date: string }>('SELECT date FROM workouts WHERE id = ?', [workoutId]);
    if (!exercise || !w) return;
    const position = (d.first<{ p: number | null }>('SELECT MAX(position) AS p FROM workout_exercises WHERE workout_id = ?', [workoutId])?.p ?? -1) + 1;
    const progression = exercise.progressionType;
    const slotProgram: Program = {
      ...program,
      sessions: [{ id: '_', name: '_', slots: [{ id: '_', exerciseId, formatId: 'sets', strategy: progression === 'top_set_backoff' ? { id: 'percent_reference', params: {} } : { id: 'double_progression', params: {} }, group: null, intention: null, restSec: null, notes: '' }] }],
    };
    const item = planSession(slotProgram, '_', w.date, historyView(d))?.items[0];
    const weId = newId();
    d.transaction(() => {
      d.run(
        `INSERT INTO workout_exercises (id, workout_id, exercise_id, position, progression_type, intention, rep_min, rep_max, backoff_percent, template_exercise_id, reference_e1rm, replaces_exercise_id, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, '')`,
        [weId, workoutId, exerciseId, position, progression, progression === 'top_set_backoff' ? 'strength' : 'hypertrophy', exercise.repRangeMin, exercise.repRangeMax, item?.prescription.backoffPercent ?? exercise.backoffPercent, item?.reference?.value ?? null],
      );
      insertPlanned(weId, item?.prescription.sets ?? []);
    });
  }

  /** Poids du corps de la séance (lestés) : un repère modifiable. */
  function setBodyweight(workoutId: string, value: number | null): void {
    d.run('UPDATE workouts SET bodyweight = ? WHERE id = ?', [value, workoutId]);
  }

  /** Termine une séance en cours ; rien pour une séance inconnue ou déjà terminée. Rend si elle a été terminée ici. */
  function finish(workoutId: string): boolean {
    let done = false;
    d.transaction(() => {
      if (d.first<{ status: string }>('SELECT status FROM workouts WHERE id = ?', [workoutId])?.status !== 'active') return;
      const now = Date.now();
      const inWorkout = 'workout_exercise_id IN (SELECT id FROM workout_exercises WHERE workout_id = ?)';
      d.run(`UPDATE sets SET completed = 1, completed_at = ? WHERE completed = 0 AND weight IS NOT NULL AND reps IS NOT NULL AND ${inWorkout}`, [now, workoutId]);
      d.run(`DELETE FROM sets WHERE completed = 0 AND ${inWorkout}`, [workoutId]);
      d.run("DELETE FROM workout_exercises WHERE workout_id = ? AND notes = '' AND id NOT IN (SELECT DISTINCT workout_exercise_id FROM sets)", [workoutId]);
      d.run("UPDATE workouts SET status = 'completed', ended_at = ? WHERE id = ?", [now, workoutId]);
      done = true;
    });
    return done;
  }

  function discard(workoutId: string): void {
    d.transaction(() => {
      d.run('DELETE FROM sets WHERE workout_exercise_id IN (SELECT id FROM workout_exercises WHERE workout_id = ?)', [workoutId]);
      d.run('DELETE FROM workout_exercises WHERE workout_id = ?', [workoutId]);
      d.run('UPDATE planned_sessions SET workout_id = NULL WHERE workout_id = ?', [workoutId]);
      d.run('DELETE FROM workouts WHERE id = ?', [workoutId]);
    });
  }

  /** Pour démarrer : les séances types, celles prévues aujourd'hui d'abord (semaine type). */
  function startOptions(date: string = today()): { today: { id: string; name: string }[]; others: { id: string; name: string }[]; active: string | null } {
    const program = readProgram(d);
    const day = weekday(date);
    const todayIds = program.structure.pattern.filter((p) => p.weekday === day).map((p) => p.templateId);
    const live = d.all<{ id: string }>('SELECT id FROM templates WHERE archived = 0').map((r) => r.id);
    const sessions = program.sessions.filter((s) => live.includes(s.id)).map((s) => ({ id: s.id, name: s.name }));
    return { today: sessions.filter((s) => todayIds.includes(s.id)), others: sessions.filter((s) => !todayIds.includes(s.id)), active: active() };
  }

  /** Exercices pour remplacer ou ajouter : ceux déjà faits à la place d'abord, puis les mêmes muscles, puis le reste. */
  function exerciseChoices(forExerciseId: string | null): { id: string; name: string; detail: string }[] {
    const program = readProgram(d);
    const base = program.exercises.find((e) => e.id === forExerciseId);
    const subs = forExerciseId ? d.all<{ to_exercise_id: string; uses: number }>('SELECT to_exercise_id, uses FROM exercise_substitutions WHERE from_exercise_id = ? ORDER BY uses DESC', [forExerciseId]) : [];
    const live = program.exercises.filter((e) => !e.archived && e.id !== forExerciseId);
    const rank = (e: (typeof live)[number]) => {
      const sub = subs.find((s) => s.to_exercise_id === e.id);
      if (sub) return { score: 0, detail: `${sub.uses} fois à la place` };
      if (base && e.primaryMuscles.some((m) => base.primaryMuscles.includes(m))) return { score: 1, detail: 'mêmes muscles' };
      return { score: 2, detail: '' };
    };
    return live
      .map((e) => ({ e, r: rank(e) }))
      .sort((a, b) => a.r.score - b.r.score || a.e.name.localeCompare(b.e.name, 'fr'))
      .map(({ e, r }) => ({ id: e.id, name: e.name, detail: r.detail }));
  }

  return { active, start, doc, update, complete, uncomplete, addSet, removeSet, setType, exerciseComment, replace, addExercise, setBodyweight, finish, discard, startOptions, exerciseChoices };
}
