import {
  BUILTIN_FORMATS,
  DEFAULT_REST,
  planSession,
  restSeconds,
  STRATEGIES,
  type Format,
  type ParamSpec,
  type Program,
  type StrategyId,
} from '@mylife/training';
import { dayView, type PlannedSession } from './day';
import { blocksOverview, type BlockHero, type BlockLine } from './plan';
import { historyView, readFormats, readProgram } from './queries';
import { newId, type Db } from './sql';

/**
 * Le Programme de MyPerf, côté Worker (maquettes V3-Prog-blocs, V3-Prog-routine, V3-Creneau, validées le 22/11).
 * L'écran s'adapte à la structure : des blocs (frise, tableau semaine par semaine calculé par le moteur) ou une routine
 * (prochaine séance, ce qui monte la prochaine fois). Les séances types et leurs créneaux se modifient ici ; les
 * colonnes de l'app d'avant restent tenues à jour (elle lit et écrit le même compte).
 */

const live = (d: Db) => new Set(d.all<{ id: string }>('SELECT id FROM templates WHERE archived = 0').map((r) => r.id));
const TAG: Record<string, string> = { strength: 'force', hypertrophy: 'volume', power: 'puissance' };

/** La teinte dominante d'une séance (force, volume, puissance), d'après l'intention de ses créneaux. */
function tagOf(program: Program, sessionId: string): string | null {
  const slots = program.sessions.find((s) => s.id === sessionId)?.slots ?? [];
  const count = new Map<string, number>();
  for (const s of slots) {
    const intention = s.intention ?? (s.strategy.id === 'percent_reference' ? 'strength' : 'hypertrophy');
    count.set(intention, (count.get(intention) ?? 0) + 1);
  }
  const best = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
  return best ? (TAG[best[0]] ?? null) : null;
}

export interface ProgramView {
  kind: Program['structure']['kind'];
  subtitle: string;
  hero: BlockHero | null;
  blocks: BlockLine[];
  week: { weekday: number; sessions: { id: string; name: string; exercises: string[]; tag: string | null }[] }[];
  next: { date: string; session: PlannedSession } | null;
  ups: { name: string; from: string; to: string; why: string }[];
  templates: number;
  lifts: number;
  hasProgram: boolean;
}

export function programView(d: Db, date: string): ProgramView {
  const program = readProgram(d);
  const history = historyView(d);
  const alive = live(d);
  const sessions = program.sessions.filter((s) => alive.has(s.id));
  const pattern = program.structure.pattern.filter((p) => alive.has(p.templateId));
  const nameOf = (id: string) => program.exercises.find((e) => e.id === id)?.name ?? '';
  const week = Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    sessions: pattern
      .filter((p) => p.weekday === weekday)
      .sort((a, b) => a.position - b.position)
      .flatMap((p) => {
        const s = sessions.find((x) => x.id === p.templateId);
        return s ? [{ id: s.id, name: s.name, exercises: s.slots.map((x) => nameOf(x.exerciseId)).filter(Boolean), tag: tagOf(program, s.id) }] : [];
      }),
  })).filter((w) => w.sessions.length > 0);

  const overview = blocksOverview(program, date);
  const perWeek = pattern.length;
  const subtitle = program.structure.kind === 'periodized' && overview.span ? overview.span : `Routine · ${perWeek} séance${perWeek > 1 ? 's' : ''} par semaine`;
  const lifts = new Set(sessions.flatMap((s) => s.slots.map((x) => x.exerciseId))).size;

  // Routine : la prochaine séance, et ce qui monte la prochaine fois (progression qui annonce une hausse).
  const day = dayView(d, date);
  const next = day.today[0] ? { date, session: day.today[0] } : day.next;
  const ups: ProgramView['ups'] = [];
  for (const s of sessions) {
    const plan = planSession(program, s.id, date, history);
    for (const item of plan?.items ?? []) {
      const hint = item.prescription.hint;
      if (!hint || hint.kind !== 'increase' || ups.some((u) => u.name === item.exercise.name)) continue;
      const weighted = item.exercise.loadType === 'bodyweight';
      const kg = (v: number) => `${weighted && v > 0 ? '+' : ''}${v.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} kg`;
      ups.push({
        name: item.exercise.name,
        from: kg(hint.from),
        to: kg(hint.to),
        why: item.slot.strategy.id === 'double_progression' ? 'toutes les séries au haut de la fourchette' : 'progression linéaire',
      });
    }
  }
  return { kind: program.structure.kind, subtitle, hero: overview.hero, blocks: overview.blocks, week, next, ups: ups.slice(0, 6), templates: sessions.length, lifts, hasProgram: sessions.length > 0 || overview.blocks.length > 0 };
}

