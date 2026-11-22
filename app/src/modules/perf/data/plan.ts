import {
  addDays,
  DEFAULT_DELOAD,
  DEFAULT_PLATES,
  DEFAULT_REST,
  diffDays,
  generateScheme,
  MESO_KINDS,
  mesoKindInfo,
  planSession,
  referenceFor,
  resizeScheme,
  schemeForKind,
  STRATEGIES,
  totalWeeks,
  type HistoryView,
  type Mesocycle,
  type Program,
  type RestSettings,
  type StrengthWeek,
} from '@mylife/training';
import { historyView, readProgram } from './queries';
import { newId, type Db } from './sql';

/**
 * Les réglages d'entraînement de MyPerf, côté Worker (maquettes E1 à E4, validées le 22/11) : un seul endroit pour
 * toutes les métriques. Les blocs (structure semaine par semaine pour tous les lifts au %), chaque exercice (1RM de
 * référence, semaines ajustées, progression), les valeurs de base (incrément, barre et disques, repos, poids du corps).
 * Tout s'écrit dans les tables de l'app d'avant, au même format (elle lit et écrit le même compte).
 */

const pct = (v: number) => `${(Math.round(v * 1000) / 10).toLocaleString('fr-FR')} %`;
const shortDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
const kgText = (v: number, weighted: boolean) => `${weighted && v > 0 ? '+' : ''}${v.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} kg`;
const reps = (min: number, max: number) => (min === max ? `${min}` : `${min}-${max}`);
const liveTemplates = (d: Db) => new Set(d.all<{ id: string }>('SELECT id FROM templates WHERE archived = 0').map((r) => r.id));

export interface WeekScheme {
  /** 1 à n, puis n+1 pour la décharge. */
  index: number;
  label: string;
  deload: boolean;
  week: StrengthWeek;
  top: string;
  topPct: string;
  back: string | null;
  backPct: string | null;
}

/** Les semaines d'un bloc telles que tous les lifts au % les suivent (décharge comprise). */
export function blockWeeks(m: Mesocycle): WeekScheme[] {
  const weeks: { week: StrengthWeek; deload: boolean }[] = [...m.scheme.slice(0, m.workWeeks).map((week) => ({ week, deload: false }))];
  for (let i = 0; i < m.deloadWeeks; i++) weeks.push({ week: m.deload.main, deload: true });
  return weeks.map(({ week, deload }, i) => ({
    index: i + 1,
    label: deload ? (m.deloadWeeks > 1 ? `Déch. ${i + 1 - m.workWeeks}` : 'Déch.') : `S${i + 1}`,
    deload,
    week,
    top: `${week.topSets}×${reps(week.topRepsMin, week.topRepsMax)}`,
    topPct: pct(week.topPercent),
    back: week.backoffSets > 0 ? `${week.backoffSets}×${week.backoffReps}` : null,
    backPct: week.backoffSets > 0 ? pct(week.backoffPercent) : null,
  }));
}

const blocksOf = (p: Program): Mesocycle[] => (p.structure.kind === 'periodized' ? [...p.structure.blocks].sort((a, b) => a.startDate.localeCompare(b.startDate)) : []);
const endOf = (m: Pick<Mesocycle, 'startDate' | 'workWeeks' | 'deloadWeeks'>) => addDays(m.startDate, totalWeeks(m) * 7 - 1);
const blockAt = (blocks: readonly Mesocycle[], date: string) => blocks.find((m) => date >= m.startDate && date <= endOf(m)) ?? null;

export interface BlockLine {
  id: string;
  name: string;
  kind: string;
  kindLabel: string;
  dates: string;
  weeks: string;
  state: 'past' | 'current' | 'future';
}

export interface BlockHero {
  id: string;
  name: string;
  kindLabel: string;
  index: number;
  total: number;
  dates: string;
  deloadFrom: number | null;
  /** Semaine en cours (1 à n+décharge), null si le bloc n'a pas commencé. */
  week: number | null;
  weeks: { label: string; pct: string; state: 'past' | 'current' | 'future'; deload: boolean }[];
}

