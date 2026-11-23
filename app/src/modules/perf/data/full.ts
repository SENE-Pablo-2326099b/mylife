import { guessExercise, matchExercise, type LibraryEntry } from '@mylife/training';
import { exportProgram } from './importer';
import { newId, type Db } from './sql';

/**
 * « Tout exporter (JSON complet) » et sa fusion au réimport (23/11), côté Worker. Le fichier reprend le format d'un
 * programme (séances types et créneaux avec leurs identifiants, cycles complets, 1RM) et y ajoute : la bibliothèque à toi
 * (`library`), les réglages (`settings`), les 1RM datés, et l'historique (`history`) : chaque séance faite avec sa date,
 * son jour, son bloc et sa semaine, chaque exercice et chaque série (charge ou lest, reps, temps, distance, tours,
 * vitesse, RPE, RIR, commentaire), les mesures, les séances décalées. Réimporté (même retouché par toi ou par une IA) :
 * tout se fusionne par identifiant (ou par date et nom pour une séance sans identifiant), rien n'est dupliqué, rien de
 * l'historique n'est effacé.
 */

const DAY = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const ID = /^[A-Za-z0-9_.:-]{1,80}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
const json = (v: string | null): unknown => {
  try {
    return v === null ? null : JSON.parse(v);
  } catch {
    return v;
  }
};

type Row = Record<string, unknown>;