// ---------------------------------------------------------------- séances types

export interface TemplateSummary {
  id: string;
  name: string;
  days: number[];
  exercises: string[];
  tag: string | null;
}

export function templatesView(d: Db): TemplateSummary[] {
  const program = readProgram(d);
  const alive = live(d);
  return program.sessions
    .filter((s) => alive.has(s.id))
    .map((s) => ({
      id: s.id,
      name: s.name,
      days: program.structure.pattern.filter((p) => p.templateId === s.id).map((p) => p.weekday).sort(),
      exercises: s.slots.map((x) => program.exercises.find((e) => e.id === x.exerciseId)?.name ?? '').filter(Boolean),
      tag: tagOf(program, s.id),
    }));
}

export interface SlotSummary {
  id: string;
  exerciseId: string;
  name: string;
  format: string;
  prescription: string;
  group: string | null;
  notes: string;
}

export interface TemplateDetail {
  id: string;
  name: string;
  days: number[];
  slots: SlotSummary[];
}

export function templateDetail(d: Db, id: string, date: string): TemplateDetail | null {
  const program = readProgram(d);
  const session = program.sessions.find((s) => s.id === id);
  if (!session || !live(d).has(id)) return null;
  const plan = planSession(program, id, date, historyView(d));
  const letters = new Map<string, string>();
  return {
    id,
    name: session.name,
    days: program.structure.pattern.filter((p) => p.templateId === id).map((p) => p.weekday).sort(),
    slots: session.slots.map((slot) => {
      const item = plan?.items.find((i) => i.slot.id === slot.id);
      const format = item?.format ?? BUILTIN_FORMATS[0]!;
      if (slot.group && !letters.has(slot.group.id)) letters.set(slot.group.id, String.fromCharCode(65 + letters.size));
      return {
        id: slot.id,
        exerciseId: slot.exerciseId,
        name: program.exercises.find((e) => e.id === slot.exerciseId)?.name ?? slot.exerciseId,
        format: format.name,
        prescription: item?.prescription.label.replace(/ @(?! )/g, ' @ ').replace(/(\d)%/g, '$1 %') ?? '',
        group: slot.group ? `${slot.group.kind === 'superset' ? 'superset' : 'circuit'} ${letters.get(slot.group.id)} · ${slot.group.rounds} tours` : null,
        notes: slot.notes,
      };
    }),
  };
}

// ---------------------------------------------------------------- un créneau

export type FormatBase = 'sets' | 'emom' | 'amrap' | 'hold' | 'for_time';

export interface FormatChoice {
  base: FormatBase;
  /** Séries : charge × reps, ou reps seules (poids du corps). */
  load?: boolean;
  everySec?: number;
  totalSec?: number;
  capSec?: number;
  workSec?: number;
}

export interface SlotDetail {
  id: string;
  templateId: string;
  templateName: string;
  exercise: { id: string; name: string; loadType: string };
  format: FormatChoice & { name: string };
  strategy: { id: StrategyId; params: Record<string, unknown> };
  strategies: { id: StrategyId; label: string; params: ParamSpec[] }[];
  group: { kind: 'superset' | 'circuit'; rounds: number; withNext: boolean } | null;
  canGroup: boolean;
  restSec: number | null;
  defaultRest: number;
  notes: string;
  preview: string;
}

