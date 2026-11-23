import {
  buildPlan,
  describeGroups,
  groupsOfWeek,
  matchExercise,
  mesoKindInfo,
  newExercises,
  parseProgramInput,
  programToFile,
  READY_PROGRAMS,
  summarizePlan,
  weekPlan,
  type ExportBlock,
  type ExportInput,
  type ImportPlan,
  type ParsedBlock,
  type ParsedExercise,
  type ProgramFile,
} from '@mylife/training';
import { createExercise } from './day';
import { addSlot, archiveTemplate, createTemplate, setTemplateDays, updateSlot, type FormatChoice, type SlotPatch } from './program';
import { readProgram } from './queries';
import { deleteBlock, ensureMacro, saveBlock, setBlockPlan, setLiftGroups } from './plan';
import type { Db } from './sql';

/**
 * Importer et partager un programme (maquette V3-Import, validée le 22/11), côté Worker. Ce qu'on colle (JSON d'une
 * IA, texte libre « Squat 4x8 », un programme prêt) est lu par le format d'échange, rapproché de la bibliothèque, montré
 * avant toute écriture, puis appliqué d'un coup (tout ou rien) : séances types, formats (EMOM, AMRAP, au temps),
 * supersets, progressions, semaine type, 1RM, blocs. Ce qui n'est pas compris est signalé, jamais inventé.
 */

const DAYS = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];
const num = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 1 });

/** Ce qu'un exercice importé deviendra, en une ligne (« EMOM 10 min · 5 / min », « 4 × 6-8 · 75 % du 1RM »). */
function detailOf(e: ParsedExercise): string {
  const reps = e.amrap ? 'max' : e.repMin === null ? '?' : e.repMax !== null && e.repMax !== e.repMin ? `${e.repMin}-${e.repMax}` : `${e.repMin}`;
  const head =
    e.format === 'emom'
      ? `EMOM ${e.minutes ?? e.sets} min${e.everySeconds && e.everySeconds !== 60 ? ` / ${e.everySeconds} s` : ''}${e.repMin !== null ? ` · ${e.repMin} / min` : ''}`
      : e.format === 'amrap'
        ? `AMRAP ${e.minutes ?? 8} min`
        : e.format === 'for_time'
          ? `${e.sets} × chrono`
          : e.seconds !== null
            ? `${e.sets} × ${e.seconds} s`
            : `${e.sets} × ${reps}`;
  const extra = [e.percent !== null ? `${num(e.percent)} % du 1RM` : '', e.kg !== null ? `${e.bodyweight ? '+' : ''}${num(e.kg)} kg` : '', e.rpe !== null ? `RPE ${num(e.rpe)}` : ''].filter(Boolean);
  return [head, ...extra].join(' · ');
}

export interface ImportPreview {
  ok: boolean;
  name: string;
  source: 'json' | 'text' | null;
  issues: string[];
  summary: { sessions: number; exercises: number; created: number; days: number };
  sessions: { name: string; days: string; exercises: { name: string; written: string | null; isNew: boolean; detail: string; group: string | null }[] }[];
  blocks: {
    name: string;
    kind: string;
    weeks: number;
    deloadWeeks: number;
    start: string | null;
    macro: string | null;
    /** Ce bloc existe déjà (même identifiant) : il sera mis à jour. */
    update: boolean;
    /** Semaine par semaine, en clair ; null : la forme du type de bloc. */
    plan: string[] | null;
    deload: string | null;
    lifts: { name: string; week: number; text: string }[];
  }[];
  oneRms: { name: string; kg: number }[];
}

function planOf(d: Db, input: string): { plan: ImportPlan | null; issues: string[]; source: ImportPreview['source']; cycles: ParsedBlock[]; liftOf: (name: string) => string | null } {
  const parsed = parseProgramInput(input);
  const none = () => null;
  if (!parsed.program) return { plan: null, issues: parsed.issues, source: parsed.source, cycles: [], liftOf: none };
  const program = readProgram(d);
  const library = program.exercises.filter((e) => !e.archived).map((e) => ({ id: e.id, name: e.name }));
  const taken = d.all<{ name: string }>('SELECT name FROM templates WHERE archived = 0').map((r) => r.name);
  const plan = buildPlan(parsed.program, library, taken);
  // Les exceptions par exercice visent la bibliothèque, ou un exercice que ce programme crée.
  const created = new Set(newExercises(plan).map((e) => e.name.trim().toLowerCase()));
  const liftOf = (name: string) => matchExercise(name, library).exerciseId ?? (created.has(name.trim().toLowerCase()) ? `new:${name.trim().toLowerCase()}` : null);
  const issues = [...parsed.issues];
  for (const b of parsed.program.blocks)
    for (const name of new Set(b.lifts.map((l) => l.name))) if (!liftOf(name)) issues.push(`${b.name} : « ${name} » n’est ni dans ta bibliothèque ni dans ce programme, son exception est ignorée.`);
  return { plan, issues, source: parsed.source, cycles: parsed.program.blocks, liftOf };
}

