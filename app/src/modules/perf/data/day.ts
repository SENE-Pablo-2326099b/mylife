import {
  addDays,
  capabilities,
  dayContext,
  estimate1RM,
  planSession,
  restSeconds,
  sessionsOn,
  weekday,
  DEFAULT_REST,
  type Program,
} from '@mylife/training';
import { historyView, readProgram } from './queries';
import { newId, type Db } from './sql';

/**
 * La page « Jour » de MyPerf, côté Worker : la séance du jour telle qu'elle sera prescrite (charges calculées, même
 * moteur que le démarrage), la semaine, la dernière séance et ses records ; et les petites saisies du « + ».
 */

export interface PlannedLine {
  name: string;
  /** « 1×4 @ 82,5 % · 4×5 @ 72,5 % » ou « 3×8-12 », avec la charge (lest net pour un lesté). */
  detail: string;
  load: string | null;
}

export interface PlannedSession {
  id: string;
  name: string;
  minutes: number;
  lines: PlannedLine[];
  /** Décalée depuis un autre jour (« Décaler »). */
  movedFrom: string | null;
}

export interface WeekDay {
  date: string;
  done: string[];
  planned: { id: string; name: string }[];
}

export interface LastSession {
  id: string;
  name: string;
  date: string;
  sets: number;
  tonnage: number;
  minutes: number | null;
  records: { name: string; text: string }[];
}

export interface DayView {
  active: { id: string; name: string; done: number; total: number } | null;
  /** Bloc en cours (périodisé) ou semaine du cycle (cycle libre) ; rien pour une routine. */
  block: { name: string | null; week: number; of: number; deload: boolean; index: number | null; total: number | null } | null;
  capabilities: string[];
  today: PlannedSession[];
  /** Rien de prévu aujourd'hui : la prochaine séance de la semaine type. */
  next: { date: string; session: PlannedSession } | null;
  others: { id: string; name: string }[];
  week: WeekDay[];
  last: LastSession | null;
  hasProgram: boolean;
}

const kg = (v: number, weighted: boolean) => `${weighted && v > 0 ? '+' : ''}${v.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} kg`;

export function preview(d: Db, program: Program, templateId: string, date: string): PlannedSession | null {
  const plan = planSession(program, templateId, date, historyView(d));
  if (!plan) return null;
  let seconds = 0;
  const lines = plan.items.map((item): PlannedLine => {
    const weighted = item.exercise.loadType === 'bodyweight';
    const sets = item.prescription.sets;
    for (const s of sets) seconds += 40 + restSeconds(DEFAULT_REST, item.exercise.category, item.slot.intention ?? (item.slot.strategy.id === 'percent_reference' ? 'strength' : 'hypertrophy'), s.setType);
    const first = sets.find((s) => s.setType === 'top_set') ?? sets[0];
    const label = item.prescription.label.replace(/^Deload · /, 'Décharge · ').replace(/ @/g, ' @ ').replace(/(\d)%/g, '$1 %');
    return { name: item.exercise.name, detail: label, load: first?.targetWeight != null ? kg(first.targetWeight, weighted) : null };
  });
  return { id: plan.session.id, name: plan.session.name, minutes: Math.max(5, Math.round(seconds / 60 / 5) * 5), lines, movedFrom: null };
}

interface Move {
  template_id: string;
  from_date: string;
  to_date: string;
}

/** Les séances d'un jour : la semaine type, moins celles décalées ailleurs, plus celles décalées vers ce jour. */
function plannedOn(program: Program, live: Set<string>, moves: readonly Move[], date: string): { id: string; movedFrom: string | null }[] {
  const away = new Set(moves.filter((m) => m.from_date === date).map((m) => m.template_id));
  const base = sessionsOn(program.structure.pattern, date)
    .filter((id) => live.has(id) && !away.has(id))
    .map((id) => ({ id, movedFrom: null as string | null }));
  const moved = moves.filter((m) => m.to_date === date && live.has(m.template_id) && !base.some((b) => b.id === m.template_id));
  return [...base, ...moved.map((m) => ({ id: m.template_id, movedFrom: m.from_date }))];
}

const readMoves = (d: Db, from: string, to: string) =>
  d.all<Move>('SELECT template_id, from_date, to_date FROM session_moves WHERE (from_date BETWEEN ? AND ?) OR (to_date BETWEEN ? AND ?) ORDER BY created_at', [from, to, from, to]);