/** Le choix de format tel que l'éditeur le montre, depuis un format (livré ou à soi). */
export function choiceOf(f: Format): FormatChoice {
  const t = f.timer;
  if (f.scheme === 'interval' && t.kind === 'interval') return { base: 'emom', everySec: t.everySec, totalSec: t.totalSec, load: f.metrics.includes('load') };
  if (f.scheme === 'amrap') return { base: 'amrap', capSec: t.kind === 'cap' ? t.capSec : 480 };
  if (f.scheme === 'hold') return { base: 'hold', workSec: t.kind === 'countdown' ? t.workSec : 45 };
  if (f.scheme === 'for_time') return { base: 'for_time' };
  return { base: 'sets', load: f.metrics.includes('load') };
}

const clampSec = (v: unknown, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 5 && n <= 4 * 3600 ? n : fallback;
};
const mmss = (sec: number) => (sec % 60 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : `${sec / 60} min`);

/** Le format qui correspond à un choix : un format livré s'il est identique, sinon un format à soi (créé une fois). */
export function formatFor(choice: FormatChoice): Format {
  switch (choice.base) {
    case 'emom': {
      const every = clampSec(choice.everySec, 60);
      const total = Math.max(every, clampSec(choice.totalSec, 600));
      const load = choice.load === true;
      if (every === 60 && total === 600 && !load) return BUILTIN_FORMATS.find((f) => f.id === 'emom')!;
      return { id: `emom-${every}-${total}${load ? '-load' : ''}`, name: `EMOM ${mmss(total)}${every === 60 ? '' : ` / ${every} s`}`, metrics: load ? ['load', 'reps'] : ['reps'], scheme: 'interval', timer: { kind: 'interval', everySec: every, totalSec: total } };
    }
    case 'amrap': {
      const cap = clampSec(choice.capSec, 480);
      if (cap === 480) return BUILTIN_FORMATS.find((f) => f.id === 'amrap')!;
      return { id: `amrap-${cap}`, name: `AMRAP ${mmss(cap)}`, metrics: ['rounds', 'reps'], scheme: 'amrap', timer: { kind: 'cap', capSec: cap } };
    }
    case 'hold': {
      const work = clampSec(choice.workSec, 45);
      if (work === 45) return BUILTIN_FORMATS.find((f) => f.id === 'hold')!;
      return { id: `hold-${work}`, name: `Au temps ${work} s`, metrics: ['time'], scheme: 'hold', timer: { kind: 'countdown', workSec: work } };
    }
    case 'for_time':
      return BUILTIN_FORMATS.find((f) => f.id === 'for_time')!;
    default:
      return choice.load === false
        ? { id: 'sets-reps', name: 'Séries (reps)', metrics: ['reps'], scheme: 'sets', timer: { kind: 'rest', after: 'set' } }
        : BUILTIN_FORMATS.find((f) => f.id === 'sets')!;
  }
}

function ensureFormat(d: Db, f: Format): string {
  if (BUILTIN_FORMATS.some((b) => b.id === f.id)) return f.id;
  if (!d.first('SELECT 1 FROM formats WHERE id = ?', [f.id])) d.run('INSERT INTO formats (id, spec, created_at) VALUES (?, ?, ?)', [f.id, JSON.stringify(f), Date.now()]);
  return f.id;
}

interface SlotRow {
  id: string;
  template_id: string;
  exercise_id: string;
  position: number;
  group_json: string | null;
}

const slotRows = (d: Db, templateId: string) => d.all<SlotRow>('SELECT id, template_id, exercise_id, position, group_json FROM template_exercises WHERE template_id = ? ORDER BY position', [templateId]);
const groupIdOf = (r: SlotRow | undefined) => {
  try {
    return r?.group_json ? (JSON.parse(r.group_json) as { id?: string }).id ?? null : null;
  } catch {
    return null;
  }
};

