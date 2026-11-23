import { BUILTIN_FORMATS, estimate1RM, referenceFor, type Exercise, type HistoryView, type Program } from '@mylife/training';
import { createExercise } from './day';
import { historyView, readProgram } from './queries';
import { summarize } from './session';
import type { Db } from './sql';

/**
 * Les exercices de MyPerf, côté Worker (maquettes V3-Exercices et V3-Fiche, validées le 22/11) : la bibliothèque
 * (ceux du programme d'abord, avec leur repère : 1RM de référence, meilleure série ou record de temps), les variantes et
 * les formats à soi ; la fiche d'un exercice (1RM de référence au même niveau que l'estimé, proposition de mise à jour,
 * courbe, charges de travail, records, historique). Lest net partout pour un lesté, jamais la masse totale.
 */

const EQUIPMENT: Record<string, string> = { barbell: 'barre', dumbbell: 'haltères', machine: 'machine', cable: 'poulie', bodyweight: 'poids du corps', kettlebell: 'kettlebell', band: 'élastique', other: 'autre' };
const MUSCLE: Record<string, string> = {
  chest: 'pectoraux', back: 'dos', lats: 'grand dorsal', traps: 'trapèzes', shoulders: 'épaules', rear_delts: 'arrière d’épaule', biceps: 'biceps', triceps: 'triceps',
  forearms: 'avant-bras', abs: 'abdos', lower_back: 'lombaires', glutes: 'fessiers', quads: 'quadriceps', hamstrings: 'ischios', adductors: 'adducteurs', calves: 'mollets',
};
const kg = (v: number, weighted: boolean) => `${weighted && v > 0 ? '+' : ''}${v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}`;
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const shortDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
const live = (d: Db) => new Set(d.all<{ id: string }>('SELECT id FROM templates WHERE archived = 0').map((r) => r.id));

/** « lest · dos, biceps », « barre · quadriceps, fessiers ». */
function kicker(e: Exercise): string {
  const kind = e.loadType === 'bodyweight' ? (e.category === 'main' ? 'lest' : 'poids du corps') : (EQUIPMENT[e.equipment] ?? e.equipment);
  return [kind, e.primaryMuscles.map((m) => MUSCLE[m] ?? m).join(', ')].filter(Boolean).join(' · ');
}

interface DoneSet {
  date: string;
  workout: string;
  weight: number | null;
  reps: number | null;
  duration: number | null;
  bodyweight: number;
}

function doneSets(d: Db, exerciseId: string): DoneSet[] {
  return d.all<DoneSet>(
    `SELECT w.date AS date, w.id AS workout, s.weight AS weight, s.reps AS reps, s.duration_s AS duration, COALESCE(w.bodyweight, 0) AS bodyweight
     FROM sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id JOIN workouts w ON w.id = we.workout_id
     WHERE we.exercise_id = ? AND w.status = 'completed' AND s.completed = 1 AND s.set_type != 'warmup'
     ORDER BY w.date, w.started_at, s.position`,
    [exerciseId],
  );
}

/** Le 1RM montré : lest net pour un lesté. `ignoreTyped` : l'estimation de l'historique seule. */
function reference(program: Program, h: HistoryView, e: Exercise, date: string, ignoreTyped = false) {
  const history: HistoryView = ignoreTyped ? { ...h, typedOneRm: () => null } : h;
  const ref = referenceFor(program, history, e, date, h.bodyweight(date));
  if (!ref) return null;
  const value = Math.round((e.loadType === 'bodyweight' ? ref.value - ref.basis.bodyweight : ref.value) * 10) / 10;
  return { value, total: ref.value, source: ref.basis.kind === 'manual' ? ('saisi' as const) : ('estimé' as const), date: ref.basis.date };
}

/** La meilleure série (e1RM le plus haut, masse totale pour un lesté), comme on l'a notée. */
function bestSet(sets: readonly DoneSet[], weighted: boolean): DoneSet | null {
  let best: DoneSet | null = null;
  let score = 0;
  for (const s of sets) {
    if (s.weight === null || s.reps === null || s.reps <= 0) continue;
    const v = estimate1RM(s.weight + (weighted ? s.bodyweight : 0), s.reps);
    if (v > score) [best, score] = [s, v];
  }
  return best;
}

