/**
 * Loads the user's real program (personalProgram.ts ← programme-reel.md) and set history
 * (historique-seances.csv) into the database, and reports everything it had to interpret.
 * The CSV is corrected with the carnet itself (carnetCorrections.ts): substitutions written in the
 * comments, sets the export lost ("pdc", loads turned into dates), corrected reps. Nothing is invented.
 */
import { addDays, formatShortDate, parseDate, weekday } from '@/domain/dates';
import { DEFAULT_DELOAD, generateScheme, mesocycleEndOffsetDays, weekIndexFor } from '@/domain/mesocycle';
import { expandPattern } from '@/domain/planning';
import type { Mesocycle, ProgressionType, SetType, WorkoutExercise, WorkoutSet } from '@/domain/types';
import { clearAllData } from '@/db/backup';
import { db, newId } from '@/db/db';
import { insertRaw, selectRaw } from '@/db/raw';
import { addBodyEntry, latestBodyweight } from '@/db/repos/body';
import { listMesocycles, saveMesocycle } from '@/db/repos/cycles';
import { createExercise, exerciseCount, getExercise, setExerciseArchived, updateExercise, type ExerciseInput } from '@/db/repos/exercises';
import { addPlannedBulk, datesWithPlansOrWorkouts } from '@/db/repos/planning';
import { getKv, setKv } from '@/db/repos/settings';
import { seedSubstitution } from '@/db/repos/substitutions';
import {
  addPatternEntry,
  addTemplateExercise,
  createTemplate,
  getWeekPattern,
  listTemplateExercises,
  updateTemplateExercise,
} from '@/db/repos/templates';
import { deleteWorkout, insertSet, insertWorkout, insertWorkoutExercise } from '@/db/repos/workouts';
import { seedIfEmpty } from '@/db/seed';

import { CONFIRMED_JUMPS, NOTES, REASSIGNS, RECOVERED, REPS_FIXES } from './carnetCorrections';
import { HISTORY_CSV } from './historyCsv';
import {
  BLOC1,
  BODYWEIGHT,
  CYCLES,
  NAME_ALIASES,
  normalizeName,
  PERSONAL_EXERCISES,
  PERSONAL_TEMPLATES,
  PROGRAM_START,
  SESSION_TIME,
  type PersonalExercise,
  type PersonalTemplate,
  type TemplateSlot,
} from './personalProgram';

export interface HistoryRow {
  line: number;
  date: string;
  jour: string;
  exercice: string;
  serie: number;
  weight: number;
  reps: number;
}

export interface ImportReport {
  workouts: number;
  /** Sets imported from the CSV. */
  csvSets: number;
  /** Sets present in the carnet but lost by the CSV export. */
  recoveredSets: number;
  exercises: number;
  templates: number;
  mesocycles: number;
  plannedSessions: number;
  /** Raw history names folded into a canonical exercise. */
  merges: { from: string; to: string; rows: number }[];
  /** Carnet corrections applied (substitutions, recovered sets, reps), with their source row. */
  corrections: string[];
  anomalies: string[];
}

const DAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

// ---------------------------------------------------------------- parsing

export function parseHistoryCsv(text: string): { rows: HistoryRow[]; errors: string[] } {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const header = (lines[0] ?? '').split(',').map((h) => h.trim());
  const col = (name: string) => header.indexOf(name);
  const idx = { date: col('date'), jour: col('jour'), exercice: col('exercice'), serie: col('serie'), charge: col('charge_kg'), reps: col('reps') };
  const errors: string[] = [];
  if (Object.values(idx).some((i) => i < 0)) return { rows: [], errors: [`En-tête CSV inattendu : ${lines[0] ?? ''}`] };

  const rows: HistoryRow[] = [];
  lines.slice(1).forEach((raw, i) => {
    const line = i + 2;
    if (raw.trim() === '') return;
    const cells = raw.split(',');
    const get = (k: number) => cells[k] ?? '';
    const date = get(idx.date).trim();
    const serie = Number(get(idx.serie));
    const weight = Number(get(idx.charge));
    const reps = Number(get(idx.reps));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(serie) || !Number.isFinite(weight) || !Number.isFinite(reps)) {
      errors.push(`Ligne ${line} illisible : « ${raw} »`);
      return;
    }
    if (!Number.isInteger(reps)) errors.push(`Ligne ${line} : ${reps} reps non entier, arrondi à ${Math.round(reps)}`);
    rows.push({ line, date, jour: get(idx.jour).trim(), exercice: get(idx.exercice), serie, weight, reps: Math.round(reps) });
  });
  return { rows, errors };
}