export function slotDetail(d: Db, id: string, date: string): SlotDetail | null {
  const program = readProgram(d);
  const session = program.sessions.find((s) => s.slots.some((x) => x.id === id));
  const slot = session?.slots.find((x) => x.id === id);
  if (!session || !slot) return null;
  const exercise = program.exercises.find((e) => e.id === slot.exerciseId);
  if (!exercise) return null;
  const formats = [...BUILTIN_FORMATS, ...program.formats];
  const format = formats.find((f) => f.id === slot.formatId) ?? BUILTIN_FORMATS[0]!;
  const rows = slotRows(d, session.id);
  const index = rows.findIndex((r) => r.id === id);
  const next = rows[index + 1];
  const item = planSession(program, session.id, date, historyView(d))?.items.find((i) => i.slot.id === id);
  return {
    id,
    templateId: session.id,
    templateName: session.name,
    exercise: { id: exercise.id, name: exercise.name, loadType: exercise.loadType },
    format: { ...choiceOf(format), name: format.name },
    strategy: { id: slot.strategy.id, params: slot.strategy.params },
    strategies: (Object.keys(STRATEGIES) as StrategyId[]).map((sid) => ({ id: sid, label: STRATEGIES[sid].label, params: [...STRATEGIES[sid].params] })),
    group: slot.group ? { kind: slot.group.kind, rounds: slot.group.rounds, withNext: next !== undefined && groupIdOf(next) === slot.group.id } : null,
    canGroup: next !== undefined,
    restSec: slot.restSec,
    defaultRest: restSeconds(DEFAULT_REST, exercise.category, slot.intention ?? (slot.strategy.id === 'percent_reference' ? 'strength' : 'hypertrophy'), 'working'),
    notes: slot.notes,
    preview: item?.prescription.label.replace(/ @(?! )/g, ' @ ').replace(/(\d)%/g, '$1 %') ?? '',
  };
}

export interface SlotPatch {
  format?: FormatChoice;
  strategy?: { id: StrategyId; params: Record<string, unknown> };
  /** Grouper avec le créneau suivant (superset ou circuit) ; null : dégrouper. */
  group?: { kind: 'superset' | 'circuit'; rounds: number } | null;
  restSec?: number | null;
  notes?: string;
}

/** Les réglages d'une progression, bornés par sa définition (rien d'inconnu n'est gardé). */
function cleanParams(id: StrategyId, params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const spec of STRATEGIES[id].params) {
    const v = params[spec.key];
    if (v === null || v === undefined || v === '') continue;
    if (spec.kind === 'int' || spec.kind === 'number' || spec.kind === 'percent') {
      let n = Number(v);
      if (!Number.isFinite(n)) continue;
      if (spec.kind === 'int') n = Math.round(n);
      if (spec.min !== undefined) n = Math.max(spec.min, n);
      if (spec.max !== undefined) n = Math.min(spec.max, n);
      out[spec.key] = n;
    } else out[spec.key] = typeof v === 'string' ? v.slice(0, 40) : v;
  }
  return out;
}