/**
 * « Décaler » : la séance prévue tel jour se fait tel autre jour, cette fois-là (la semaine type ne change pas).
 * Re-décaler une séance déjà décalée remplace le décalage ; la remettre à son jour d'origine l'annule.
 */
export function moveSession(d: Db, templateId: string, from: string, to: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Error('Date invalide');
  if (!d.first('SELECT 1 FROM templates WHERE id = ? AND archived = 0', [templateId])) throw new Error('Séance introuvable');
  const prior = d.first<{ id: string; from_date: string }>('SELECT id, from_date FROM session_moves WHERE template_id = ? AND to_date = ?', [templateId, from]);
  const origin = prior?.from_date ?? from;
  d.transaction(() => {
    if (prior) d.run('DELETE FROM session_moves WHERE id = ?', [prior.id]);
    if (origin !== to) d.run('INSERT INTO session_moves (id, template_id, from_date, to_date, created_at) VALUES (?, ?, ?, ?, ?)', [newId(), templateId, origin, to, Date.now()]);
  });
}

export function dayView(d: Db, date: string): DayView {
  const program = readProgram(d);
  const day = dayContext(program.structure, date);
  const live = new Set(d.all<{ id: string }>('SELECT id FROM templates WHERE archived = 0').map((r) => r.id));
  const sessions = program.sessions.filter((s) => live.has(s.id));
  const monday = addDays(date, -weekday(date));
  const moves = readMoves(d, addDays(monday, -7), addDays(date, 14));
  const todayPlan = plannedOn(program, live, moves, date);
  const todayIds = todayPlan.map((p) => p.id);
  const today = todayPlan.flatMap((p) => {
    const s = preview(d, program, p.id, date);
    return s ? [{ ...s, movedFrom: p.movedFrom }] : [];
  });
  let next: DayView['next'] = null;
  if (!today.length) {
    for (let i = 1; i <= 7 && !next; i++) {
      const on = addDays(date, i);
      const p = plannedOn(program, live, moves, on)[0];
      const s = p ? preview(d, program, p.id, on) : null;
      if (s) next = { date: on, session: { ...s, movedFrom: p!.movedFrom } };
    }
  }
  const activeRow = d.first<{ id: string; name: string }>("SELECT id, name FROM workouts WHERE status = 'active' ORDER BY started_at DESC LIMIT 1");
  const counts = activeRow
    ? d.first<{ done: number; total: number }>(
        'SELECT SUM(s.completed) AS done, COUNT(*) AS total FROM sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id WHERE we.workout_id = ?',
        [activeRow.id],
      )
    : null;
  // La semaine du lundi au dimanche : faites, prévues (décalages compris).
  const week = Array.from({ length: 7 }, (_, i): WeekDay => {
    const on = addDays(monday, i);
    return {
      date: on,
      done: d.all<{ name: string }>("SELECT name FROM workouts WHERE date = ? AND status = 'completed' ORDER BY started_at", [on]).map((r) => r.name),
      planned: plannedOn(program, live, moves, on).map((p) => ({ id: p.id, name: sessions.find((s) => s.id === p.id)?.name ?? '' })),
    };
  });
  return {
    active: activeRow ? { id: activeRow.id, name: activeRow.name, done: Number(counts?.done ?? 0), total: Number(counts?.total ?? 0) } : null,
    block: day.week
      ? { name: day.block?.name ?? null, week: day.week.index, of: day.week.of, deload: day.week.deload, index: day.block?.index ?? null, total: day.block?.total ?? null }
      : null,
    capabilities: [...capabilities(program)],
    today,
    next,
    others: sessions.filter((s) => !todayIds.includes(s.id)).map((s) => ({ id: s.id, name: s.name })),
    week,
    last: lastSession(d, program),
    hasProgram: sessions.length > 0,
  };
}