export function exportFull(d: Db, now = new Date()): Record<string, unknown> {
  const program = exportProgram(d, 'Toutes mes données MyPerf') as unknown as Record<string, unknown>;
  const ex = new Map(d.all<{ id: string; name: string }>('SELECT id, name FROM exercises').map((e) => [e.id, e.name]));
  const templates = new Map(d.all<{ id: string; name: string }>('SELECT id, name FROM templates').map((t) => [t.id, t.name]));
  const blocks = new Map(d.all<{ id: string; name: string }>('SELECT id, name FROM mesocycles').map((m) => [m.id, m.name]));
  // Tes exercices, et ceux de la bibliothèque que tu utilises (séances types, historique, 1RM) : un compte neuf les
  // retrouve avec les mêmes identifiants.
  const library = d
    .all<Row>(
      `SELECT * FROM exercises WHERE is_custom = 1 OR id IN (SELECT exercise_id FROM template_exercises UNION SELECT exercise_id FROM workout_exercises UNION SELECT exercise_id FROM exercise_one_rm)
       ORDER BY is_custom, created_at`,
    )
    .map((e) => ({
    id: e.id,
    name: e.name,
    ...(e.is_custom ? {} : { custom: false }),
    equipment: e.equipment,
    muscles: json(e.primary_muscles as string),
    secondary: json(e.secondary_muscles as string),
    bodyweight: e.load_type === 'bodyweight',
    category: e.category,
    progression: e.progression_type,
    unilateral: !!e.unilateral,
    reps: `${e.rep_range_min}-${e.rep_range_max}`,
    ...(e.weight_increment !== null ? { increment: e.weight_increment } : {}),
    ...(e.variant_of ? { variantOf: ex.get(e.variant_of as string) ?? e.variant_of } : {}),
    ...(e.notes ? { notes: e.notes } : {}),
    ...(e.archived ? { archived: true } : {}),
  }));
  const settings = Object.fromEntries(d.all<{ key: string; value: string }>('SELECT key, value FROM settings').map((s) => [s.key, json(s.value)]));
  const oneRepMaxes = d
    .all<{ exercise_id: string; value: number; set_on: string }>("SELECT exercise_id, value, set_on FROM exercise_one_rm WHERE mode = 'manual'")
    .flatMap((r) => (ex.has(r.exercise_id) ? [{ exercise: ex.get(r.exercise_id)!, kg: r.value, date: r.set_on }] : []));
  const sets = d.all<Row>(
    `SELECT s.* FROM sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id JOIN workouts w ON w.id = we.workout_id
     WHERE w.status = 'completed' AND s.completed = 1 ORDER BY s.position`,
  );
  const wes = d.all<Row>("SELECT we.* FROM workout_exercises we JOIN workouts w ON w.id = we.workout_id WHERE w.status = 'completed' ORDER BY we.position");
  const sessions = d.all<Row>("SELECT * FROM workouts WHERE status = 'completed' ORDER BY date, started_at").map((w) => ({
    id: w.id,
    date: w.date,
    day: DAY[(new Date(`${w.date as string}T12:00:00`).getDay() + 6) % 7],
    name: w.name,
    ...(w.template_id ? { session: templates.get(w.template_id as string) ?? null, sessionId: w.template_id } : {}),
    ...(w.mesocycle_id ? { block: blocks.get(w.mesocycle_id as string) ?? null, blockId: w.mesocycle_id } : {}),
    ...(w.week_index !== null ? { week: w.week_index } : {}),
    ...(w.is_deload ? { deload: true } : {}),
    ...(w.bodyweight !== null ? { bodyweight: w.bodyweight } : {}),
    startedAt: iso(w.started_at as number),
    endedAt: iso(w.ended_at as number | null),
    ...(w.rating !== null && w.rating !== undefined ? { form: w.rating } : {}),
    ...(w.notes ? { notes: w.notes } : {}),
    exercises: wes
      .filter((we) => we.workout_id === w.id)
      .map((we) => ({
        id: we.id,
        exercise: ex.get(we.exercise_id as string) ?? '?',
        exerciseId: we.exercise_id,
        ...(we.template_exercise_id ? { slotId: we.template_exercise_id } : {}),
        ...(we.replaces_exercise_id ? { replaces: ex.get(we.replaces_exercise_id as string) ?? null } : {}),
        ...(we.notes ? { notes: we.notes } : {}),
        sets: sets
          .filter((s) => s.workout_exercise_id === we.id)
          .map((s) => ({
            id: s.id,
            type: s.set_type,
            ...(s.weight !== null ? { kg: s.weight } : {}),
            ...(s.reps !== null ? { reps: s.reps } : {}),
            ...(s.duration_s !== null && s.duration_s !== undefined ? { seconds: s.duration_s } : {}),
            ...(s.distance_m !== null && s.distance_m !== undefined ? { meters: s.distance_m } : {}),
            ...(s.rounds !== null && s.rounds !== undefined ? { rounds: s.rounds } : {}),
            ...(s.speed !== null && s.speed !== undefined ? { speed: s.speed } : s.bar_speed ? { speed: s.bar_speed } : {}),
            ...(s.rpe !== null && s.rpe !== undefined ? { rpe: s.rpe } : {}),
            ...(s.rir !== null && s.rir !== undefined ? { rir: s.rir } : {}),
            ...(s.note ? { note: s.note } : {}),
          })),
      })),
  }));
  return {
    ...program,
    name: 'Toutes mes données MyPerf',
    exportedAt: now.toISOString(),
    notes: 'Charges des lestés : le lest (sans le poids du corps). Identifiants : à garder pour que le réimport mette à jour au lieu de dupliquer.',
    library,
    settings,
    oneRepMaxes,
    history: {
      sessions,
      measures: d.all<{ id: string; date: string; metric: string; value: number }>('SELECT id, date, metric, value FROM body_entries ORDER BY date').map((m) => ({ id: m.id, date: m.date, metric: m.metric, value: m.value })),
      moves: d
        .all<{ id: string; template_id: string; from_date: string; to_date: string }>('SELECT id, template_id, from_date, to_date FROM session_moves ORDER BY from_date')
        .map((m) => ({ id: m.id, sessionId: m.template_id, session: templates.get(m.template_id) ?? null, from: m.from_date, to: m.to_date })),
    },
  };
}

// ---------------------------------------------------------------- lecture et fusion

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v) : '');
const num = (v: unknown, min: number, max: number): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.replace(',', '.')) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};
const idOf = (v: unknown) => (typeof v === 'string' && ID.test(v) ? v : null);
const ms = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v !== 'string' || !v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};
const SET_TYPES = ['warmup', 'top_set', 'backoff', 'working', 'drop'];
const TYPE_WORDS: Record<string, string> = { top: 'top_set', topset: 'top_set', backoffs: 'backoff', serie: 'working', series: 'working', echauffement: 'warmup', degressive: 'drop' };
const setType = (v: unknown) => {
  const k = str(v).toLowerCase().normalize('NFD').replace(/[̀-ͯ\s_-]/g, '');
  const t = SET_TYPES.find((x) => x.replace('_', '') === k) ?? TYPE_WORDS[k];
  return t ?? 'working';
};