// ---------------------------------------------------------------- name resolution

const canonicalById = new Map(PERSONAL_EXERCISES.map((e) => [e.id, e]));

function resolveExerciseId(rawName: string): string | null {
  const n = normalizeName(rawName);
  const alias = NAME_ALIASES[n];
  if (alias !== undefined) return alias;
  return PERSONAL_EXERCISES.find((e) => normalizeName(e.name) === n)?.id ?? null;
}

// ---------------------------------------------------------------- program

function exerciseInput(p: PersonalExercise, defaultBackoff: number): ExerciseInput {
  return {
    name: p.name,
    primaryMuscles: p.primary,
    secondaryMuscles: p.secondary,
    equipment: p.equipment,
    unilateral: p.unilateral ?? false,
    loadType: p.load,
    category: p.category,
    progressionType: p.progression,
    backoffPercent: defaultBackoff,
    repRangeMin: p.reps[0],
    repRangeMax: p.reps[1],
    weightIncrement: p.increment ?? null,
    isCustom: true,
    notes: p.notes ?? '',
  };
}

function upsertExercises(): void {
  seedIfEmpty();
  for (const p of PERSONAL_EXERCISES) {
    const input = exerciseInput(p, 0.8);
    if (getExercise(p.id) === null) createExercise(input, p.id);
    else updateExercise(p.id, input);
    setExerciseArchived(p.id, p.archived === true);
  }
}

function createTemplates(): void {
  for (const tpl of PERSONAL_TEMPLATES) {
    createTemplate(tpl.name, tpl.id);
    for (const slot of tpl.slots) {
      const ex = getExercise(slot.exerciseId);
      if (ex === null) throw new Error(`Exercice inconnu dans ${tpl.name} : ${slot.exerciseId}`);
      addTemplateExercise(tpl.id, ex);
    }
    // Fill the slot details (addTemplateExercise only creates the row).
    listTemplateExercises(tpl.id).forEach((te, i) => {
      const slot = tpl.slots[i];
      if (slot === undefined) return;
      updateTemplateExercise({
        ...te,
        intention: slot.intention,
        targetSets: slot.sets,
        progressionType: slot.progression ?? null,
        repMin: slot.reps?.[0] ?? null,
        repMax: slot.reps?.[1] ?? null,
        notes: slot.notes ?? '',
      });
    });
    addPatternEntry(tpl.weekday, tpl.id);
  }
}

function createMesocycles(): Mesocycle[] {
  const base: Omit<Mesocycle, 'id' | 'name' | 'startDate'> = {
    kind: 'accumulation',
    macrocycleId: null,
    workWeeks: 4,
    deloadWeeks: 1,
    scheme: generateScheme(4),
    deload: { ...DEFAULT_DELOAD },
    notes: '',
  };
  const all: Mesocycle[] = [
    {
      ...base,
      ...BLOC1,
      // Bloc 1 did not follow any plan: its imported sets carry no prescription and are read at face value.
      notes: 'Remise en route (7 sept. → 4 oct.), deload la semaine du 5 oct.',
    },
    ...CYCLES.map((c) => ({ ...base, ...c, scheme: generateScheme(4), deload: { ...DEFAULT_DELOAD, main: { ...DEFAULT_DELOAD.main } } })),
  ];
  all.forEach((m) => saveMesocycle(m));
  return all;
}

/**
 * v4: loads became % of the reference 1RM. Personal cycles that have not started (no session yet)
 * get the new pre-filled structure; started ones keep what the user has.
 */
function refreshUnstartedCycles(): void {
  for (const c of CYCLES) {
    const meso = listMesocycles().find((m) => m.id === c.id);
    const started = db().first<{ n: number }>('SELECT COUNT(*) AS n FROM workouts WHERE mesocycle_id = ?', [c.id])?.n ?? 0;
    if (meso === undefined || started > 0) continue;
    saveMesocycle({ ...meso, scheme: generateScheme(meso.workWeeks), deload: { ...meso.deload, main: { ...DEFAULT_DELOAD.main } } });
  }
}

// ---------------------------------------------------------------- history (CSV + carnet corrections)