/** La carte du bloc en cours (ou du prochain) et la liste lisible des blocs (E1). */
export function blocksOverview(program: Program, date: string): { hero: BlockHero | null; blocks: BlockLine[]; span: string } {
  const list = blocksOf(program);
  const current = blockAt(list, date);
  const shown = current ?? list.find((m) => m.startDate > date) ?? null;
  const blocks = list.map(
    (m): BlockLine => ({
      id: m.id,
      name: m.name,
      kind: m.kind,
      kindLabel: mesoKindInfo(m.kind).label,
      dates: `${shortDate(m.startDate)} → ${shortDate(endOf(m))}`,
      weeks: m.deloadWeeks ? `${m.workWeeks} + ${m.deloadWeeks} sem.` : `${m.workWeeks} sem.`,
      state: m === current ? 'current' : endOf(m) < date ? 'past' : 'future',
    }),
  );
  const first = list[0];
  const last = list[list.length - 1];
  const total = list.reduce((n, m) => n + totalWeeks(m), 0);
  const span = first && last ? `Par blocs · ${shortDate(first.startDate)} → ${shortDate(endOf(last))} · ${total} semaines` : '';
  if (!shown) return { hero: null, blocks, span };
  const week = shown === current ? Math.floor(diffDays(shown.startDate, date) / 7) + 1 : null;
  return {
    hero: {
      id: shown.id,
      name: shown.name,
      kindLabel: mesoKindInfo(shown.kind).label,
      index: list.indexOf(shown) + 1,
      total: list.length,
      dates: `${shortDate(shown.startDate)} → ${shortDate(endOf(shown))}`,
      deloadFrom: shown.deloadWeeks > 0 ? shown.workWeeks + 1 : null,
      week,
      weeks: blockWeeks(shown).map((w) => ({ label: w.label, pct: w.topPct, deload: w.deload, state: week === null ? 'future' : w.index < week ? 'past' : w.index === week ? 'current' : 'future' })),
    },
    blocks,
    span,
  };
}

// ---------------------------------------------------------------- réglages d'entraînement (E2)

interface AppSettings {
  increment: number;
  barWeight: number;
  plates: number[];
  rest: RestSettings;
}