export interface FullRaw {
  library: Row[];
  settings: Record<string, unknown> | null;
  sessions: Row[];
  measures: Row[];
  moves: Row[];
}

/** La partie « tout » d'un fichier (bibliothèque, réglages, historique) ; null si ce n'est qu'un programme. */
export function readFull(raw: unknown): FullRaw | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Row;
  const h = o.history && typeof o.history === 'object' ? (o.history as Row) : null;
  const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is Row => !!x && typeof x === 'object') : []);
  const full: FullRaw = {
    library: arr(o.library),
    settings: o.settings && typeof o.settings === 'object' && !Array.isArray(o.settings) && Object.keys(o.settings).length ? (o.settings as Record<string, unknown>) : null,
    sessions: arr(h?.sessions),
    measures: arr(h?.measures),
    moves: arr(h?.moves),
  };
  return full.library.length || full.settings || full.sessions.length || full.measures.length || full.moves.length ? full : null;
}

/** Les exercices de la bibliothèque du fichier, comme entrées de rapprochement (avant qu'ils existent). */
export const fileLibrary = (full: FullRaw | null): LibraryEntry[] => (full?.library ?? []).flatMap((e) => (idOf(e.id) && str(e.name) ? [{ id: idOf(e.id)!, name: str(e.name, 80) }] : []));

/** Une séance du fichier : celle qui existe déjà (par identifiant, sinon même date et même nom), ou null. */
function existingWorkout(d: Db, w: Row): string | null {
  const id = idOf(w.id);
  if (id && d.first('SELECT 1 FROM workouts WHERE id = ?', [id])) return id;
  const date = str(w.date, 10);
  return d.first<{ id: string }>("SELECT id FROM workouts WHERE date = ? AND name = ? AND status = 'completed' ORDER BY started_at LIMIT 1", [date, str(w.name, 60)])?.id ?? null;
}

export interface FullPreview {
  library: { added: number; updated: number };
  sessions: { added: number; updated: number; ignored: number };
  measures: number;
  moves: number;
  settings: boolean;
}

export function previewFull(d: Db, full: FullRaw): FullPreview {
  let added = 0;
  let updated = 0;
  let ignored = 0;
  for (const w of full.sessions) {
    if (!DATE.test(str(w.date, 10)) || !Array.isArray(w.exercises)) ignored += 1;
    else if (existingWorkout(d, w)) updated += 1;
    else added += 1;
  }
  const libIds = fileLibrary(full);
  const known = libIds.filter((e) => d.first('SELECT 1 FROM exercises WHERE id = ?', [e.id])).length;
  return { library: { added: libIds.length - known, updated: known }, sessions: { added, updated, ignored }, measures: full.measures.length, moves: full.moves.length, settings: !!full.settings };
}