/** One set as it really happened: CSV row after carnet corrections, or a set recovered from the carnet. */
export interface HistorySetRow {
  date: string;
  exerciseId: string;
  /** Sort key inside the session (CSV line × 10; recovered sets slot around their anchor). */
  order: number;
  weight: number;
  reps: number;
  /** Explicit type from the carnet (e.g. a drop set); null → tagged from the loads. */
  setType: SetType | null;
  origin: 'csv' | 'carnet';
  raw: string;
  serie: number;
}

export interface HistoryBuild {
  sets: HistorySetRow[];
  /** Human-readable list of every correction applied, with its carnet source. */
  corrections: string[];
  /** Corrections that matched nothing (should stay empty — guarded by tests). */
  unmatched: string[];
}

const dayLabel = (d: string) => `${DAYS[weekday(d)] ?? ''} ${formatShortDate(d)}`;
const exerciseName = (id: string) => canonicalById.get(id)?.name ?? id;
const sameRaw = (a: string, b: string) => normalizeName(a) === normalizeName(b);

export function buildHistory(rows: readonly HistoryRow[]): HistoryBuild {
  const corrections: string[] = [];
  const unmatched: string[] = [];
  const sets: HistorySetRow[] = rows.flatMap((r) => {
    const exerciseId = resolveExerciseId(r.exercice);
    if (exerciseId === null) return [];
    return [{ date: r.date, exerciseId, order: r.line * 10, weight: r.weight, reps: r.reps, setType: null, origin: 'csv' as const, raw: r.exercice, serie: r.serie }];
  });
  const csvMatch = (date: string, exercise: string, series?: readonly number[]) =>
    sets.filter((s) => s.origin === 'csv' && s.date === date && sameRaw(s.raw, exercise) && (series === undefined || series.includes(s.serie)));

  // Recovered sets are anchored on CSV sets before anything is moved.
  let seq = 0;
  const recovered: HistorySetRow[] = [];
  for (const rec of RECOVERED) {
    const anchor = csvMatch(rec.date, rec.anchor.exercise, [rec.anchor.serie])[0];
    if (anchor === undefined) {
      unmatched.push(`Récupération sans ancre : ${rec.date} ${rec.anchor.exercise} S${rec.anchor.serie}`);
      continue;
    }
    for (const x of rec.sets) {
      const order = rec.anchor.side === 'before' ? anchor.order - 5 + seq * 0.01 : anchor.order + 1 + seq * 0.01;
      seq += 1;
      recovered.push({ date: rec.date, exerciseId: rec.exerciseId, order, weight: x.weight, reps: x.reps, setType: x.setType ?? null, origin: 'carnet', raw: exerciseName(rec.exerciseId), serie: x.serie ?? 0 });
    }
    const detail = rec.sets.map((x) => `${x.weight === 0 ? 'PDC' : `${x.weight} kg`} × ${x.reps}${x.setType === 'drop' ? ' (dégressif)' : ''}`).join(', ');
    corrections.push(`${dayLabel(rec.date)} — ${exerciseName(rec.exerciseId)} : série(s) ajoutée(s) ${detail} — carnet ${rec.source}`);
  }

  for (const fix of REPS_FIXES) {
    const target = csvMatch(fix.date, fix.exercise, [fix.serie])[0];
    if (target === undefined) {
      unmatched.push(`Correction de reps sans série : ${fix.date} ${fix.exercise} S${fix.serie}`);
      continue;
    }
    corrections.push(`${dayLabel(fix.date)} — ${fix.exercise} S${fix.serie} : ${target.reps} → ${fix.reps} reps — carnet ${fix.source}`);
    target.reps = fix.reps;
  }

  for (const re of REASSIGNS) {
    const targets = csvMatch(re.date, re.exercise, re.series);
    if (targets.length === 0) {
      unmatched.push(`Réattribution sans série : ${re.date} ${re.exercise}`);
      continue;
    }
    for (const t of targets) t.exerciseId = re.to;
    const which = re.series === undefined ? '' : ` (S${re.series.join(', S')})`;
    corrections.push(`${dayLabel(re.date)} — ${re.exercise}${which} → ${exerciseName(re.to)} (${targets.length} séries) — carnet ${re.source}`);
  }

  return { sets: [...sets, ...recovered].sort((a, b) => (a.date === b.date ? a.order - b.order : a.date < b.date ? -1 : 1)), corrections, unmatched };
}