export interface ExerciseLine {
  id: string;
  name: string;
  detail: string;
  /** Pour les filtres : barbell, bodyweight, weighted, time, mine. */
  kinds: string[];
  value: string | null;
  valueLabel: string | null;
}

export interface ExercisesView {
  total: number;
  formats: number;
  inProgram: ExerciseLine[];
  variants: { id: string; href: string; name: string; detail: string; chip: string }[];
  others: ExerciseLine[];
}

export function exercisesView(d: Db, date: string): ExercisesView {
  const program = readProgram(d);
  const h = historyView(d);
  const alive = live(d);
  const sessions = program.sessions.filter((s) => alive.has(s.id));
  const slots = sessions.flatMap((s) => s.slots.map((slot) => ({ slot, session: s })));
  const formats = [...BUILTIN_FORMATS, ...program.formats];
  const variantOf = new Map(d.all<{ id: string; variant_of: string | null }>('SELECT id, variant_of FROM exercises').map((r) => [r.id, r.variant_of]));
  const exercises = program.exercises.filter((e) => !e.archived).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const line = (e: Exercise): ExerciseLine => {
    const mine = slots.filter((x) => x.slot.exerciseId === e.id);
    const weighted = e.loadType === 'bodyweight';
    const timed = mine.some((x) => formats.find((f) => f.id === x.slot.formatId)?.scheme === 'hold');
    const kinds = [e.equipment === 'barbell' ? 'barbell' : '', weighted ? 'bodyweight' : '', weighted && (e.category === 'main' || /lest/i.test(e.name)) ? 'weighted' : '', timed ? 'time' : '', e.isCustom || variantOf.get(e.id) ? 'mine' : ''].filter(Boolean);
    let value: string | null = null;
    let valueLabel: string | null = null;
    if (mine.length) {
      if (mine.some((x) => x.slot.strategy.id === 'percent_reference')) {
        const ref = reference(program, h, e, date);
        if (ref) [value, valueLabel] = [`${kg(ref.value, weighted)} kg`, ref.source === 'saisi' ? '1RM réf.' : '1RM estimé'];
      } else if (timed) {
        const longest = Math.max(0, ...doneSets(d, e.id).map((s) => s.duration ?? 0));
        if (longest > 0) [value, valueLabel] = [clock(longest), 'record'];
      } else {
        const best = bestSet(doneSets(d, e.id), weighted);
        if (best) [value, valueLabel] = [`${kg(best.weight!, weighted)} × ${best.reps}`, 'meilleure série'];
      }
    }
    return { id: e.id, name: e.name, detail: kicker(e), kinds, value, valueLabel };
  };
  const used = new Set(slots.map((x) => x.slot.exerciseId));
  const variants: ExercisesView['variants'] = [];
  for (const e of exercises) {
    const parent = variantOf.get(e.id);
    if (parent) variants.push({ id: e.id, href: `/sport/exercices/${e.id}`, name: e.name, detail: `variante de ${program.exercises.find((x) => x.id === parent)?.name ?? '?'}`, chip: 'variante' });
  }
  // Les formats autres que des séries, tels qu'ils sont réglés dans le programme (« Tractions · EMOM 10 min »).
  for (const { slot, session } of slots) {
    const f = formats.find((x) => x.id === slot.formatId);
    if (!f || f.scheme === 'sets') continue;
    const e = program.exercises.find((x) => x.id === slot.exerciseId);
    if (!e) continue;
    const reps = (slot.strategy.params as { reps?: number }).reps;
    variants.push({ id: slot.id, href: `/sport/programme/creneau/${slot.id}`, name: `${e.name} · ${f.name}`, detail: `dans ${session.name}${f.scheme === 'interval' && reps ? ` · ${reps} reps / min` : ''}`, chip: f.scheme === 'interval' ? 'EMOM' : f.scheme === 'amrap' ? 'AMRAP' : f.scheme === 'hold' ? 'au temps' : 'chrono' });
  }
  return {
    total: exercises.length,
    formats: new Set(slots.map((x) => x.slot.formatId)).size,
    inProgram: exercises.filter((e) => used.has(e.id)).map(line),
    variants,
    others: exercises.filter((e) => !used.has(e.id)).map(line),
  };
}