function readApp(d: Db): Record<string, unknown> {
  const raw = d.first<{ value: string }>("SELECT value FROM settings WHERE key = 'app'")?.value;
  try {
    const v: unknown = raw ? JSON.parse(raw) : {};
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function appSettings(d: Db): AppSettings {
  const s = readApp(d);
  const num = (v: unknown, f: number) => (typeof v === 'number' && Number.isFinite(v) ? v : f);
  const rest = (s.rest ?? {}) as Partial<RestSettings>;
  return {
    increment: num(s.increment, 2.5),
    barWeight: num(s.barWeight, 20),
    plates: Array.isArray(s.plates) && s.plates.every((p) => typeof p === 'number') ? (s.plates as number[]) : [...DEFAULT_PLATES],
    rest: { floors: { ...DEFAULT_REST.floors, ...(rest.floors ?? {}) }, byIntention: { ...DEFAULT_REST.byIntention, ...(rest.byIntention ?? {}) }, warmup: num(rest.warmup, DEFAULT_REST.warmup) },
  };
}

/** Le 1RM tel qu'on le montre : lest net pour un lesté, jamais la masse totale. */
function shownReference(program: Program, h: HistoryView, exerciseId: string, date: string, ignoreTyped = false): { value: number; source: 'saisi' | 'estimé' } | null {
  const exercise = program.exercises.find((e) => e.id === exerciseId);
  if (!exercise) return null;
  const history: HistoryView = ignoreTyped ? { ...h, typedOneRm: () => null } : h;
  const bw = h.bodyweight(date);
  const ref = referenceFor(program, history, exercise, date, bw);
  if (!ref) return null;
  const weighted = exercise.loadType === 'bodyweight';
  return { value: Math.round((weighted ? ref.value - ref.basis.bodyweight : ref.value) * 10) / 10, source: ref.basis.kind === 'manual' ? 'saisi' : 'estimé' };
}

export interface SettingsView {
  blocks: { id: string; name: string; current: boolean }[];
  block: { id: string; name: string; weeks: WeekScheme[]; currentWeek: number | null } | null;
  lifts: { exerciseId: string; name: string; reference: string | null; source: string | null; adjusted: string[] }[];
  others: { slotId: string; exerciseId: string; name: string; detail: string }[];
  base: { increment: string; bar: string; rest: string; bodyweight: string | null };
}

const CAT_LABEL: Record<string, string> = { main: 'principaux', compound: 'polyarticulaires', isolation: 'isolations' };
const clock = (s: number) => (s % 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s / 60} min`);

export function settingsView(d: Db, date: string, blockId: string | null): SettingsView {
  const program = readProgram(d);
  const h = historyView(d);
  const alive = liveTemplates(d);
  const sessions = program.sessions.filter((s) => alive.has(s.id));
  const list = blocksOf(program);
  const current = blockAt(list, date);
  const block = list.find((m) => m.id === blockId) ?? current ?? list.find((m) => m.startDate > date) ?? list[list.length - 1] ?? null;
  const nameOf = (id: string) => program.exercises.find((e) => e.id === id)?.name ?? id;
  const liftIds = [...new Set(sessions.flatMap((s) => s.slots.filter((x) => x.strategy.id === 'percent_reference').map((x) => x.exerciseId)))];
  const overrides = block && program.structure.kind === 'periodized' ? program.structure.overrides.filter((o) => o.mesocycleId === block.id) : [];
  const weeks = block ? blockWeeks(block) : [];
  const lifts = liftIds.map((id) => {
    const ref = shownReference(program, h, id, date);
    const weighted = program.exercises.find((e) => e.id === id)?.loadType === 'bodyweight';
    return {
      exerciseId: id,
      name: nameOf(id),
      reference: ref ? kgText(ref.value, weighted) : null,
      source: ref?.source ?? null,
      adjusted: overrides.filter((o) => o.exerciseId === id).map((o) => weeks.find((w) => w.index === o.weekIndex)?.label ?? `S${o.weekIndex}`),
    };
  });
  // Les autres créneaux (une ligne par exercice et par réglage) : la progression et ce qu'elle prescrit aujourd'hui.
  const others: SettingsView['others'] = [];
  for (const s of sessions) {
    const plan = planSession(program, s.id, date, h);
    for (const slot of s.slots) {
      if (slot.strategy.id === 'percent_reference') continue;
      const item = plan?.items.find((i) => i.slot.id === slot.id);
      const label = item?.prescription.label ?? '';
      const detail = [STRATEGIES[slot.strategy.id]?.label.toLowerCase() ?? slot.strategy.id, label].filter(Boolean).join(' · ');
      if (others.some((o) => o.exerciseId === slot.exerciseId && o.detail === detail)) continue;
      others.push({ slotId: slot.id, exerciseId: slot.exerciseId, name: nameOf(slot.exerciseId), detail });
    }
  }
  const app = appSettings(d);
  const bw = h.bodyweight(date);
  return {
    blocks: list.map((m) => ({ id: m.id, name: m.name, current: m === current })),
    block: block ? { id: block.id, name: block.name, weeks, currentWeek: block === current ? Math.floor(diffDays(block.startDate, date) / 7) + 1 : null } : null,
    lifts,
    others,
    base: {
      increment: kgText(app.increment, false),
      bar: `${kgText(app.barWeight, false)} · ${[...app.plates].sort((a, b) => b - a).map((p) => p.toLocaleString('fr-FR')).join(', ')}`,
      rest: (['main', 'compound', 'isolation'] as const).map((c) => `${CAT_LABEL[c]} ${clock(app.rest.floors[c])}`).join(' · '),
      bodyweight: bw === null ? null : kgText(bw, false),
    },
  };
}

// ---------------------------------------------------------------- un lift, semaine par semaine (E3)

export interface LiftCell {
  index: number;
  label: string;
  current: boolean;
  deload: boolean;
  adjusted: boolean;
  top: string | null;
  topPct: string | null;
  back: string | null;
  backPct: string | null;
  /** Les valeurs de la semaine telles que l'éditeur les montre (réglage de l'exercice, sinon celui du bloc). */
  values: StrengthWeek;
  /** Charges que ça donne (lest net pour un lesté), si un 1RM est connu. */
  loads: { top: string | null; back: string | null };
}

export interface LiftView {
  exerciseId: string;
  name: string;
  weighted: boolean;
  block: { id: string; name: string } | null;
  blocks: { id: string; name: string; current: boolean }[];
  reference: { value: number; text: string; source: 'saisi' | 'estimé' } | null;
  estimate: string | null;
  bodyweight: number | null;
  weeks: LiftCell[];
}

export function liftView(d: Db, exerciseId: string, blockId: string | null, date: string): LiftView | null {
  const program = readProgram(d);
  const exercise = program.exercises.find((e) => e.id === exerciseId);
  if (!exercise) return null;
  const h = historyView(d);
  const alive = liveTemplates(d);
  const list = blocksOf(program);
  const current = blockAt(list, date);
  const block = list.find((m) => m.id === blockId) ?? current ?? list.find((m) => m.startDate > date) ?? list[list.length - 1] ?? null;
  const weighted = exercise.loadType === 'bodyweight';
  const ref = shownReference(program, h, exerciseId, date);
  const estimate = ref?.source === 'saisi' ? shownReference(program, h, exerciseId, date, true) : null;
  const bw = h.bodyweight(date);
  const weeks: LiftCell[] = [];
  if (block) {
    const session = program.sessions.find((s) => alive.has(s.id) && s.slots.some((x) => x.exerciseId === exerciseId && x.strategy.id === 'percent_reference'));
    const weekday = session ? (program.structure.pattern.find((p) => p.templateId === session.id)?.weekday ?? 0) : 0;
    const overrides = program.structure.kind === 'periodized' ? program.structure.overrides.filter((o) => o.mesocycleId === block.id && o.exerciseId === exerciseId) : [];
    const currentWeek = block === current ? Math.floor(diffDays(block.startDate, date) / 7) + 1 : null;
    for (const w of blockWeeks(block)) {
      const item = session ? planSession(program, session.id, addDays(block.startDate, (w.index - 1) * 7 + weekday), h)?.items.find((i) => i.exercise.id === exerciseId) : undefined;
      const sets = item?.prescription.sets ?? [];
      const tops = sets.filter((s) => s.setType === 'top_set');
      const backs = sets.filter((s) => s.setType === 'backoff');
      const percents = item?.prescription.percents ?? null;
      const o = overrides.find((x) => x.weekIndex === w.index);
      const values: StrengthWeek = {
        topSets: o?.topSets ?? w.week.topSets,
        topRepsMin: o?.topRepsMin ?? w.week.topRepsMin,
        topRepsMax: o?.topRepsMax ?? o?.topRepsMin ?? w.week.topRepsMax,
        topPercent: o?.topPercent ?? w.week.topPercent,
        backoffSets: o?.backoffSets ?? w.week.backoffSets,
        backoffReps: o?.backoffReps ?? w.week.backoffReps,
        backoffPercent: o?.backoffPercent ?? w.week.backoffPercent,
      };
      weeks.push({
        index: w.index,
        label: w.label,
        current: currentWeek === w.index,
        deload: w.deload,
        adjusted: o !== undefined,
        top: tops.length ? `${tops.length}×${tops[0]!.targetReps ?? '?'}` : `${values.topSets}×${reps(values.topRepsMin, values.topRepsMax)}`,
        topPct: percents ? pct(percents.top) : pct(values.topPercent),
        back: backs.length ? `${backs.length}×${backs[0]!.targetReps ?? '?'}` : values.backoffSets > 0 ? `${values.backoffSets}×${values.backoffReps}` : null,
        backPct: backs.length || values.backoffSets > 0 ? (percents ? pct(percents.backoff) : pct(values.backoffPercent)) : null,
        values,
        loads: {
          top: tops[0]?.targetWeight != null ? kgText(tops[0].targetWeight, weighted) : null,
          back: backs[0]?.targetWeight != null ? kgText(backs[0].targetWeight, weighted) : null,
        },
      });
    }
  }
  return {
    exerciseId,
    name: exercise.name,
    weighted,
    block: block ? { id: block.id, name: block.name } : null,
    blocks: list.map((m) => ({ id: m.id, name: m.name, current: m === current })),
    reference: ref ? { value: ref.value, text: kgText(ref.value, weighted), source: ref.source } : null,
    estimate: estimate ? kgText(estimate.value, weighted) : null,
    bodyweight: bw,
    weeks,
  };
}

const clampInt = (v: unknown, min: number, max: number, f: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : f;
};
const clampPct = (v: unknown, f: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0.3, Math.min(1.1, Math.round(n * 1000) / 1000)) : f;
};

/** Une semaine propre : séries et reps bornées (top set 1 à 5 reps, backoffs 0 à 8 séries), % entre 30 et 110. */
function cleanWeek(w: Partial<StrengthWeek>, base: StrengthWeek): StrengthWeek {
  const topRepsMin = clampInt(w.topRepsMin, 1, 10, base.topRepsMin);
  return {
    topSets: clampInt(w.topSets, 0, 5, base.topSets),
    topRepsMin,
    topRepsMax: Math.max(topRepsMin, clampInt(w.topRepsMax ?? topRepsMin, 1, 10, topRepsMin)),
    topPercent: clampPct(w.topPercent, base.topPercent),
    backoffSets: clampInt(w.backoffSets, 0, 8, base.backoffSets),
    backoffReps: clampInt(w.backoffReps, 1, 12, base.backoffReps),
    backoffPercent: clampPct(w.backoffPercent, base.backoffPercent),
  };
}

/** Ajuste une semaine d'un exercice dans un bloc (comme l'app d'avant : `cycle_week_overrides`) ; null : « Auto ». */
export function setLiftWeek(d: Db, blockId: string, exerciseId: string, weekIndex: number, week: Partial<StrengthWeek> | null): void {
  const block = blocksOf(readProgram(d)).find((m) => m.id === blockId);
  if (!block) throw new Error('Bloc introuvable');
  if (!Number.isInteger(weekIndex) || weekIndex < 1 || weekIndex > totalWeeks(block)) throw new Error('Semaine invalide');
  if (week === null) {
    d.run('DELETE FROM cycle_week_overrides WHERE mesocycle_id = ? AND exercise_id = ? AND week_index = ?', [blockId, exerciseId, weekIndex]);
    return;
  }
  const base = blockWeeks(block).find((w) => w.index === weekIndex)!.week;
  const w = cleanWeek(week, base);
  d.run(
    `INSERT INTO cycle_week_overrides (id, mesocycle_id, exercise_id, week_index, top_sets, top_reps_min, top_reps_max, backoff_sets, backoff_reps, backoff_percent, intensity)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(mesocycle_id, exercise_id, week_index) DO UPDATE SET top_sets = excluded.top_sets, top_reps_min = excluded.top_reps_min,
       top_reps_max = excluded.top_reps_max, backoff_sets = excluded.backoff_sets, backoff_reps = excluded.backoff_reps,
       backoff_percent = excluded.backoff_percent, intensity = excluded.intensity`,
    [newId(), blockId, exerciseId, weekIndex, w.topSets, w.topRepsMin, w.topRepsMax, w.backoffSets, w.backoffReps, w.backoffPercent, w.topPercent],
  );
}

/** Le 1RM de référence saisi (lest net pour un lesté, comme l'app d'avant le note) ; null : revenir à l'estimation. */
export function setReference(d: Db, exerciseId: string, value: number | null, date: string): void {
  if (!d.first('SELECT 1 FROM exercises WHERE id = ?', [exerciseId])) throw new Error('Exercice introuvable');
  if (value === null) return void d.run('DELETE FROM exercise_one_rm WHERE exercise_id = ?', [exerciseId]);
  if (!Number.isFinite(value) || value < -200 || value > 1000) throw new Error('1RM invalide');
  d.run(
    `INSERT INTO exercise_one_rm (exercise_id, value, mode, set_on, updated_at) VALUES (?, ?, 'manual', ?, ?)
     ON CONFLICT(exercise_id) DO UPDATE SET value = excluded.value, mode = excluded.mode, set_on = excluded.set_on, updated_at = excluded.updated_at`,
    [exerciseId, Math.round(value * 10) / 10, date, Date.now()],
  );
}

// ---------------------------------------------------------------- un bloc (E4)

export interface BlockDetail {
  id: string | null;
  name: string;
  kind: string;
  kinds: { id: string; label: string; hint: string }[];
  startDate: string;
  workWeeks: number;
  deloadWeeks: number;
  dates: string;
  index: number;
  total: number;
  weeks: WeekScheme[];
}

const KIND_HINT: Record<string, string> = { accumulation: 'volume', transmutation: 'intensité', realization: 'test du max', transition: 'récupérer', custom: 'à toi' };

function nextCycleName(names: readonly string[]): string {
  const numbers = names.flatMap((n) => {
    const m = /^cycle\s+(\d+)/i.exec(n.trim());
    return m?.[1] === undefined ? [] : [Number(m[1])];
  });
  return `Cycle ${numbers.length === 0 ? names.length + 1 : Math.max(...numbers) + 1}`;
}

/** Un nouveau bloc : enchaîné après le dernier, même forme (comme l'app d'avant). */
function draftBlock(list: readonly Mesocycle[], date: string): Mesocycle {
  const last = list[list.length - 1];
  const monday = addDays(date, -((new Date(`${date}T12:00:00`).getDay() + 6) % 7));
  if (!last) return { id: '', name: 'Cycle 1', kind: 'accumulation', macrocycleId: null, startDate: monday, workWeeks: 4, deloadWeeks: 1, scheme: generateScheme(4), deload: { ...DEFAULT_DELOAD, main: { ...DEFAULT_DELOAD.main } }, notes: '' };
  return { ...last, id: '', name: nextCycleName(list.map((m) => m.name)), startDate: addDays(last.startDate, totalWeeks(last) * 7), scheme: last.scheme.map((w) => ({ ...w })), deload: { ...last.deload, main: { ...last.deload.main } }, notes: '' };
}

export function blockDetail(d: Db, id: string | null, date: string): BlockDetail | null {
  const list = blocksOf(readProgram(d));
  const m = id ? list.find((x) => x.id === id) : draftBlock(list, date);
  if (!m) return null;
  return {
    id: id ?? null,
    name: m.name,
    kind: m.kind,
    kinds: MESO_KINDS.map((k) => ({ id: k.kind, label: k.label, hint: KIND_HINT[k.kind] ?? '' })),
    startDate: m.startDate,
    workWeeks: m.workWeeks,
    deloadWeeks: m.deloadWeeks,
    dates: `${shortDate(m.startDate)} → ${shortDate(endOf(m))}`,
    index: id ? list.indexOf(m) + 1 : list.length + 1,
    total: id ? list.length : list.length + 1,
    weeks: blockWeeks(m),
  };
}

function writeBlock(d: Db, m: Mesocycle) {
  d.run(
    `INSERT INTO mesocycles (id, name, macrocycle_id, start_date, work_weeks, deload_weeks, scheme, deload_load_factor, deload_volume_factor, deload_top_reps, deload_backoff_reps, deload_main, kind, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, macrocycle_id = excluded.macrocycle_id, start_date = excluded.start_date, work_weeks = excluded.work_weeks,
       deload_weeks = excluded.deload_weeks, scheme = excluded.scheme, deload_load_factor = excluded.deload_load_factor, deload_volume_factor = excluded.deload_volume_factor,
       deload_top_reps = excluded.deload_top_reps, deload_backoff_reps = excluded.deload_backoff_reps, deload_main = excluded.deload_main, kind = excluded.kind, notes = excluded.notes`,
    [m.id, m.name.trim(), m.macrocycleId, m.startDate, m.workWeeks, m.deloadWeeks, JSON.stringify(m.scheme), m.deload.loadFactor, m.deload.volumeFactor, m.deload.main.topRepsMin, m.deload.main.backoffReps, JSON.stringify(m.deload.main), m.kind, m.notes, Date.now()],
  );
}

export interface BlockPatch {
  name?: string;
  kind?: string;
  startDate?: string;
  workWeeks?: number;
  deloadWeeks?: number;
}

/**
 * Crée ou modifie un bloc. Un autre type pré-remplit les semaines ; une autre durée les recalcule en gardant celles
 * déjà réglées ; les blocs qui suivaient se décalent d'autant (ils restent enchaînés).
 */
export function saveBlock(d: Db, id: string | null, patch: BlockPatch, date: string): string {
  const list = blocksOf(readProgram(d));
  const before = id ? list.find((x) => x.id === id) : draftBlock(list, date);
  if (!before) throw new Error('Bloc introuvable');
  const kind = MESO_KINDS.some((k) => k.kind === patch.kind) ? (patch.kind as Mesocycle['kind']) : before.kind;
  const workWeeks = clampInt(patch.workWeeks ?? before.workWeeks, 1, 12, before.workWeeks);
  const deloadWeeks = clampInt(patch.deloadWeeks ?? before.deloadWeeks, 0, 2, before.deloadWeeks);
  const startDate = patch.startDate && /^\d{4}-\d{2}-\d{2}$/.test(patch.startDate) ? patch.startDate : before.startDate;
  const name = (patch.name ?? before.name).trim();
  if (!name || name.length > 60) throw new Error('Nom invalide');
  const scheme = kind !== before.kind ? (schemeForKind(kind, workWeeks) ?? resizeScheme(before.scheme, workWeeks)) : workWeeks !== before.workWeeks ? resizeScheme(before.scheme, workWeeks, kind) : before.scheme;
  const after: Mesocycle = { ...before, id: id ?? newId(), name, kind, startDate, workWeeks, deloadWeeks, scheme };
  d.transaction(() => {
    writeBlock(d, after);
    if (id) {
      // Les blocs qui commençaient après l'ancien se décalent de la même durée (ils restent enchaînés).
      const shift = diffDays(endOf(before), endOf(after));
      if (shift !== 0) for (const m of list) if (m.id !== id && m.startDate > endOf(before)) d.run('UPDATE mesocycles SET start_date = ? WHERE id = ?', [addDays(m.startDate, shift), m.id]);
      // Des semaines retirées : leurs réglages par exercice partent.
      d.run('DELETE FROM cycle_week_overrides WHERE mesocycle_id = ? AND week_index > ?', [id, totalWeeks(after)]);
    }
  });
  return after.id;
}

/** Règle une semaine du bloc pour tous les lifts au % (la décharge règle la forme de décharge du bloc). */
export function setBlockWeek(d: Db, id: string, weekIndex: number, week: Partial<StrengthWeek>): void {
  const m = blocksOf(readProgram(d)).find((x) => x.id === id);
  if (!m) throw new Error('Bloc introuvable');
  const w = blockWeeks(m).find((x) => x.index === weekIndex);
  if (!w) throw new Error('Semaine invalide');
  const clean = cleanWeek(week, w.week);
  const next: Mesocycle = w.deload ? { ...m, deload: { ...m.deload, main: clean } } : { ...m, scheme: m.scheme.map((s, i) => (i === weekIndex - 1 ? clean : s)) };
  writeBlock(d, next);
}

/** Supprime un bloc : les séances faites restent (elles perdent seulement leur bloc), ses réglages partent. */
export function deleteBlock(d: Db, id: string): void {
  d.transaction(() => {
    d.run('DELETE FROM cycle_week_overrides WHERE mesocycle_id = ?', [id]);
    d.run('UPDATE workouts SET mesocycle_id = NULL WHERE mesocycle_id = ?', [id]);
    d.run('DELETE FROM mesocycles WHERE id = ?', [id]);
  });
}

// ---------------------------------------------------------------- valeurs de base

export interface BasePatch {
  increment?: number;
  barWeight?: number;
  plates?: number[];
  restFloors?: Partial<Record<'main' | 'compound' | 'isolation', number>>;
}

export function baseValues(d: Db): { increment: number; barWeight: number; plates: number[]; restFloors: Record<'main' | 'compound' | 'isolation', number> } {
  const a = appSettings(d);
  return { increment: a.increment, barWeight: a.barWeight, plates: [...a.plates].sort((x, y) => y - x), restFloors: { main: a.rest.floors.main, compound: a.rest.floors.compound, isolation: a.rest.floors.isolation } };
}

/** Change les valeurs de base dans les réglages `app` (les autres réglages de l'app d'avant restent tels quels). */
export function setBase(d: Db, patch: BasePatch): void {
  const s = readApp(d);
  const ok = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  if (patch.increment !== undefined) {
    if (!ok(patch.increment, 0.25, 20)) throw new Error('Incrément invalide');
    s.increment = patch.increment;
  }
  if (patch.barWeight !== undefined) {
    if (!ok(patch.barWeight, 0, 50)) throw new Error('Barre invalide');
    s.barWeight = patch.barWeight;
  }
  if (patch.plates !== undefined) {
    const plates = [...new Set(patch.plates.filter((p) => ok(p, 0.25, 50)))].sort((a, b) => b - a);
    if (!plates.length) throw new Error('Disques invalides');
    s.plates = plates;
  }
  if (patch.restFloors) {
    const rest = (s.rest && typeof s.rest === 'object' ? s.rest : {}) as Record<string, unknown>;
    const floors = { ...DEFAULT_REST.floors, ...((rest.floors as object) ?? {}) } as Record<string, number>;
    for (const [k, v] of Object.entries(patch.restFloors)) if (ok(v, 15, 900)) floors[k] = Math.round(v as number);
    s.rest = { ...rest, floors };
  }
  d.run("INSERT INTO settings (key, value) VALUES ('app', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [JSON.stringify(s)]);
}