function startTimestamp(date: string): number {
  const d = parseDate(date);
  d.setHours(SESSION_TIME.hours, SESSION_TIME.minutes, 0, 0);
  return d.getTime();
}

function slotFor(template: PersonalTemplate | null, exerciseId: string): TemplateSlot | undefined {
  return template?.slots.find((s) => s.exerciseId === exerciseId);
}

/** Main lifts: the heaviest set of the session (first one if tied) is the top set, the others backoffs. */
export function tagSets(progression: ProgressionType, weights: readonly number[]): SetType[] {
  if (progression !== 'top_set_backoff') return weights.map(() => 'working');
  const max = Math.max(...weights);
  const top = weights.indexOf(max);
  return weights.map((_, i) => (i === top ? 'top_set' : 'backoff'));
}

function importSession(date: string, sets: readonly HistorySetRow[], bloc1: Mesocycle): number {
  const template = PERSONAL_TEMPLATES.find((t) => t.weekday === weekday(date)) ?? null;
  const startedAt = startTimestamp(date);
  const weekIndex = weekIndexFor(bloc1, date);
  const workoutId = newId();
  insertWorkout({
    id: workoutId,
    name: template?.name ?? DAYS[weekday(date)] ?? 'Séance',
    date,
    templateId: template?.id ?? null,
    plannedId: null,
    mesocycleId: bloc1.id,
    weekIndex,
    isDeload: weekIndex > bloc1.workWeeks,
    bodyweight: latestBodyweight(date),
    startedAt,
    endedAt: null,
    status: 'completed',
    notes: NOTES.filter((n) => n.date === date && n.exerciseId === null)
      .map((n) => n.text)
      .join('\n'),
  });

  const templateRows = new Map(template === null ? [] : listTemplateExercises(template.id).map((te) => [te.exerciseId, te.id]));
  // Exercises in the order they were first done.
  const groups = new Map<string, HistorySetRow[]>();
  for (const s of [...sets].sort((a, b) => a.order - b.order)) groups.set(s.exerciseId, [...(groups.get(s.exerciseId) ?? []), s]);

  let position = 0;
  let count = 0;
  for (const [exerciseId, group] of groups) {
    const ex = canonicalById.get(exerciseId);
    if (ex === undefined) continue;
    const slot = slotFor(template, exerciseId);
    const progression = slot?.progression ?? ex.progression;
    const we: WorkoutExercise = {
      id: newId(),
      workoutId,
      exerciseId,
      position: position++,
      progressionType: progression,
      intention: slot?.intention ?? (progression === 'top_set_backoff' ? 'strength' : 'hypertrophy'),
      repMin: slot?.reps?.[0] ?? ex.reps[0],
      repMax: slot?.reps?.[1] ?? ex.reps[1],
      backoffPercent: 0.8,
      templateExerciseId: templateRows.get(exerciseId) ?? null,
      referenceE1rm: null,
      replacesExerciseId: null,
      notes: NOTES.filter((n) => n.date === date && n.exerciseId === exerciseId)
        .map((n) => n.text)
        .join(' '),
    };
    insertWorkoutExercise(we);
    // Load-based tagging ignores explicit drop sets, which keep their type.
    const plain = group.filter((s) => s.setType === null);
    const tags = tagSets(progression, plain.map((s) => s.weight));
    group.forEach((s, i) => {
      const set: WorkoutSet = {
        id: newId(),
        workoutExerciseId: we.id,
        position: i,
        setType: s.setType ?? tags[plain.indexOf(s)] ?? 'working',
        typeManual: true,
        weight: s.weight,
        reps: s.reps,
        targetWeight: null,
        targetReps: null,
        targetRepsMax: null,
        barSpeed: null,
        isTest: false,
        note: '',
        completed: true,
        completedAt: null,
      };
      insertSet(set);
      count += 1;
    });
  }
  return count;
}

/** Every substitution of the carnet becomes a remembered alternative ("done instead of"). Idempotent. */
function seedSubstitutions(): void {
  const pairs = new Map<string, { from: string; to: string; uses: number; at: number }>();
  for (const re of REASSIGNS) {
    const from = resolveExerciseId(re.exercise);
    if (from === null || from === re.to) continue;
    const key = `${from}|${re.to}`;
    const cur = pairs.get(key);
    const at = startTimestamp(re.date);
    pairs.set(key, { from, to: re.to, uses: (cur?.uses ?? 0) + 1, at: Math.max(cur?.at ?? 0, at) });
  }
  pairs.forEach((p) => seedSubstitution(p.from, p.to, p.uses, p.at));
}