export function importPreview(d: Db, input: string): ImportPreview {
  const { plan, issues, source, cycles, liftOf } = planOf(d, input);
  if (!plan) return { ok: false, name: '', source, issues, summary: { sessions: 0, exercises: 0, created: 0, days: 0 }, sessions: [], blocks: [], oneRms: [] };
  const names = new Map(readProgram(d).exercises.map((e) => [e.id, e.name]));
  const summary = summarizePlan(plan);
  return {
    ok: true,
    name: plan.name,
    source,
    issues,
    summary: { sessions: summary.sessions, exercises: summary.exercises, created: summary.created, days: summary.days },
    sessions: plan.sessions.map((s) => ({
      name: s.name,
      days: s.weekdays.map((x) => DAYS[x]).join(' · '),
      exercises: s.exercises.map((e) => {
        const known = e.exerciseId ? (names.get(e.exerciseId) ?? null) : null;
        return { name: known ?? e.parsed.name, written: known && known !== e.parsed.name ? e.parsed.name : null, isNew: e.exerciseId === null, detail: detailOf(e.parsed), group: e.parsed.group };
      }),
    })),
    blocks: cycles.map((b) => ({
      name: b.name,
      kind: mesoKindInfo(b.kind).label,
      weeks: b.weeks,
      deloadWeeks: b.deloadWeeks,
      start: b.start,
      macro: b.macro?.name ?? null,
      update: !!(b.id && d.first('SELECT 1 FROM mesocycles WHERE id = ?', [b.id])),
      plan: b.plan ? b.plan.map(describeGroups) : null,
      deload: b.deload ? describeGroups(b.deload) : null,
      lifts: b.lifts.filter((l) => liftOf(l.name)).map((l) => ({ name: l.name, week: l.week, text: describeGroups(l.groups) })),
    })),
    oneRms: plan.oneRms.map((r) => ({ name: r.name, kg: r.kg })),
  };
}

export interface ImportOptions {
  /** Ajouter au programme actuel, ou le remplacer (les séances types actuelles sont archivées, pas effacées). */
  mode: 'add' | 'replace';
  /** Placer les séances dans la semaine type (jours écrits dans le programme). */
  days: boolean;
  /** Enregistrer les 1RM écrits (sans écraser ceux déjà saisis). */
  oneRms: boolean;
  /** Créer les blocs écrits (ils s'enchaînent). */
  blocks: boolean;
}

export interface ImportResult {
  templates: number;
  created: number;
  days: number;
  oneRms: number;
  blocks: number;
}

/** Le créneau d'un exercice importé : format, progression, repos, consigne (ce qui n'a pas de place dédiée). */
function slotPatchOf(e: ParsedExercise): SlotPatch {
  const format: FormatChoice | undefined =
    e.seconds !== null
      ? { base: 'hold', workSec: e.seconds }
      : e.format === 'emom'
        ? { base: 'emom', everySec: e.everySeconds ?? 60, totalSec: Math.round((e.minutes ?? e.sets) * 60) }
        : e.format === 'amrap'
          ? { base: 'amrap', capSec: Math.round((e.minutes ?? 8) * 60) }
          : e.format === 'for_time'
            ? { base: 'for_time' }
            : undefined;
  const progression = e.progression ?? (e.percent !== null ? 'percent' : null);
  const reps = e.repMin ?? 5;
  const strategy: SlotPatch['strategy'] =
    e.format === 'emom'
      ? { id: 'linear', params: { sets: 1, reps, step: 1, metric: 'reps' } }
      : e.format === 'amrap'
        ? { id: 'free', params: { sets: 1 } }
        : e.seconds !== null || e.format === 'for_time' || e.amrap || progression === 'free'
          ? { id: 'free', params: { sets: e.sets } }
          : progression === 'percent'
            ? { id: 'percent_reference', params: {} }
            : progression === 'linear'
              ? { id: 'linear', params: { sets: e.sets, reps } }
              : { id: 'double_progression', params: { sets: e.sets, repMin: e.repMin, repMax: e.repMax ?? e.repMin } };
  const notes = [e.percent !== null && progression !== 'percent' ? `${num(e.percent)} % du 1RM` : '', e.kg !== null ? `${e.bodyweight ? '+' : ''}${num(e.kg)} kg` : '', e.rpe !== null ? `RPE ${num(e.rpe)}` : '', e.notes].filter(Boolean).join(' · ');
  return { ...(format ? { format } : {}), strategy, ...(e.restSeconds ? { restSec: e.restSeconds } : {}), ...(notes ? { notes } : {}) };
}