/** La bibliothèque à toi : mise à jour par identifiant, sinon créée avec l'identifiant du fichier. */
export function applyLibrary(d: Db, full: FullRaw): number {
  let n = 0;
  const all = () => d.all<{ id: string; name: string }>('SELECT id, name FROM exercises');
  for (const e of full.library) {
    const id = idOf(e.id);
    const name = str(e.name, 80);
    if (!id || !name) continue;
    const reps = /^(\d+)\s*-\s*(\d+)$/.exec(str(e.reps));
    const g = guessExercise(name, { bodyweight: e.bodyweight === true });
    const muscles = Array.isArray(e.muscles) && e.muscles.length ? e.muscles.map(String) : g.primaryMuscles.length ? g.primaryMuscles : ['chest'];
    const variant = str(e.variantOf, 80);
    const variantOf = variant ? (idOf(variant) && all().some((x) => x.id === variant) ? variant : (matchExercise(variant, all()).exerciseId ?? null)) : null;
    const category = ['main', 'compound', 'isolation'].includes(str(e.category)) ? str(e.category) : g.category;
    const progression = str(e.progression) === 'top_set_backoff' || (!e.progression && category === 'main') ? 'top_set_backoff' : 'double_progression';
    d.run(
      `INSERT INTO exercises (id, name, primary_muscles, secondary_muscles, equipment, unilateral, load_type, category, progression_type, backoff_percent, rep_range_min, rep_range_max, weight_increment, is_custom, archived, notes, created_at, variant_of)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0.8, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, primary_muscles = excluded.primary_muscles, secondary_muscles = excluded.secondary_muscles, equipment = excluded.equipment,
         unilateral = excluded.unilateral, load_type = excluded.load_type, category = excluded.category, progression_type = excluded.progression_type, rep_range_min = excluded.rep_range_min,
         rep_range_max = excluded.rep_range_max, weight_increment = excluded.weight_increment, archived = excluded.archived, notes = excluded.notes, variant_of = excluded.variant_of`,
      [
        id,
        name,
        JSON.stringify(muscles),
        JSON.stringify(Array.isArray(e.secondary) ? e.secondary.map(String) : []),
        str(e.equipment) || g.equipment,
        e.unilateral === true ? 1 : 0,
        e.bodyweight === true ? 'bodyweight' : 'external',
        category,
        progression,
        reps ? Number(reps[1]) : 3,
        reps ? Number(reps[2]) : 8,
        num(e.increment, 0.1, 50),
        e.custom === false ? 0 : 1,
        e.archived === true ? 1 : 0,
        str(e.notes, 1000),
        Date.now(),
        variantOf,
      ],
    );
    n += 1;
  }
  return n;
}

export function applySettings(d: Db, full: FullRaw): void {
  for (const [key, value] of Object.entries(full.settings ?? {})) {
    if (!/^[A-Za-z0-9_.:-]{1,60}$/.test(key) || value === undefined) continue;
    d.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, typeof value === 'string' ? value : JSON.stringify(value)]);
  }
}

/** L'exercice d'une ligne d'historique : par identifiant, par nom, sinon un exercice à toi créé pour elle. */
function exerciseFor(d: Db, e: Row): string {
  const id = idOf(e.exerciseId);
  if (id && d.first('SELECT 1 FROM exercises WHERE id = ?', [id])) return id;
  const name = str(e.exercise, 80) || 'Exercice';
  const library = d.all<{ id: string; name: string }>('SELECT id, name FROM exercises WHERE archived = 0');
  const found = matchExercise(name, library).exerciseId;
  if (found) return found;
  const g = guessExercise(name);
  const created = `ex_${newId()}`;
  d.run(
    `INSERT INTO exercises (id, name, primary_muscles, secondary_muscles, equipment, unilateral, load_type, category, progression_type, backoff_percent, rep_range_min, rep_range_max, weight_increment, is_custom, archived, notes, created_at)
     VALUES (?, ?, ?, '[]', ?, 0, ?, ?, 'double_progression', 0.8, 8, 12, NULL, 1, 0, '', ?)`,
    [created, name, JSON.stringify(g.primaryMuscles.length ? g.primaryMuscles : ['chest']), g.equipment, g.loadType, g.category, Date.now()],
  );
  return created;
}