/** Inserts the history sessions; returns [sessions, CSV sets, recovered sets]. */
function importHistory(build: HistoryBuild, bloc1: Mesocycle): { workouts: number; csvSets: number; recoveredSets: number } {
  const dates = [...new Set(build.sets.map((s) => s.date))].sort();
  for (const date of dates) importSession(date, build.sets.filter((s) => s.date === date), bloc1);
  seedSubstitutions();
  return {
    workouts: dates.length,
    csvSets: build.sets.filter((s) => s.origin === 'csv').length,
    recoveredSets: build.sets.filter((s) => s.origin === 'carnet').length,
  };
}

// ---------------------------------------------------------------- anomalies

/** Problems left after the carnet corrections (things only the user can explain). */
export function findAnomalies(rows: readonly HistoryRow[], build: HistoryBuild): string[] {
  const out: string[] = [...build.unmatched];

  for (const r of rows) {
    if (resolveExerciseId(r.exercice) === null) out.push(`Ligne ${r.line} : exercice inconnu « ${r.exercice} », ignoré`);
    const expected = DAYS[weekday(r.date)];
    if (normalizeName(r.jour) !== expected) out.push(`Ligne ${r.line} : « ${r.jour} » mais le ${r.date} est un ${expected ?? '?'}`);
  }

  // Set numbering per session × exercise, once recovered series are put back.
  const groups = new Map<string, number[]>();
  for (const r of rows) {
    const key = `${r.date}|${normalizeName(r.exercice)}`;
    groups.set(key, [...(groups.get(key) ?? []), r.serie]);
  }
  for (const rec of RECOVERED) {
    const key = `${rec.date}|${normalizeName(rec.anchor.exercise)}`;
    for (const x of rec.sets) if (x.serie !== undefined) groups.set(key, [...(groups.get(key) ?? []), x.serie]);
  }
  for (const [key, nums] of groups) {
    const [date = '', name = ''] = key.split('|');
    const label = rows.find((r) => r.date === date && normalizeName(r.exercice) === name)?.exercice.trim() ?? name;
    const explained = NOTES.some((n) => n.date === date && n.exerciseId === resolveExerciseId(label));
    const sorted = [...nums].sort((a, b) => a - b);
    if (new Set(sorted).size !== sorted.length) out.push(`${label} (${dayLabel(date)}) : numéros de série en double`);
    const missing = Array.from({ length: Math.max(...sorted) }, (_, i) => i + 1).filter((n) => !sorted.includes(n));
    if (missing.length > 0) out.push(`${label} (${dayLabel(date)}) : série ${missing.join(', ')} absente de la numérotation`);
    if (sorted.length === 1 && !explained) out.push(`${label} (${dayLabel(date)}) : une seule série enregistrée`);
  }

  // Load jumps between consecutive sessions of the same (corrected) exercise: unit or machine change?
  const byExercise = new Map<string, { date: string; max: number }[]>();
  for (const s of build.sets) {
    if (s.setType === 'drop') continue;
    const list = byExercise.get(s.exerciseId) ?? [];
    const cur = list.find((x) => x.date === s.date);
    if (cur === undefined) list.push({ date: s.date, max: s.weight });
    else cur.max = Math.max(cur.max, s.weight);
    byExercise.set(s.exerciseId, list);
  }
  for (const [id, list] of byExercise) {
    list.sort((a, b) => (a.date < b.date ? -1 : 1));
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      const cur = list[i];
      if (prev === undefined || cur === undefined || prev.max <= 0 || cur.max <= 0) continue;
      const ratio = cur.max / prev.max;
      const confirmed = CONFIRMED_JUMPS.some((c) => c.exerciseId === id && c.to === cur.date && c.from <= prev.date);
      if (!confirmed && (ratio >= 1.6 || ratio <= 0.65)) {
        out.push(
          `${exerciseName(id)} : charge max ${prev.max} kg (${dayLabel(prev.date)}) → ${cur.max} kg (${dayLabel(cur.date)}), ×${ratio.toFixed(1)} — unité ou matériel différent ?`,
        );
      }
    }
  }

  // Exercises outside the day's template that no carnet comment explains.
  const explainedIds = new Set([...REASSIGNS.map((r) => `${r.date}|${r.to}`), ...RECOVERED.map((r) => `${r.date}|${r.exerciseId}`)]);
  for (const s of build.sets) {
    const tpl = PERSONAL_TEMPLATES.find((t) => t.weekday === weekday(s.date));
    if (tpl === undefined || tpl.slots.some((x) => x.exerciseId === s.exerciseId) || explainedIds.has(`${s.date}|${s.exerciseId}`)) continue;
    const msg = `${exerciseName(s.exerciseId)} (${dayLabel(s.date)}) : hors de la séance type actuelle du ${DAYS[tpl.weekday] ?? ''}`;
    if (!out.includes(msg)) out.push(msg);
  }

  // Planned days of Bloc 1 (weeks 1-4) without any logged session.
  const dates = new Set(rows.map((r) => r.date));
  for (let d = 0; d < 28; d++) {
    const date = addDays(PROGRAM_START, d);
    if (PERSONAL_TEMPLATES.some((t) => t.weekday === weekday(date)) && !dates.has(date)) {
      out.push(`Aucune séance enregistrée le ${dayLabel(date)} (semaine ${Math.floor(d / 7) + 1} du Bloc 1)`);
    }
  }
  return out;
}