export function applyImport(d: Db, input: string, options: ImportOptions, date: string): ImportResult {
  const { plan, cycles, liftOf } = planOf(d, input);
  if (!plan) throw new Error('Rien à importer');
  const result: ImportResult = { templates: 0, created: 0, days: 0, oneRms: 0, blocks: 0 };
  d.transaction(() => {
    if (options.mode === 'replace') {
      // Remplacer ne touche qu'à ce que le fichier apporte : des cycles seuls laissent les séances en place.
      if (plan.sessions.length) for (const t of d.all<{ id: string }>('SELECT id FROM templates WHERE archived = 0')) archiveTemplate(d, t.id);
      // Les blocs pas encore commencés laissent la place aux nouveaux (les blocs passés et en cours restent), sauf ceux
      // que le fichier reprend (même identifiant) : ils sont mis à jour.
      const kept = new Set(cycles.map((b) => b.id).filter(Boolean));
      if (options.blocks && cycles.length) for (const m of d.all<{ id: string }>('SELECT id FROM mesocycles WHERE start_date > ?', [date])) if (!kept.has(m.id)) deleteBlock(d, m.id);
    }
    // 1. Les exercices inconnus de la bibliothèque (un par nom).
    const created = new Map<string, string>();
    for (const e of newExercises(plan)) {
      const id = createExercise(d, { name: e.name, loadType: e.loadType, category: e.category, equipment: e.equipment, primary: e.primaryMuscles.length ? e.primaryMuscles : ['chest'] });
      created.set(e.name.trim().toLowerCase(), id);
      result.created += 1;
    }
    // 2. Les séances types, leurs créneaux, les supersets, la semaine type.
    for (const s of plan.sessions) {
      const templateId = createTemplate(d, s.name.slice(0, 60));
      result.templates += 1;
      if (s.notes) d.run('UPDATE templates SET notes = ? WHERE id = ?', [s.notes.slice(0, 1000), templateId]);
      const slots: { id: string; group: string | null; sets: number }[] = [];
      for (const pe of s.exercises) {
        const exerciseId = pe.exerciseId ?? created.get(pe.parsed.name.trim().toLowerCase());
        if (!exerciseId) continue;
        const slotId = addSlot(d, templateId, exerciseId);
        d.run('UPDATE template_exercises SET intention = ? WHERE id = ?', [pe.intention, slotId]);
        updateSlot(d, slotId, slotPatchOf(pe.parsed));
        slots.push({ id: slotId, group: pe.parsed.group, sets: pe.parsed.sets });
      }
      // Des créneaux qui se suivent avec la même lettre s'enchaînent (superset à deux, circuit au-delà).
      for (let i = 0; i < slots.length; ) {
        let j = i;
        while (j + 1 < slots.length && slots[i]!.group && slots[j + 1]!.group === slots[i]!.group) j++;
        if (j > i) {
          const rounds = Math.max(...slots.slice(i, j + 1).map((x) => x.sets));
          for (let k = i; k < j; k++) updateSlot(d, slots[k]!.id, { group: { kind: j - i + 1 > 2 ? 'circuit' : 'superset', rounds } });
        }
        i = j + 1;
      }
      if (options.days && s.weekdays.length) {
        setTemplateDays(d, templateId, s.weekdays);
        result.days += s.weekdays.length;
      }
    }
    // 3. Les 1RM, sans écraser ceux déjà saisis (valeur notée : lest pour un lesté, comme l'app d'avant).
    if (options.oneRms) {
      for (const r of plan.oneRms) {
        const exerciseId = r.exerciseId ?? created.get(r.name.trim().toLowerCase()) ?? null;
        if (!exerciseId || d.first("SELECT 1 FROM exercise_one_rm WHERE exercise_id = ? AND mode = 'manual'", [exerciseId])) continue;
        d.run("INSERT INTO exercise_one_rm (exercise_id, value, mode, set_on, updated_at) VALUES (?, ?, 'manual', ?, ?) ON CONFLICT(exercise_id) DO UPDATE SET value = excluded.value, mode = excluded.mode, set_on = excluded.set_on, updated_at = excluded.updated_at", [exerciseId, r.kg, date, Date.now()]);
        result.oneRms += 1;
      }
    }
    // 4. Les cycles : macrocycle, blocs (enchaînés après le dernier, ou à la date écrite ; mis à jour s'ils existent
    //    déjà sous le même identifiant), semaines en groupes libres, décharge, exceptions par exercice.
    if (options.blocks) {
      const exerciseOf = (name: string) => {
        const id = liftOf(name);
        return id?.startsWith('new:') ? (created.get(id.slice(4)) ?? null) : id;
      };
      for (const b of cycles) {
        const exists = !!(b.id && d.first('SELECT 1 FROM mesocycles WHERE id = ?', [b.id]));
        const id = saveBlock(d, exists ? b.id : null, { name: b.name.slice(0, 60), kind: b.kind, workWeeks: b.weeks, deloadWeeks: b.deloadWeeks, notes: b.notes, ...(b.start ? { startDate: b.start } : {}) }, date, exists ? undefined : (b.id ?? undefined));
        d.run('UPDATE mesocycles SET macrocycle_id = ? WHERE id = ?', [b.macro ? ensureMacro(d, b.macro) : null, id]);
        if (b.plan || b.deload || b.accessories) setBlockPlan(d, id, { plan: b.plan, deload: b.deload, accessories: b.accessories });
        // Le fichier fait foi pour les exceptions d'un bloc qu'il reprend.
        if (exists) d.run('DELETE FROM cycle_week_overrides WHERE mesocycle_id = ?', [id]);
        for (const l of b.lifts) {
          const exerciseId = exerciseOf(l.name);
          if (exerciseId) setLiftGroups(d, id, exerciseId, l.week, l.groups);
        }
        result.blocks += 1;
      }
    }
  });
  return result;
}