/** L'historique fusionné : séances (mises à jour ou ajoutées, jamais effacées), mesures, décalages. */
export function applyHistory(d: Db, full: FullRaw): { added: number; updated: number; measures: number; moves: number } {
  const out = { added: 0, updated: 0, measures: 0, moves: 0 };
  for (const w of full.sessions) {
    const date = str(w.date, 10);
    if (!DATE.test(date) || !Array.isArray(w.exercises)) continue;
    const existing = existingWorkout(d, w);
    const fileId = idOf(w.id);
    const id = existing ?? (fileId && !d.first('SELECT 1 FROM workouts WHERE id = ?', [fileId]) ? fileId : newId());
    const started = ms(w.startedAt) ?? Date.parse(`${date}T12:00:00`);
    const ended = ms(w.endedAt);
    const sessionId = idOf(w.sessionId);
    const templateId = sessionId && d.first('SELECT 1 FROM templates WHERE id = ?', [sessionId]) ? sessionId : null;
    const fileBlock = idOf(w.blockId);
    const blockId = fileBlock && d.first('SELECT 1 FROM mesocycles WHERE id = ?', [fileBlock]) ? fileBlock : null;
    const values = [str(w.name, 60) || 'Séance', date, templateId, blockId, num(w.week, 1, 20), w.deload === true ? 1 : 0, num(w.bodyweight, 20, 400), started, ended, str(w.notes, 2000), num(w.form, 1, 5)];
    if (existing) {
      d.run(
        `UPDATE workouts SET name = ?, date = ?, template_id = COALESCE(?, template_id), mesocycle_id = COALESCE(?, mesocycle_id), week_index = ?, is_deload = ?, bodyweight = ?,
           started_at = ?, ended_at = ?, notes = ?, rating = ?, status = 'completed' WHERE id = ?`,
        [...values, id],
      );
      out.updated += 1;
    } else {
      d.run(
        `INSERT INTO workouts (id, name, date, template_id, planned_id, mesocycle_id, week_index, is_deload, bodyweight, started_at, ended_at, status, notes, rating)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 'completed', ?, ?)`,
        [id, ...values],
      );
      out.added += 1;
    }
    // Ses exercices et ses séries : ceux du fichier, dans son ordre ; ceux qui n'y sont plus partent.
    const keptWe = new Set<string>();
    (w.exercises as unknown[]).forEach((raw, position) => {
      if (!raw || typeof raw !== 'object') return;
      const e = raw as Row;
      const exerciseId = exerciseFor(d, e);
      const ex = d.first<{ progression_type: string; rep_range_min: number; rep_range_max: number; backoff_percent: number; category: string }>('SELECT progression_type, rep_range_min, rep_range_max, backoff_percent, category FROM exercises WHERE id = ?', [exerciseId])!;
      const weIdFile = idOf(e.id);
      const weOld = weIdFile ? d.first<{ id: string; workout_id: string }>('SELECT id, workout_id FROM workout_exercises WHERE id = ?', [weIdFile]) : null;
      const weId = weOld && weOld.workout_id === id ? weOld.id : weIdFile && !weOld ? weIdFile : newId();
      const fileSlot = idOf(e.slotId);
      const slot = fileSlot && d.first('SELECT 1 FROM template_exercises WHERE id = ?', [fileSlot]) ? fileSlot : null;
      const replaces = str(e.replaces, 80) ? matchExercise(str(e.replaces, 80), d.all<{ id: string; name: string }>('SELECT id, name FROM exercises')).exerciseId : null;
      d.run(
        `INSERT INTO workout_exercises (id, workout_id, exercise_id, position, progression_type, intention, rep_min, rep_max, backoff_percent, template_exercise_id, reference_e1rm, replaces_exercise_id, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
         ON CONFLICT(id) DO UPDATE SET exercise_id = excluded.exercise_id, position = excluded.position, template_exercise_id = COALESCE(excluded.template_exercise_id, template_exercise_id),
           replaces_exercise_id = excluded.replaces_exercise_id, notes = excluded.notes`,
        [weId, id, exerciseId, position, ex.progression_type, ex.progression_type === 'top_set_backoff' || ex.category === 'main' ? 'strength' : 'hypertrophy', ex.rep_range_min, ex.rep_range_max, ex.backoff_percent, slot, replaces, str(e.notes, 2000)],
      );
      keptWe.add(weId);
      const keptSets = new Set<string>();
      (Array.isArray(e.sets) ? e.sets : []).forEach((sr, k) => {
        if (!sr || typeof sr !== 'object') return;
        const s = sr as Row;
        const sIdFile = idOf(s.id);
        const sOld = sIdFile ? d.first<{ id: string; workout_exercise_id: string }>('SELECT id, workout_exercise_id FROM sets WHERE id = ?', [sIdFile]) : null;
        const sId = sOld && sOld.workout_exercise_id === weId ? sOld.id : sIdFile && !sOld ? sIdFile : newId();
        const speedNum = num(s.speed, 1, 5);
        d.run(
          `INSERT INTO sets (id, workout_exercise_id, position, set_type, type_manual, weight, reps, target_weight, target_reps, target_reps_max, bar_speed, is_test, note, completed, completed_at, duration_s, distance_m, rounds, rpe, rir, speed)
           VALUES (?, ?, ?, ?, 1, ?, ?, NULL, NULL, NULL, ?, 0, ?, 1, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET position = excluded.position, set_type = excluded.set_type, weight = excluded.weight, reps = excluded.reps, bar_speed = excluded.bar_speed,
             note = excluded.note, completed = 1, duration_s = excluded.duration_s, distance_m = excluded.distance_m, rounds = excluded.rounds, rpe = excluded.rpe, rir = excluded.rir, speed = excluded.speed`,
          [
            sId,
            weId,
            k,
            setType(s.type),
            num(s.kg, -500, 1000),
            num(s.reps, 0, 1000),
            speedNum === null && ['fast', 'normal', 'slow'].includes(str(s.speed)) ? str(s.speed) : null,
            str(s.note, 500),
            ended ?? started,
            num(s.seconds, 0, 86400),
            num(s.meters, 0, 1e6),
            num(s.rounds, 0, 1000),
            num(s.rpe, 1, 10),
            num(s.rir, 0, 10),
            speedNum,
          ],
        );
        keptSets.add(sId);
      });
      for (const old of d.all<{ id: string }>('SELECT id FROM sets WHERE workout_exercise_id = ?', [weId])) if (!keptSets.has(old.id)) d.run('DELETE FROM sets WHERE id = ?', [old.id]);
    });
    for (const old of d.all<{ id: string }>('SELECT id FROM workout_exercises WHERE workout_id = ?', [id])) {
      if (keptWe.has(old.id)) continue;
      d.run('DELETE FROM sets WHERE workout_exercise_id = ?', [old.id]);
      d.run('DELETE FROM workout_exercises WHERE id = ?', [old.id]);
    }
  }
  // Mesures : par identifiant, sinon même mesure le même jour.
  for (const m of full.measures) {
    const date = str(m.date, 10);
    const metric = str(m.metric, 40) || 'bodyweight';
    const value = num(m.value ?? m.kg, -1e6, 1e6);
    if (!DATE.test(date) || value === null) continue;
    const mId = idOf(m.id);
    const id = (mId && d.first<{ id: string }>('SELECT id FROM body_entries WHERE id = ?', [mId])?.id) || d.first<{ id: string }>('SELECT id FROM body_entries WHERE metric = ? AND date = ?', [metric, date])?.id;
    if (id) d.run('UPDATE body_entries SET date = ?, metric = ?, value = ? WHERE id = ?', [date, metric, value, id]);
    else d.run('INSERT INTO body_entries (id, date, metric, value, created_at) VALUES (?, ?, ?, ?, ?)', [idOf(m.id) ?? newId(), date, metric, value, Date.now()]);
    out.measures += 1;
  }
  // Décalages : par identifiant, sinon la même séance au même jour d'origine.
  for (const mv of full.moves) {
    const templateId = idOf(mv.sessionId);
    const from = str(mv.from, 10);
    const to = str(mv.to, 10);
    if (!templateId || !DATE.test(from) || !DATE.test(to) || !d.first('SELECT 1 FROM templates WHERE id = ?', [templateId])) continue;
    const mvId = idOf(mv.id);
    const id = (mvId && d.first<{ id: string }>('SELECT id FROM session_moves WHERE id = ?', [mvId])?.id) || d.first<{ id: string }>('SELECT id FROM session_moves WHERE template_id = ? AND from_date = ?', [templateId, from])?.id;
    if (id) d.run('UPDATE session_moves SET template_id = ?, from_date = ?, to_date = ? WHERE id = ?', [templateId, from, to, id]);
    else d.run('INSERT INTO session_moves (id, template_id, from_date, to_date, created_at) VALUES (?, ?, ?, ?, ?)', [idOf(mv.id) ?? newId(), templateId, from, to, Date.now()]);
    out.moves += 1;
  }
  return out;
}