/** Name variants folded into one exercise (rows moved by a carnet correction are not merges). */
function mergesOf(build: HistoryBuild): ImportReport['merges'] {
  const counts = new Map<string, number>();
  for (const s of build.sets) {
    if (s.origin !== 'csv' || s.exerciseId !== resolveExerciseId(s.raw) || s.raw === exerciseName(s.exerciseId)) continue;
    counts.set(s.raw, (counts.get(s.raw) ?? 0) + 1);
  }
  return [...counts]
    .map(([from, rows]) => ({ from, to: exerciseName(resolveExerciseId(from) ?? from), rows }))
    .sort((a, b) => a.from.localeCompare(b.from));
}

// ---------------------------------------------------------------- entry points

/** Version of the import logic; databases imported by an older one get their history refreshed. */
export const PERSONAL_IMPORT_VERSION = 4;
const IMPORT_VERSION_KEY = 'personal_import_version';

/** Imports program + history into the current database (expects no user data yet). */
export function importPersonalData(csv: string = HISTORY_CSV): ImportReport {
  const { rows, errors } = parseHistoryCsv(csv);
  const build = buildHistory(rows);
  let history = { workouts: 0, csvSets: 0, recoveredSets: 0 };
  let mesocycles: Mesocycle[] = [];
  let planned = 0;

  db().transaction(() => {
    upsertExercises();
    createTemplates();
    mesocycles = createMesocycles();
    addBodyEntry('bodyweight', BODYWEIGHT.date, BODYWEIGHT.value);
    const bloc1 = mesocycles[0];
    if (bloc1 === undefined) throw new Error('Bloc 1 manquant');
    history = importHistory(build, bloc1);

    // Calendar: from the Bloc 1 deload week to the end of the third generated cycle. Movable / deletable.
    const last = mesocycles[mesocycles.length - 1] ?? bloc1;
    const from = addDays(bloc1.startDate, bloc1.workWeeks * 7);
    const to = addDays(last.startDate, mesocycleEndOffsetDays(last));
    const names = new Map(PERSONAL_TEMPLATES.map((t) => [t.id, t.name]));
    const proposals = expandPattern(getWeekPattern(), from, to, datesWithPlansOrWorkouts(from, to));
    addPlannedBulk(proposals.map((p) => ({ ...p, title: names.get(p.templateId) ?? 'Séance' })));
    planned = proposals.length;
    setKv(IMPORT_VERSION_KEY, String(PERSONAL_IMPORT_VERSION));
  });

  return {
    workouts: history.workouts,
    csvSets: history.csvSets,
    recoveredSets: history.recoveredSets,
    exercises: PERSONAL_EXERCISES.length,
    templates: PERSONAL_TEMPLATES.length,
    mesocycles: mesocycles.length,
    plannedSessions: planned,
    merges: mergesOf(build),
    corrections: build.corrections,
    anomalies: [...errors, ...findAnomalies(rows, build)],
  };
}

