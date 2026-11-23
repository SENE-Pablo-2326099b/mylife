import { addDays, dayContext, estimate1RM, planSession, reviewSession, summarizeSession, type SummarySet } from '@mylife/training';
import { historyView, readProgram } from './queries';
import { summarize } from './session';
import type { Db } from './sql';

/**
 * Le bilan d'une séance (maquette V3-Bilan, validée le 22/11), côté Worker : séries faites sur prévues, tonnage et son
 * écart avec la dernière fois, records ; chaque exercice par rapport au plan (record, au-dessus, conforme, en dessous,
 * partiel) et ce qui monte la prochaine fois ; la forme ressentie et la note, gardées avec la séance.
 */

const kg = (v: number, weighted: boolean) => `${weighted && v > 0 ? '+' : ''}${v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}`;

export interface SessionReport {
  id: string;
  name: string;
  date: string;
  kicker: string;
  sets: { done: number; planned: number | null };
  tonnage: { kg: number; delta: string | null };
  records: { name: string; text: string }[];
  exercises: { exerciseId: string; name: string; summary: string; verdict: 'record' | 'au-dessus' | 'conforme' | 'en dessous' | 'partiel' | 'libre'; next: string | null }[];
  rating: number | null;
  notes: string;
  /** Le texte à partager (rien d'autre que la séance). */
  share: string;
}