// ---------------------------------------------------------------- la fiche

export interface ExerciseDetail {
  id: string;
  name: string;
  kicker: string;
  weighted: boolean;
  loadType: string;
  category: string;
  equipment: string;
  primary: string[];
  secondary: string[];
  notes: string;
  isCustom: boolean;
  variantOf: { id: string; name: string } | null;
  variants: { id: string; name: string }[];
  /** Au % du 1RM dans le programme : la référence pilote les charges. */
  usesReference: boolean;
  reference: { value: number; text: string; source: 'saisi' | 'estimé'; when: string } | null;
  estimate: { value: number; text: string; delta: string | null } | null;
  /** Une estimation nettement au-dessus du 1RM saisi : la proposer. */
  proposal: { value: number; text: string } | null;
  curve: { date: string; value: number }[];
  loads: { reps: number; text: string }[];
  records: { label: string; value: string; when: string | null }[];
  history: { date: string; when: string; name: string; summary: string }[];
  sessions: number;
  bodyweight: number | null;
  inTemplates: string[];
}

export function exerciseDetail(d: Db, id: string, date: string): ExerciseDetail | null {
  const program = readProgram(d);
  const e = program.exercises.find((x) => x.id === id);
  if (!e) return null;
  const h = historyView(d);
  const alive = live(d);
  const weighted = e.loadType === 'bodyweight';
  const sessions = program.sessions.filter((s) => alive.has(s.id));
  const usesReference = sessions.some((s) => s.slots.some((x) => x.exerciseId === id && x.strategy.id === 'percent_reference'));
  const ref = reference(program, h, e, date);
  const est = ref?.source === 'saisi' ? reference(program, h, e, date, true) : ref;
  const sets = doneSets(d, id);
  const row = d.first<{ variant_of: string | null }>('SELECT variant_of FROM exercises WHERE id = ?', [id]);
  const parent = row?.variant_of ? program.exercises.find((x) => x.id === row.variant_of) : undefined;
  const increment = e.weightIncrement ?? program.increment;
  // La courbe : le meilleur e1RM de chaque séance (lest net pour un lesté).
  const byWorkout = new Map<string, { date: string; value: number }>();
  for (const s of sets) {
    if (s.weight === null || s.reps === null || s.reps <= 0 || s.reps > 12) continue;
    const bw = weighted ? s.bodyweight : 0;
    const v = Math.round((estimate1RM(s.weight + bw, s.reps) - bw) * 10) / 10;
    const cur = byWorkout.get(s.workout);
    if (!cur || v > cur.value) byWorkout.set(s.workout, { date: s.date, value: v });
  }
  // Les charges de travail : ce que donne le 1RM (référence, sinon estimé) à 1, 3, 5, 8 et 10 reps, arrondi à l'incrément.
  const base = ref ?? est;
  const bwNow = h.bodyweight(date) ?? 0;
  const loads = base
    ? [1, 3, 5, 8, 10].map((reps) => {
        const total = (base.value + (weighted ? bwNow : 0)) / (reps === 1 ? 1 : 1 + reps / 30);
        const load = Math.round((total - (weighted ? bwNow : 0)) / increment) * increment;
        return { reps, text: kg(Math.max(weighted ? -1000 : 0, load), weighted) };
      })
    : [];
  const best = bestSet(sets, weighted);
  const records: ExerciseDetail['records'] = [];
  if (best) records.push({ label: 'Meilleure série', value: `${kg(best.weight!, weighted)} × ${best.reps}`, when: shortDate(best.date) });
  // Le plus de reps à la charge la plus pratiquée.
  const counts = new Map<number, number>();
  for (const s of sets) if (s.weight !== null) counts.set(s.weight, (counts.get(s.weight) ?? 0) + 1);
  const usual = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (usual !== undefined) {
    const most = Math.max(0, ...sets.filter((s) => s.weight === usual).map((s) => s.reps ?? 0));
    if (most > 0) records.push({ label: `Plus de reps à ${kg(usual, weighted)}`, value: String(most), when: null });
  }
  const longest = Math.max(0, ...sets.map((s) => s.duration ?? 0));
  if (longest > 0) records.push({ label: 'Le plus long', value: clock(longest), when: null });
  if (weighted && h.bodyweight(date) !== null) records.push({ label: 'Poids du corps', value: `${kg(h.bodyweight(date)!, false)} kg · sert au calcul`, when: null });
  // L'historique : une ligne par séance, la plus récente d'abord.
  const workouts = [...new Set(sets.map((s) => s.workout))].reverse();
  const names = new Map(d.all<{ id: string; name: string }>('SELECT id, name FROM workouts WHERE id IN (SELECT DISTINCT we.workout_id FROM workout_exercises we WHERE we.exercise_id = ?)', [id]).map((r) => [r.id, r.name]));
  const history = workouts.slice(0, 30).map((w) => {
    const mine = sets.filter((s) => s.workout === w);
    const timed = mine.filter((s) => s.duration !== null && s.duration > 0);
    const summary = timed.length ? timed.map((s) => `${Math.round(s.duration!)} s`).join(' · ') : (summarize(mine.filter((s) => s.weight !== null && s.reps !== null).map((s) => ({ weight: s.weight!, reps: s.reps! })), weighted) ?? mine.map((s) => s.reps ?? '?').join(' · '));
    return { date: mine[0]!.date, when: shortDate(mine[0]!.date), name: names.get(w) ?? '', summary };
  });
  const delta = ref && est && ref.source === 'saisi' && ref.value !== 0 ? (est.total - ref.total) / ref.total : null;
  return {
    id,
    name: e.name,
    kicker: kicker(e),
    weighted,
    loadType: e.loadType,
    category: e.category,
    equipment: e.equipment,
    primary: [...e.primaryMuscles],
    secondary: [...e.secondaryMuscles],
    notes: e.notes,
    isCustom: e.isCustom,
    variantOf: parent ? { id: parent.id, name: parent.name } : null,
    variants: d.all<{ id: string; name: string }>('SELECT id, name FROM exercises WHERE variant_of = ? AND archived = 0 ORDER BY name', [id]),
    usesReference,
    reference: ref ? { value: ref.value, text: `${kg(ref.value, weighted)} kg`, source: ref.source, when: shortDate(ref.date) } : null,
    estimate: est ? { value: est.value, text: `${kg(est.value, weighted)} kg`, delta: delta === null ? null : `${delta >= 0 ? '+' : ''}${(Math.round(delta * 1000) / 10).toLocaleString('fr-FR')} %` } : null,
    proposal: ref?.source === 'saisi' && est && delta !== null && delta > 0.01 ? { value: est.value, text: `${kg(est.value, weighted)} kg` } : null,
    curve: [...byWorkout.values()].sort((a, b) => a.date.localeCompare(b.date)),
    loads,
    records,
    history,
    sessions: workouts.length,
    bodyweight: h.bodyweight(date),
    inTemplates: sessions.filter((s) => s.slots.some((x) => x.exerciseId === id)).map((s) => s.name),
  };
}