/** Wipes all training data (settings kept) and loads the personal program + history — atomically. */
export function replaceWithPersonalData(): ImportReport {
  let report: ImportReport | null = null;
  db().transaction(() => {
    // The 1RMs the user typed are not part of the program: they survive a reload.
    const typed = selectRaw('exercise_one_rm', '1 = 1', []);
    clearAllData(true);
    report = importPersonalData();
    for (const row of typed) if (typeof row.exercise_id === 'string' && getExercise(row.exercise_id) !== null) insertRaw('exercise_one_rm', row);
  });
  if (report === null) throw new Error('Import interrompu');
  return report;
}

/** Saturday volume dips used to be "Dips lesté" in a double-progression slot: give them their own exercise. */
function splitVolumeDips(): boolean {
  const volume = canonicalById.get('ex_weighted_dip_volume');
  if (volume === undefined || getExercise(volume.id) !== null) return false;
  createExercise(exerciseInput(volume, 0.8), volume.id);
  db().run(
    `UPDATE workout_exercises SET exercise_id = ? WHERE exercise_id = 'ex_weighted_dip' AND progression_type = 'double_progression'`,
    [volume.id],
  );
  db().run(
    `UPDATE template_exercises SET exercise_id = ?, progression_type = NULL, rep_min = NULL, rep_max = NULL, notes = ''
     WHERE exercise_id = 'ex_weighted_dip' AND progression_type = 'double_progression'`,
    [volume.id],
  );
  const heavy = canonicalById.get('ex_weighted_dip');
  if (heavy !== undefined) updateExercise(heavy.id, exerciseInput(heavy, getExercise(heavy.id)?.backoffPercent ?? 0.8));
  return true;
}

/**
 * Brings a database imported by an older version of the import up to date, without touching
 * anything the user did since: missing exercises are created (existing ones keep the user's
 * edits), and only the imported Bloc 1 history (sessions up to the last carnet date) is rebuilt
 * with the carnet corrections. Templates, cycles, plans and new sessions are kept. Idempotent.
 */
export function upgradePersonalData(): boolean {
  const imported = db().first<{ id: string }>("SELECT id FROM templates WHERE id = 'tpl_samedi'") !== null;
  if (!imported) return false;
  const version = Number(getKv(IMPORT_VERSION_KEY) ?? '1');
  if (version >= PERSONAL_IMPORT_VERSION) return false;
  db().transaction(() => {
    splitVolumeDips();
    for (const p of PERSONAL_EXERCISES) {
      if (getExercise(p.id) === null) createExercise(exerciseInput(p, 0.8), p.id);
    }
    if (version < 4) refreshUnstartedCycles();
    // v3: Tuesday lateral raises are the machine version.
    db().run("UPDATE template_exercises SET exercise_id = 'ex_machine_lateral_raise' WHERE template_id = 'tpl_mardi' AND exercise_id = 'ex_lateral_raise'");
    const bloc1 = listMesocycles().find((m) => m.id === BLOC1.id);
    if (bloc1 !== undefined) {
      const build = buildHistory(parseHistoryCsv(HISTORY_CSV).rows);
      const lastDate = build.sets.reduce((m, s) => (s.date > m ? s.date : m), '');
      const old = db().all<{ id: string }>('SELECT id FROM workouts WHERE mesocycle_id = ? AND date <= ?', [bloc1.id, lastDate]);
      old.forEach((w) => deleteWorkout(w.id));
      importHistory(build, bloc1);
    }
    setKv(IMPORT_VERSION_KEY, String(PERSONAL_IMPORT_VERSION));
  });
  return true;
}

let historyEnd: string | null = null;
/** Last day of the imported personal history: any session after it was entered on this device. */
export function personalHistoryEnd(): string {
  if (historyEnd === null) historyEnd = buildHistory(parseHistoryCsv(HISTORY_CSV).rows).sets.reduce((m, s) => (s.date > m ? s.date : m), '');
  return historyEnd;
}

/** First launch: an empty database gets the personal program instead of the bare generic library. */
export function seedPersonalIfFresh(): ImportReport | null {
  const hasWorkouts = (db().first<{ n: number }>('SELECT COUNT(*) AS n FROM workouts')?.n ?? 0) > 0;
  if (exerciseCount() > 0 || hasWorkouts) return null;
  return importPersonalData();
}