// ---------------------------------------------------------------- partager, programmes prêts

const STRATEGY_TO_FILE: Record<string, 'percent' | 'double' | 'linear' | 'free'> = { percent_reference: 'percent', double_progression: 'double', linear: 'linear', free: 'free', autoregulated: 'free' };

/** Le programme actuel dans le format d'échange : séances, formats, supersets, semaine type, 1RM saisis, blocs. */
export function exportProgram(d: Db, name = 'Mon programme MyPerf'): ProgramFile {
  const program = readProgram(d);
  const alive = new Set(d.all<{ id: string }>('SELECT id FROM templates WHERE archived = 0').map((r) => r.id));
  const sessions = program.sessions.filter((s) => alive.has(s.id));
  const byId = new Map(program.exercises.map((e) => [e.id, e]));
  const formats = new Map([...program.formats].map((f) => [f.id, f]));
  const letters = new Map<string, string>();
  const input: ExportInput = {
    name,
    sessions: sessions.map((s) => ({
      name: s.name,
      notes: '',
      exercises: s.slots.flatMap((slot) => {
        const ex = byId.get(slot.exerciseId);
        if (!ex) return [];
        const f = formats.get(slot.formatId);
        const scheme = f?.scheme ?? (slot.formatId === 'emom' ? 'interval' : slot.formatId === 'amrap' ? 'amrap' : slot.formatId === 'hold' ? 'hold' : slot.formatId === 'for_time' ? 'for_time' : 'sets');
        const timer = f?.timer ?? (scheme === 'interval' ? { kind: 'interval' as const, everySec: 60, totalSec: 600 } : scheme === 'amrap' ? { kind: 'cap' as const, capSec: 480 } : scheme === 'hold' ? { kind: 'countdown' as const, workSec: 45 } : null);
        const p = slot.strategy.params as { sets?: number; repMin?: number | null; repMax?: number | null; reps?: number; topSets?: number | null; backoffSets?: number | null };
        if (slot.group && !letters.has(slot.group.id)) letters.set(slot.group.id, String.fromCharCode(65 + letters.size));
        const sets = scheme === 'interval' && timer?.kind === 'interval' ? Math.round(timer.totalSec / timer.everySec) : (p.sets ?? (slot.strategy.id === 'percent_reference' ? (p.topSets ?? 1) + (p.backoffSets ?? 3) : 3));
        return [
          {
            name: ex.name,
            sets: slot.group ? slot.group.rounds : sets,
            repMin: p.repMin ?? p.reps ?? ex.repRangeMin,
            repMax: p.repMax ?? p.reps ?? ex.repRangeMax,
            notes: slot.notes,
            equipment: ex.equipment as ExportInput['sessions'][number]['exercises'][number]['equipment'],
            muscles: [...ex.primaryMuscles] as ExportInput['sessions'][number]['exercises'][number]['muscles'],
            bodyweight: ex.loadType === 'bodyweight',
            seconds: scheme === 'hold' && timer?.kind === 'countdown' ? timer.workSec : null,
            format: scheme === 'interval' ? 'emom' : scheme === 'amrap' ? 'amrap' : scheme === 'for_time' ? 'for_time' : null,
            minutes: timer?.kind === 'interval' ? timer.totalSec / 60 : timer?.kind === 'cap' ? timer.capSec / 60 : null,
            everySeconds: timer?.kind === 'interval' ? timer.everySec : null,
            superset: slot.group ? letters.get(slot.group.id)! : null,
            progression: STRATEGY_TO_FILE[slot.strategy.id] ?? null,
          },
        ];
      }),
    })),
    pattern: program.structure.pattern.flatMap((p) => {
      const s = sessions.find((x) => x.id === p.templateId);
      return s ? [{ weekday: p.weekday, session: s.name }] : [];
    }),
    oneRms: d
      .all<{ exercise_id: string; value: number }>("SELECT exercise_id, value FROM exercise_one_rm WHERE mode = 'manual'")
      .flatMap((r) => (byId.has(r.exercise_id) ? [{ name: byId.get(r.exercise_id)!.name, kg: r.value }] : [])),
    blocks: exportBlocks(d),
  };
  return programToFile(input);
}