/** La dernière séance faite : séries, tonnage (masse totale pour un lesté), durée, et ses records (e1RM battus). */
function lastSession(d: Db, program: Program): LastSession | null {
  const w = d.first<{ id: string; name: string; date: string; started_at: number; ended_at: number | null; bodyweight: number | null }>(
    "SELECT id, name, date, started_at, ended_at, bodyweight FROM workouts WHERE status = 'completed' ORDER BY date DESC, started_at DESC LIMIT 1",
  );
  if (!w) return null;
  const rows = d.all<{ exercise_id: string; progression_type: string; set_type: string; weight: number | null; reps: number | null }>(
    `SELECT we.exercise_id, we.progression_type, s.set_type, s.weight, s.reps FROM sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id
     WHERE we.workout_id = ? AND s.completed = 1 AND s.set_type != 'warmup' AND s.weight IS NOT NULL AND s.reps > 0`,
    [w.id],
  );
  const h = historyView(d);
  let tonnage = 0;
  const best = new Map<string, { e1rm: number; weight: number; reps: number }>();
  for (const r of rows) {
    const ex = program.exercises.find((e) => e.id === r.exercise_id);
    const bw = ex?.loadType === 'bodyweight' ? (w.bodyweight ?? 0) : 0;
    tonnage += (r.weight! + bw) * r.reps!;
    // Lifts principaux : seules les séries de 6 reps au plus comptent pour un record.
    if (r.progression_type === 'top_set_backoff' && r.reps! > 6) continue;
    // Masse totale (poids du corps + lest pour un lesté), comme l'historique de référence.
    const e1rm = estimate1RM(r.weight! + bw, r.reps!);
    if (e1rm > (best.get(r.exercise_id)?.e1rm ?? 0)) best.set(r.exercise_id, { e1rm, weight: r.weight!, reps: r.reps! });
  }
  // Comparé en masse totale (le bon calcul), affiché comme saisi : lest net pour un lesté (« +40 × 4 »).
  const records = [...best.entries()].flatMap(([id, { e1rm, weight, reps }]) => {
    const before = h.refSets(id).filter((s) => s.date < w.date);
    const prev = before.length ? Math.max(...before.map((s) => estimate1RM(s.load, s.reps))) : null;
    if (prev === null || e1rm <= prev + 1e-6) return [];
    const ex = program.exercises.find((e) => e.id === id);
    const weighted = ex?.loadType === 'bodyweight';
    const w8 = `${weighted && weight > 0 ? '+' : ''}${weight.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}`;
    return [{ name: ex?.name ?? id, text: `${w8} × ${reps}` }];
  });
  return {
    id: w.id,
    name: w.name,
    date: w.date,
    sets: rows.length,
    tonnage: Math.round(tonnage),
    minutes: w.ended_at ? Math.max(1, Math.round((w.ended_at - w.started_at) / 60_000)) : null,
    records,
  };
}

/** Poids du jour (le « + »). */
export function addBodyweight(d: Db, date: string, value: number): void {
  if (!Number.isFinite(value) || value < 20 || value > 400) throw new Error('Poids invalide');
  d.run("INSERT INTO body_entries (id, date, metric, value, created_at) VALUES (?, ?, 'bodyweight', ?, ?)", [newId(), date, Math.round(value * 10) / 10, Date.now()]);
}

export interface NewExercise {
  name: string;
  loadType: 'external' | 'bodyweight';
  category: 'main' | 'compound' | 'isolation';
  equipment: string;
  primary: string[];
  secondary?: string[];
  /** Variante de cet exercice (son propre 1RM, sa propre progression). */
  variantOf?: string | null;
}

/** Un exercice à soi : au % du 1RM s'il est principal, sinon double progression ; tout se règle ensuite. */
export function createExercise(d: Db, e: NewExercise): string {
  const name = e.name.trim();
  if (!name || name.length > 80) throw new Error('Nom invalide');
  if (d.first('SELECT 1 FROM exercises WHERE name = ? COLLATE NOCASE AND archived = 0', [name])) throw new Error('Cet exercice existe déjà');
  const id = `ex_${newId()}`;
  d.run(
    `INSERT INTO exercises (id, name, primary_muscles, secondary_muscles, equipment, unilateral, load_type, category, progression_type, backoff_percent, rep_range_min, rep_range_max, weight_increment, is_custom, archived, notes, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, 0.8, ?, ?, NULL, 1, 0, '', ?)`,
    [
      id,
      name,
      JSON.stringify(e.primary.slice(0, 4)),
      JSON.stringify((e.secondary ?? []).filter((m) => !e.primary.includes(m)).slice(0, 6)),
      e.equipment,
      e.loadType,
      e.category,
      // Un mouvement principal suit les blocs (au % du 1RM) ; les autres, la double progression.
      e.category === 'main' ? 'top_set_backoff' : 'double_progression',
      e.category === 'main' ? 3 : 8,
      e.category === 'main' ? 6 : 12,
      Date.now(),
    ],
  );
  if (e.variantOf && d.first('SELECT 1 FROM exercises WHERE id = ?', [e.variantOf])) d.run('UPDATE exercises SET variant_of = ? WHERE id = ?', [e.variantOf, id]);
  return id;
}