// ---------------------------------------------------------------- modifier

export interface ExercisePatch {
  name?: string;
  loadType?: 'external' | 'bodyweight';
  category?: 'main' | 'compound' | 'isolation';
  equipment?: string;
  primary?: string[];
  secondary?: string[];
  variantOf?: string | null;
  notes?: string;
}

const MUSCLES = Object.keys(MUSCLE);

export function updateExercise(d: Db, id: string, patch: ExercisePatch): void {
  const row = d.first<{ category: string }>('SELECT category FROM exercises WHERE id = ?', [id]);
  if (!row) throw new Error('Exercice introuvable');
  const set: string[] = [];
  const vals: (string | number | null)[] = [];
  const add = (c: string, v: string | number | null) => (set.push(`${c} = ?`), vals.push(v));
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name || name.length > 80) throw new Error('Nom invalide');
    if (d.first('SELECT 1 FROM exercises WHERE name = ? COLLATE NOCASE AND archived = 0 AND id != ?', [name, id])) throw new Error('Cet exercice existe déjà');
    add('name', name);
  }
  if (patch.loadType === 'external' || patch.loadType === 'bodyweight') add('load_type', patch.loadType);
  if (patch.category && ['main', 'compound', 'isolation'].includes(patch.category) && patch.category !== row.category) {
    add('category', patch.category);
    // La progression par défaut suit : un mouvement principal suit les blocs.
    add('progression_type', patch.category === 'main' ? 'top_set_backoff' : 'double_progression');
  }
  if (patch.equipment && Object.keys(EQUIPMENT).includes(patch.equipment)) add('equipment', patch.equipment);
  if (patch.primary) {
    const p = patch.primary.filter((m) => MUSCLES.includes(m)).slice(0, 4);
    if (!p.length) throw new Error('Au moins un muscle principal');
    add('primary_muscles', JSON.stringify(p));
  }
  if (patch.secondary) add('secondary_muscles', JSON.stringify(patch.secondary.filter((m) => MUSCLES.includes(m)).slice(0, 6)));
  if ('variantOf' in patch) {
    const parent = patch.variantOf ?? null;
    if (parent !== null) {
      if (parent === id) throw new Error('Un exercice n’est pas sa propre variante');
      // Pas de boucle : le parent ne peut pas descendre de cet exercice.
      for (let cur: string | null = parent, i = 0; cur && i < 20; i++) {
        if (cur === id) throw new Error('Variante en boucle');
        cur = d.first<{ variant_of: string | null }>('SELECT variant_of FROM exercises WHERE id = ?', [cur])?.variant_of ?? null;
      }
      if (!d.first('SELECT 1 FROM exercises WHERE id = ?', [parent])) throw new Error('Exercice introuvable');
    }
    add('variant_of', parent);
  }
  if (patch.notes !== undefined) add('notes', patch.notes.trim().slice(0, 1000));
  if (set.length) d.run(`UPDATE exercises SET ${set.join(', ')} WHERE id = ?`, [...vals, id]);
}