export const readyPrograms = () => READY_PROGRAMS.map((r) => ({ id: r.id, title: r.title, level: r.level, summary: r.summary }));
export const readyProgramText = (id: string): string | null => {
  const r = READY_PROGRAMS.find((x) => x.id === id);
  return r ? JSON.stringify(r.file, null, 2) : null;
};


/** Les cycles tels qu'on les échange : macrocycle, semaines toujours écrites en groupes, décharge, exceptions. */
export function exportBlocks(d: Db): ExportBlock[] {
  const program = readProgram(d);
  if (program.structure.kind !== 'periodized') return [];
  const overrides = program.structure.overrides;
  const names = new Map(program.exercises.map((e) => [e.id, e.name]));
  const macros = new Map(d.all<{ id: string; name: string; notes: string }>('SELECT id, name, notes FROM macrocycles').map((m) => [m.id, m]));
  return [...program.structure.blocks]
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
    .map((b): ExportBlock => {
      const macro = b.macrocycleId ? macros.get(b.macrocycleId) : undefined;
      const baseOf = (week: number) => (week > b.workWeeks ? b.deload.main : (b.scheme[week - 1] ?? b.scheme[0]!));
      return {
        id: b.id,
        name: b.name,
        type: b.kind,
        weeks: b.workWeeks,
        deloadWeeks: b.deloadWeeks,
        start: b.startDate,
        notes: b.notes,
        macro: macro ? { id: macro.id, name: macro.name, notes: macro.notes } : null,
        plan: b.scheme.slice(0, b.workWeeks).map(groupsOfWeek),
        deload: groupsOfWeek(b.deload.main),
        accessories: { load: b.deload.loadFactor, volume: b.deload.volumeFactor },
        lifts: overrides
          .filter((o) => o.mesocycleId === b.id && names.has(o.exerciseId) && o.weekIndex >= 1 && o.weekIndex <= b.workWeeks + b.deloadWeeks)
          .sort((x, y) => x.weekIndex - y.weekIndex)
          .map((o) => ({ name: names.get(o.exerciseId)!, week: o.weekIndex, groups: o.groups?.length ? o.groups : groupsOfWeek(weekPlan(baseOf(o.weekIndex), { topSetsOverride: null, backoffSetsOverride: null }, o)) })),
      };
    });
}
