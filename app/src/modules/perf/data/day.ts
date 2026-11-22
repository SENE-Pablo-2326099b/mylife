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
import { summarize } from './session';
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
}

export interface WeekDay {
  date: string;
  done: string[];
  planned: string[];
}

export interface LastSession {
  name: string;
  date: string;
  sets: number;
  tonnage: number;
  minutes: number | null;
  records: { name: string; text: string }[];
}

export interface DayView {
  active: { id: string; name: string; done: number; total: number } | null;
  block: { name: string; week: number; of: number; deload: boolean } | null;
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

function preview(d: Db, program: Program, templateId: string, date: string): PlannedSession | null {
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
  return { id: plan.session.id, name: plan.session.name, minutes: Math.max(5, Math.round(seconds / 60 / 5) * 5), lines };
}

export function dayView(d: Db, date: string): DayView {
  const program = readProgram(d);
  const day = dayContext(program.structure, date);
  const live = new Set(d.all<{ id: string }>('SELECT id FROM templates WHERE archived = 0').map((r) => r.id));
  const sessions = program.sessions.filter((s) => live.has(s.id));
  const todayIds = sessionsOn(program.structure.pattern, date).filter((id) => live.has(id));
  const today = todayIds.flatMap((id) => preview(d, program, id, date) ?? []);
  let next: DayView['next'] = null;
  if (!today.length) {
    for (let i = 1; i <= 7 && !next; i++) {
      const on = addDays(date, i);
      const id = sessionsOn(program.structure.pattern, on).find((x) => live.has(x));
      const p = id ? preview(d, program, id, on) : null;
      if (p) next = { date: on, session: p };
    }
  }
  const activeRow = d.first<{ id: string; name: string }>("SELECT id, name FROM workouts WHERE status = 'active' ORDER BY started_at DESC LIMIT 1");
  const counts = activeRow
    ? d.first<{ done: number; total: number }>(
        'SELECT SUM(s.completed) AS done, COUNT(*) AS total FROM sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id WHERE we.workout_id = ?',
        [activeRow.id],
      )
    : null;
  // La semaine du lundi au dimanche : faites, prévues.
  const monday = addDays(date, -weekday(date));
  const week = Array.from({ length: 7 }, (_, i): WeekDay => {
    const on = addDays(monday, i);
    return {
      date: on,
      done: d.all<{ name: string }>("SELECT name FROM workouts WHERE date = ? AND status = 'completed' ORDER BY started_at", [on]).map((r) => r.name),
      planned: sessionsOn(program.structure.pattern, on)
        .filter((id) => live.has(id))
        .map((id) => sessions.find((s) => s.id === id)?.name ?? ''),
    };
  });
  return {
    active: activeRow ? { id: activeRow.id, name: activeRow.name, done: Number(counts?.done ?? 0), total: Number(counts?.total ?? 0) } : null,
    block: day.block && day.week ? { name: day.block.name, week: day.week.index, of: day.week.of, deload: day.week.deload } : null,
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
  const best = new Map<string, number>();
  for (const r of rows) {
    const ex = program.exercises.find((e) => e.id === r.exercise_id);
    const bw = ex?.loadType === 'bodyweight' ? (w.bodyweight ?? 0) : 0;
    tonnage += (r.weight! + bw) * r.reps!;
    // Lifts principaux : seules les séries de 6 reps au plus comptent pour un record.
    if (r.progression_type === 'top_set_backoff' && r.reps! > 6) continue;
    // Masse totale (poids du corps + lest pour un lesté), comme l'historique de référence.
    const e1rm = estimate1RM(r.weight! + bw, r.reps!);
    best.set(r.exercise_id, Math.max(best.get(r.exercise_id) ?? 0, e1rm));
  }
  const records = [...best.entries()].flatMap(([id, e1rm]) => {
    const before = h.refSets(id).filter((s) => s.date < w.date);
    const prev = before.length ? Math.max(...before.map((s) => estimate1RM(s.load, s.reps))) : null;
    if (prev === null || e1rm <= prev + 1e-6) return [];
    const ex = program.exercises.find((e) => e.id === id);
    const set = rows.filter((r) => r.exercise_id === id).sort((a, b) => b.weight! - a.weight!)[0]!;
    return [{ name: ex?.name ?? id, text: summarize([{ weight: set.weight!, reps: set.reps! }], ex?.loadType === 'bodyweight') ?? '' }];
  });
  return {
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
}

/** Un exercice à soi (le « + ») : progression en double progression par défaut, tout se règle ensuite. */
export function createExercise(d: Db, e: NewExercise): string {
  const name = e.name.trim();
  if (!name || name.length > 80) throw new Error('Nom invalide');
  if (d.first('SELECT 1 FROM exercises WHERE name = ? COLLATE NOCASE AND archived = 0', [name])) throw new Error('Cet exercice existe déjà');
  const id = `ex_${newId()}`;
  d.run(
    `INSERT INTO exercises (id, name, primary_muscles, secondary_muscles, equipment, unilateral, load_type, category, progression_type, backoff_percent, rep_range_min, rep_range_max, weight_increment, is_custom, archived, notes, created_at)
     VALUES (?, ?, ?, '[]', ?, 0, ?, ?, 'double_progression', 0.8, ?, ?, NULL, 1, 0, '', ?)`,
    [id, name, JSON.stringify(e.primary.slice(0, 4)), e.equipment, e.loadType, e.category, e.category === 'main' ? 3 : 8, e.category === 'main' ? 6 : 12, Date.now()],
  );
  return id;
}