/** Archivé, pas effacé (l'historique le cite). Refusé tant qu'une séance type s'en sert. */
export function archiveExercise(d: Db, id: string): void {
  const used = d.all<{ name: string }>('SELECT DISTINCT t.name FROM template_exercises te JOIN templates t ON t.id = te.template_id WHERE te.exercise_id = ? AND t.archived = 0', [id]);
  if (used.length) throw new Error(`Retire-le d’abord de : ${used.map((u) => u.name).join(', ')}`);
  d.run('UPDATE exercises SET archived = 1 WHERE id = ?', [id]);
}

/** Une variante : mêmes muscles, même charge, même catégorie ; son propre 1RM et sa propre progression. */
export function createVariant(d: Db, parentId: string, name: string): string {
  const p = d.first<{ load_type: string; category: string; equipment: string; primary_muscles: string; secondary_muscles: string }>('SELECT load_type, category, equipment, primary_muscles, secondary_muscles FROM exercises WHERE id = ?', [parentId]);
  if (!p) throw new Error('Exercice introuvable');
  const parse = (v: string) => {
    try {
      return JSON.parse(v) as string[];
    } catch {
      return [];
    }
  };
  return createExercise(d, {
    name,
    loadType: p.load_type === 'bodyweight' ? 'bodyweight' : 'external',
    category: (['main', 'compound', 'isolation'].includes(p.category) ? p.category : 'compound') as 'main' | 'compound' | 'isolation',
    equipment: p.equipment,
    primary: parse(p.primary_muscles),
    secondary: parse(p.secondary_muscles),
    variantOf: parentId,
  });
}
