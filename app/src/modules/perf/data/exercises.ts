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

/** Les groupes musculaires de la bibliothèque, avec leur pastille et leur teinte (couleurs des modules du kit). */
export type Region = 'push' | 'pull' | 'legs' | 'core';
const GROUPS: readonly { id: string; label: string; region: Region; muscles: string[] }[] = [
  { id: 'chest', label: 'Pectoraux', region: 'push', muscles: ['chest'] },
  { id: 'back', label: 'Dos', region: 'pull', muscles: ['back', 'lats', 'traps', 'lower_back'] },
  { id: 'legs', label: 'Jambes', region: 'legs', muscles: ['quads', 'hamstrings', 'glutes', 'adductors', 'calves'] },
  { id: 'shoulders', label: 'Épaules', region: 'push', muscles: ['shoulders', 'rear_delts'] },
  { id: 'arms', label: 'Bras', region: 'pull', muscles: ['biceps', 'triceps', 'forearms'] },
  { id: 'core', label: 'Abdos et gainage', region: 'core', muscles: ['abs'] },
];
const TILE: Record<string, string> = { chest: 'PECS', back: 'DOS', lats: 'DOS', traps: 'TRAP', shoulders: 'ÉPA', rear_delts: 'ÉPA', biceps: 'BI', triceps: 'TRI', forearms: 'AVB', abs: 'ABDO', lower_back: 'LOMB', glutes: 'FESS', quads: 'QUAD', hamstrings: 'ISCH', adductors: 'ADD', calves: 'MOL' };
const REGION: Record<string, Region> = { chest: 'push', shoulders: 'push', triceps: 'push', back: 'pull', lats: 'pull', traps: 'pull', rear_delts: 'pull', biceps: 'pull', forearms: 'pull', quads: 'legs', hamstrings: 'legs', glutes: 'legs', adductors: 'legs', calves: 'legs', abs: 'core', lower_back: 'core' };
const DAYS = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];
const daysAgo = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00`) - Date.parse(`${from}T12:00:00`)) / 86_400_000);
const ago = (iso: string, today: string) => {
  const n = daysAgo(iso, today);
  return n <= 0 ? 'aujourd’hui' : n === 1 ? 'hier' : n < 14 ? `il y a ${n} j` : n < 60 ? `il y a ${Math.round(n / 7)} sem.` : shortDate(iso);
};

export interface ExerciseLine {
  id: string;
  name: string;
  detail: string;
  tile: string;
  region: Region;
  /** Format autre que des séries, tel qu'il est réglé dans le programme (EMOM, AMRAP, au temps). */
  tag: string | null;
  /** Pour les filtres : program, weighted, barbell, dumbbell, bodyweight, time, mine. */
  kinds: string[];
  /** Le repère : 1RM, sinon la dernière série, sinon « jamais fait ». */
  value: string | null;
  valueLabel: string;
}

export interface ExercisesView {
  total: number;
  inProgram: number;
  /** Les exercices du programme, séance par séance (dans l'ordre de la semaine). */
  sessions: { id: string; day: string; name: string; lines: ExerciseLine[] }[];
  /** Le reste de la bibliothèque, par groupe musculaire, puis les tiens. */
  library: { id: string; label: string; region: Region; tile: string; lines: ExerciseLine[] }[];
  /** Tout, à plat, pour chercher et filtrer. */
  all: ExerciseLine[];
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
  const used = new Set(slots.map((x) => x.slot.exerciseId));
  const lineOf = new Map<string, ExerciseLine>();
  const line = (e: Exercise): ExerciseLine => {
    const known = lineOf.get(e.id);
    if (known) return known;
    const mine = slots.filter((x) => x.slot.exerciseId === e.id);
    const weighted = e.loadType === 'bodyweight';
    const schemes = mine.map((x) => formats.find((f) => f.id === x.slot.formatId)?.scheme ?? 'sets');
    const timed = schemes.includes('hold');
    const tag = schemes.includes('interval') ? 'EMOM' : schemes.includes('amrap') ? 'AMRAP' : timed ? 'au temps' : schemes.includes('for_time') ? 'chrono' : null;
    const primary = e.primaryMuscles[0] ?? 'chest';
    const kinds = [
      used.has(e.id) ? 'program' : '',
      weighted && (e.category === 'main' || /lest/i.test(e.name)) ? 'weighted' : '',
      e.equipment === 'barbell' ? 'barbell' : '',
      e.equipment === 'dumbbell' ? 'dumbbell' : '',
      weighted || e.equipment === 'bodyweight' ? 'bodyweight' : '',
      timed ? 'time' : '',
      e.isCustom || variantOf.get(e.id) ? 'mine' : '',
    ].filter(Boolean);
    const sets = doneSets(d, e.id);
    let value: string | null = null;
    let valueLabel = 'jamais fait';
    if (mine.some((x) => x.slot.strategy.id === 'percent_reference')) {
      const ref = reference(program, h, e, date);
      if (ref) [value, valueLabel] = [`${kg(ref.value, weighted)} kg`, ref.source === 'saisi' ? '1RM réf.' : '1RM estimé'];
    }
    const last = sets[sets.length - 1];
    if (value === null && last) {
      const day = sets.filter((s) => s.workout === last.workout);
      if (timed || (last.duration !== null && last.duration > 0)) value = clock(Math.max(...day.map((s) => s.duration ?? 0)));
      else if (tag === 'EMOM' || last.weight === null) value = `${day.reduce((n, s) => n + (s.reps ?? 0), 0)} reps`;
      else {
        const top = day.reduce((a, s) => ((s.weight ?? 0) > (a.weight ?? 0) ? s : a), day[0]!);
        value = `${kg(top.weight!, weighted)} × ${top.reps ?? '?'}`;
      }
      valueLabel = ago(last.date, date);
    }
    const out: ExerciseLine = { id: e.id, name: e.name, detail: kicker(e), tile: TILE[primary] ?? 'EX', region: REGION[primary] ?? 'push', tag, kinds, value, valueLabel };
    lineOf.set(e.id, out);
    return out;
  };
  // Le programme, séance par séance : les jours de la semaine type d'abord.
  const dayOf = (id: string) => {
    const days = program.structure.pattern.filter((p) => p.templateId === id).map((p) => p.weekday).sort();
    return days.length ? days[0]! : 7;
  };
  const bySession = [...sessions]
    .sort((a, b) => dayOf(a.id) - dayOf(b.id))
    .map((s) => ({
      id: s.id,
      day: program.structure.pattern.filter((p) => p.templateId === s.id).map((p) => DAYS[p.weekday]).sort((x, y) => DAYS.indexOf(x!) - DAYS.indexOf(y!)).join(' · '),
      name: s.name,
      lines: [...new Set(s.slots.map((x) => x.exerciseId))].flatMap((id) => {
        const e = exercises.find((x) => x.id === id);
        return e ? [line(e)] : [];
      }),
    }))
    .filter((s) => s.lines.length > 0);
  const rest = exercises.filter((e) => !used.has(e.id));
  const mineOnes = rest.filter((e) => e.isCustom || variantOf.get(e.id));
  const library = GROUPS.map((g) => ({
    id: g.id,
    label: g.label,
    region: g.region,
    tile: TILE[g.muscles[0]!] ?? 'EX',
    lines: rest.filter((e) => !mineOnes.includes(e) && g.muscles.includes(e.primaryMuscles[0] ?? '')).map(line),
  }));
  library.push({ id: 'mine', label: 'Tes exercices et variantes', region: 'pull', tile: 'À TOI', lines: mineOnes.map(line) });
  return { total: exercises.length, inProgram: used.size, sessions: bySession, library: library.filter((g) => g.lines.length > 0), all: exercises.map(line) };
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
  /** « Tirage + biceps · au % du 1RM », ou « Pas encore au programme ». */
  context: string;
  chips: string[];
  createdOn: string | null;
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
    context: (() => {
      const first = sessions.find((s) => s.slots.some((x) => x.exerciseId === id));
      if (!first) return 'Pas encore au programme';
      const slot = first.slots.find((x) => x.exerciseId === id)!;
      return `${first.name} · ${STRATEGY_LABEL[slot.strategy.id] ?? 'au programme'}`;
    })(),
    chips: [weighted ? (e.category === 'main' ? 'Lest' : 'Poids du corps') : (EQUIPMENT[e.equipment] ?? 'Charge').replace(/^./, (c) => c.toUpperCase()), CATEGORY_LABEL[e.category] ?? ''].filter(Boolean),
    createdOn: (() => {
      const r = d.first<{ created_at: number }>('SELECT created_at FROM exercises WHERE id = ? AND is_custom = 1', [id]);
      return r ? new Date(r.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) : null;
    })(),
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
const STRATEGY_LABEL: Record<string, string> = { percent_reference: 'au % du 1RM', double_progression: 'double progression', linear: 'linéaire', free: 'libre', autoregulated: 'RPE ou RIR' };
const CATEGORY_LABEL: Record<string, string> = { main: 'Force · au %', compound: 'Polyarticulaire', isolation: 'Isolation' };

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