export function updateSlot(d: Db, id: string, patch: SlotPatch): void {
  const row = d.first<SlotRow>('SELECT id, template_id, exercise_id, position, group_json FROM template_exercises WHERE id = ?', [id]);
  if (!row) throw new Error('Créneau introuvable');
  d.transaction(() => {
    if (patch.format) d.run('UPDATE template_exercises SET format_id = ? WHERE id = ?', [ensureFormat(d, formatFor(patch.format)), id]);
    if (patch.strategy) {
      const sid = patch.strategy.id;
      if (!STRATEGIES[sid]) throw new Error('Progression inconnue');
      const p = cleanParams(sid, patch.strategy.params);
      const num = (k: string) => (typeof p[k] === 'number' ? (p[k] as number) : null);
      // Les colonnes de l'app d'avant suivent : au % → top set + backoffs ; le reste → séries et fourchette.
      if (sid === 'percent_reference')
        d.run("UPDATE template_exercises SET progression_type = 'top_set_backoff', top_sets = ?, backoff_sets = ?, backoff_percent = ?, strategy = NULL WHERE id = ?", [num('topSets'), num('backoffSets'), num('backoffPercent'), id]);
      else if (sid === 'double_progression')
        d.run("UPDATE template_exercises SET progression_type = 'double_progression', target_sets = ?, rep_min = ?, rep_max = ?, strategy = NULL WHERE id = ?", [num('sets') ?? 3, num('repMin'), num('repMax'), id]);
      else
        d.run("UPDATE template_exercises SET progression_type = 'double_progression', target_sets = ?, rep_min = ?, rep_max = ?, strategy = ? WHERE id = ?", [num('sets') ?? 3, num('reps'), num('reps'), JSON.stringify({ id: sid, params: p }), id]);
    }
    if ('restSec' in patch) {
      const r = patch.restSec;
      d.run('UPDATE template_exercises SET rest_sec = ? WHERE id = ?', [r === null || r === undefined ? null : clampSec(r, 120), id]);
    }
    if ('notes' in patch) d.run('UPDATE template_exercises SET notes = ? WHERE id = ?', [(patch.notes ?? '').trim().slice(0, 1000), id]);
    if ('group' in patch) setGroup(d, row, patch.group ?? null);
  });
}

/** Groupe ce créneau avec le suivant (même groupe pour les deux, tours communs), ou le sort de son groupe. */
function setGroup(d: Db, row: SlotRow, group: { kind: 'superset' | 'circuit'; rounds: number } | null) {
  const rows = slotRows(d, row.template_id);
  const index = rows.findIndex((r) => r.id === row.id);
  const mine = groupIdOf(rows[index]);
  const write = (gid: string | null, ids: string[], g: { kind: string; rounds: number } | null) => {
    for (const sid of ids) d.run('UPDATE template_exercises SET group_json = ? WHERE id = ?', [gid && g ? JSON.stringify({ id: gid, kind: g.kind, rounds: g.rounds }) : null, sid]);
  };
  if (group === null) {
    write(null, [row.id], null);
    // Un groupe réduit à un seul créneau n'en est plus un.
    if (mine) {
      const rest = rows.filter((r) => r.id !== row.id && groupIdOf(r) === mine);
      if (rest.length === 1) write(null, [rest[0]!.id], null);
    }
    return;
  }
  const next = rows[index + 1];
  if (!next) throw new Error('Pas de créneau après celui-ci');
  const rounds = Math.max(1, Math.min(20, Math.round(group.rounds) || 3));
  const gid = mine ?? groupIdOf(next) ?? `g_${newId()}`;
  const members = rows.filter((r) => r.id === row.id || r.id === next.id || (groupIdOf(r) !== null && (groupIdOf(r) === mine || groupIdOf(r) === groupIdOf(next))));
  write(gid, members.map((r) => r.id), { kind: group.kind, rounds });
}

// ---------------------------------------------------------------- écrire les séances types

export function createTemplate(d: Db, name: string, createAs?: string): string {
  const clean = name.trim();
  if (!clean || clean.length > 60) throw new Error('Nom invalide');
  const id = createAs ?? newId();
  const pos = d.first<{ p: number | null }>('SELECT MAX(position) AS p FROM templates')?.p ?? -1;
  d.run('INSERT INTO templates (id, name, notes, position, archived, created_at) VALUES (?, ?, ?, ?, 0, ?)', [id, clean, '', pos + 1, Date.now()]);
  return id;
}

export function renameTemplate(d: Db, id: string, name: string): void {
  const clean = name.trim();
  if (!clean || clean.length > 60) throw new Error('Nom invalide');
  d.run('UPDATE templates SET name = ? WHERE id = ?', [clean, id]);
}