export function sessionReport(d: Db, id: string): SessionReport | null {
  const w = d.first<{ id: string; name: string; date: string; template_id: string | null; started_at: number; ended_at: number | null; bodyweight: number | null; notes: string; rating: number | null; status: string }>(
    'SELECT id, name, date, template_id, started_at, ended_at, bodyweight, notes, rating, status FROM workouts WHERE id = ?',
    [id],
  );
  if (!w || w.status !== 'completed') return null;
  const program = readProgram(d);
  const h = historyView(d);
  const wes = d.all<{ id: string; exercise_id: string; template_exercise_id: string | null; position: number }>('SELECT id, exercise_id, template_exercise_id, position FROM workout_exercises WHERE workout_id = ? ORDER BY position', [id]);
  const rows = d.all<{ we: string; set_type: string; weight: number | null; reps: number | null; duration_s: number | null; rounds: number | null; speed: number | null }>(
    `SELECT s.workout_exercise_id AS we, s.set_type, s.weight, s.reps, s.duration_s, s.rounds, s.speed FROM sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id
     WHERE we.workout_id = ? AND s.completed = 1 ORDER BY we.position, s.position`,
    [id],
  );
  const exOf = (exerciseId: string) => program.exercises.find((e) => e.id === exerciseId);
  // Le plan de ce jour-là (même moteur que le démarrage), pour juger chaque exercice.
  const plan = w.template_id ? planSession(program, w.template_id, w.date, h) : null;
  const summarySets: SummarySet[] = [];
  for (const r of rows) {
    const we = wes.find((x) => x.id === r.we)!;
    const e = exOf(we.exercise_id);
    if (!e || r.weight === null || r.reps === null) continue;
    summarySets.push({ exerciseId: e.id, exerciseName: e.name, setType: r.set_type as SummarySet['setType'], weight: r.weight, reps: r.reps, bodyweight: e.loadType === 'bodyweight' ? (w.bodyweight ?? 0) : null, strength: e.progressionType === 'top_set_backoff' });
  }
  const bestBefore = new Map<string, number>();
  for (const e of new Set(summarySets.map((s) => s.exerciseId))) {
    const before = h.refSets(e).filter((s) => s.date < w.date || (s.date === w.date && s.workoutId !== id && s.order < w.started_at));
    if (before.length) bestBefore.set(e, Math.max(...before.map((s) => estimate1RM(s.load, s.reps))));
  }
  // Pour un lesté, l'historique est en masse totale : la comparaison se fait sur la même base.
  const totalSets = summarySets.map((s) => (s.bodyweight !== null ? { ...s, weight: s.weight + s.bodyweight, bodyweight: null } : s));
  const previous = w.template_id
    ? d.first<{ id: string }>("SELECT id FROM workouts WHERE template_id = ? AND status = 'completed' AND id != ? AND (date < ? OR (date = ? AND started_at < ?)) ORDER BY date DESC, started_at DESC LIMIT 1", [w.template_id, id, w.date, w.date, w.started_at])
    : null;
  const tonnageOf = (wid: string) =>
    d
      .all<{ weight: number | null; reps: number | null; load_type: string; bw: number | null }>(
        `SELECT s.weight, s.reps, e.load_type, w.bodyweight AS bw FROM sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id JOIN exercises e ON e.id = we.exercise_id JOIN workouts w ON w.id = we.workout_id
         WHERE we.workout_id = ? AND s.completed = 1 AND s.set_type != 'warmup'`,
        [wid],
      )
      .reduce((t, r) => t + (r.weight !== null && r.reps !== null ? (r.weight + (r.load_type === 'bodyweight' ? (r.bw ?? 0) : 0)) * r.reps : 0), 0);
  const summary = summarizeSession({ startedAt: w.started_at, endedAt: w.ended_at, sets: totalSets, bestBefore, previousTonnage: previous ? tonnageOf(previous.id) : null });
  const recordIds = new Set(summary.records.map((r) => r.exerciseId));
  const done = Object.fromEntries(
    wes.filter((we) => we.template_exercise_id).map((we) => [we.template_exercise_id!, rows.filter((r) => r.we === we.id).map((r) => ({ weight: r.weight, reps: r.reps, completed: true }))]),
  );
  const review = plan ? reviewSession(plan, done) : [];
  // Ce qui monte la prochaine fois : la même séance planifiée une semaine plus tard (la progression l'annonce).
  const nextPlan = w.template_id ? planSession(program, w.template_id, addDays(w.date, 7), h) : null;
  const exercises = wes.flatMap((we): SessionReport['exercises'] => {
    const e = exOf(we.exercise_id);
    const mine = rows.filter((r) => r.we === we.id);
    if (!e || !mine.length) return [];
    const weighted = e.loadType === 'bodyweight';
    const timed = mine.filter((r) => r.duration_s);
    const speed = mine.find((r) => r.speed !== null)?.speed;
    const text = timed.length
      ? timed.map((r) => `${Math.round(r.duration_s!)} s`).join(' · ')
      : mine.some((r) => r.rounds)
        ? `${Math.max(...mine.map((r) => r.rounds ?? 0))} tours`
        : (summarize(mine.filter((r) => r.weight !== null && r.reps !== null).map((r) => ({ weight: r.weight!, reps: r.reps! })), weighted) ?? `${mine.reduce((n, r) => n + (r.reps ?? 0), 0)} reps`);
    const r = review.find((x) => x.slotId === we.template_exercise_id);
    const verdict = recordIds.has(e.id) ? 'record' : !r ? 'libre' : r.verdict === 'above' ? 'au-dessus' : r.verdict === 'below' ? 'en dessous' : r.verdict === 'partial' ? 'partiel' : 'conforme';
    const hint = nextPlan?.items.find((i) => i.slot.id === we.template_exercise_id)?.prescription.hint;
    return [{ exerciseId: e.id, name: e.name, summary: `${text}${speed ? ` · vitesse ${speed}` : ''}`, verdict, next: hint && hint.kind === 'increase' ? `↑ ${kg(hint.to, weighted)} kg` : null }];
  });
  const planned = plan ? plan.items.reduce((n, i) => n + i.prescription.sets.filter((s) => s.setType !== 'warmup').length, 0) : null;
  const day = dayContext(program.structure, w.date);
  const kicker = [w.name, day.block && day.week ? `${day.block.name} S${day.week.index}` : '', summary.durationMin ? `${summary.durationMin} min` : ''].filter(Boolean).join(' · ');
  const delta = summary.previousTonnage ? (summary.tonnage - summary.previousTonnage) / summary.previousTonnage : null;
  const records = summary.records.map((x) => {
    const e = exOf(x.exerciseId);
    const weighted = e?.loadType === 'bodyweight';
    const shown = weighted ? x.weight - (w.bodyweight ?? 0) : x.weight;
    return { name: x.exerciseName, text: `${kg(shown, weighted)} × ${x.reps}` };
  });
  const share = [`${w.name} · ${new Date(`${w.date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}`, ...exercises.map((x) => `${x.name} : ${x.summary}`), records.length ? `Records : ${records.map((r) => `${r.name} ${r.text}`).join(', ')}` : ''].filter(Boolean).join('\n');
  return {
    id,
    name: w.name,
    date: w.date,
    kicker,
    sets: { done: summary.sets + rows.filter((r) => r.weight === null && r.set_type !== 'warmup').length, planned },
    tonnage: { kg: summary.tonnage, delta: delta === null ? null : `${delta >= 0 ? '+' : ''}${Math.round(delta * 100)} %` },
    records,
    exercises,
    rating: w.rating,
    notes: w.notes ?? '',
    share,
  };
}

/** La forme ressentie (1 à 5, ou rien) et la note de la séance. */
export function rateSession(d: Db, id: string, rating: number | null, notes: string): void {
  if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) throw new Error('Forme de 1 à 5');
  d.run('UPDATE workouts SET rating = ?, notes = ? WHERE id = ?', [rating, notes.trim().slice(0, 2000), id]);
}