/** Archivée, pas effacée (les séances passées la citent) : elle quitte la semaine type et le planning à venir. */
export function archiveTemplate(d: Db, id: string): void {
  d.transaction(() => {
    d.run('UPDATE templates SET archived = 1 WHERE id = ?', [id]);
    d.run('DELETE FROM week_pattern WHERE template_id = ?', [id]);
    d.run('DELETE FROM planned_sessions WHERE template_id = ? AND workout_id IS NULL', [id]);
    d.run('DELETE FROM session_moves WHERE template_id = ?', [id]);
  });
}

/** Les jours de la semaine type où tombe cette séance (lundi = 0). */
export function setTemplateDays(d: Db, id: string, days: readonly number[]): void {
  const wanted = [...new Set(days.filter((x) => Number.isInteger(x) && x >= 0 && x <= 6))];
  d.transaction(() => {
    const existing = d.all<{ id: string; weekday: number }>('SELECT id, weekday FROM week_pattern WHERE template_id = ?', [id]);
    for (const r of existing) if (!wanted.includes(r.weekday)) d.run('DELETE FROM week_pattern WHERE id = ?', [r.id]);
    for (const day of wanted) {
      if (existing.some((r) => r.weekday === day)) continue;
      const pos = d.first<{ p: number | null }>('SELECT MAX(position) AS p FROM week_pattern WHERE weekday = ?', [day])?.p ?? -1;
      d.run('INSERT INTO week_pattern (id, weekday, template_id, position) VALUES (?, ?, ?, ?)', [newId(), day, id, pos + 1]);
    }
  });
}

/** Un exercice de plus dans la séance type, réglé comme l'app d'avant (intention de l'exercice, sa progression). */
export function addSlot(d: Db, templateId: string, exerciseId: string, createAs?: string): string {
  const ex = d.first<{ progression_type: string; category: string }>('SELECT progression_type, category FROM exercises WHERE id = ? AND archived = 0', [exerciseId]);
  if (!ex) throw new Error('Exercice introuvable');
  if (!d.first('SELECT 1 FROM templates WHERE id = ? AND archived = 0', [templateId])) throw new Error('Séance introuvable');
  const id = createAs ?? newId();
  const pos = d.first<{ p: number | null }>('SELECT MAX(position) AS p FROM template_exercises WHERE template_id = ?', [templateId])?.p ?? -1;
  const intention = ex.progression_type === 'top_set_backoff' || ex.category === 'main' ? 'strength' : 'hypertrophy';
  d.run(
    `INSERT INTO template_exercises (id, template_id, exercise_id, position, intention, target_sets, rep_min, rep_max, top_sets, backoff_sets, backoff_percent, notes)
     VALUES (?, ?, ?, ?, ?, 3, NULL, NULL, NULL, NULL, NULL, '')`,
    [id, templateId, exerciseId, pos + 1, intention],
  );
  return id;
}

export function removeSlot(d: Db, id: string): void {
  const row = d.first<SlotRow>('SELECT id, template_id, exercise_id, position, group_json FROM template_exercises WHERE id = ?', [id]);
  if (!row) return;
  d.transaction(() => {
    if (groupIdOf(row)) setGroup(d, row, null);
    d.run('DELETE FROM template_exercises WHERE id = ?', [id]);
  });
}

/** Monte ou descend un créneau dans sa séance. */
export function moveSlot(d: Db, id: string, delta: -1 | 1): void {
  const row = d.first<SlotRow>('SELECT id, template_id, exercise_id, position, group_json FROM template_exercises WHERE id = ?', [id]);
  if (!row) return;
  const rows = slotRows(d, row.template_id);
  const i = rows.findIndex((r) => r.id === id);
  const j = i + delta;
  if (j < 0 || j >= rows.length) return;
  [rows[i], rows[j]] = [rows[j]!, rows[i]!];
  d.transaction(() => rows.forEach((r, k) => d.run('UPDATE template_exercises SET position = ? WHERE id = ?', [k, r.id])));
}

/** Les formats proposés dans l'éditeur (livrés, puis les siens). */
export const formatChoices = (d: Db): Format[] => [...BUILTIN_FORMATS, ...readFormats(d)];

