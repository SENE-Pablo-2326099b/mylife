import {
  BUILTIN_FORMATS,
  bestPerCycle,
  bodyTrend,
  detectStagnation,
  diffDays,
  e1rmSeries,
  recordEvents,
  sessionsOn,
  totalWeeks,
  weeklyConsistency,
  type SetRecord,
} from '@mylife/training';
import { bodyVolume } from './exercises';
import { historyView, readProgram } from './queries';
import type { Db } from './sql';

/**
 * Les progrès de MyPerf, côté Worker (maquettes V3-Progres et V3-Progres-libre, validées le 22/11). L'écran s'adapte :
 * avec des lifts au % du 1RM, leur référence et leur estimé (lest net), leur tendance, les plateaux ; sans, ce qui
 * monte exercice par exercice dans sa grandeur (charge × reps, reps d'un EMOM, temps tenu, tours). Les deux : le volume
 * par muscle, la régularité sur 14 semaines, le poids du corps. La fenêtre : 7 jours, 28 jours ou le bloc en cours.
 */

const kg = (v: number, weighted: boolean) => `${weighted && v > 0 ? '+' : ''}${v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}`;
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const addDaysIso = (iso: string, n: number) => {
  const dt = new Date(`${iso}T12:00:00`);
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};

export type ProgressWindow = 7 | 28 | 'cycle';

export interface ProgressView {
  profile: 'lifts' | 'free';
  subtitle: string;
  window: { days: number; from: string; cycle: string | null };
  stats: { sessions: number; planned: number; minutes: number; records: number };
  lifts: { exerciseId: string; name: string; reference: string | null; estimate: string | null; trend: number[]; rising: boolean | null }[];
  plateaus: { exerciseId: string; name: string; cycles: number }[];
  ups: { exerciseId: string; name: string; metric: string; now: string; before: string | null; better: boolean }[];
  muscles: { id: string; label: string; sets: number }[];
  consistency: { weeks: { start: string; sessions: number; level: 0 | 1 | 2 | 3 }[]; total: number; perWeek: number; current: number };
  bodyweight: { value: number; average: number; rate: number | null } | null;
}

interface Row {
  workout: string;
  date: string;
  meso: string | null;
  week: number | null;
  setType: string;
  weight: number | null;
  reps: number | null;
  duration: number | null;
  rounds: number | null;
  bodyweight: number;
}

function rowsOf(d: Db, exerciseId: string): Row[] {
  return d.all<Row>(
    `SELECT w.id AS workout, w.date AS date, w.mesocycle_id AS meso, w.week_index AS week, s.set_type AS setType, s.weight AS weight, s.reps AS reps,
       s.duration_s AS duration, s.rounds AS rounds, COALESCE(w.bodyweight, 0) AS bodyweight
     FROM sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id JOIN workouts w ON w.id = we.workout_id
     WHERE we.exercise_id = ? AND w.status = 'completed' AND s.completed = 1 AND s.set_type != 'warmup' ORDER BY w.date, w.started_at, s.position`,
    [exerciseId],
  );
}

/** Les séries d'un exercice au format du calcul (masse totale pour un lesté). */
const setRecords = (rows: readonly Row[], weighted: boolean): SetRecord[] =>
  rows.flatMap((r) => (r.weight !== null && r.reps !== null && r.reps > 0 ? [{ workoutId: r.workout, date: r.date, mesocycleId: r.meso, weekIndex: r.week, setType: r.setType as SetRecord['setType'], weight: r.weight, reps: r.reps, bodyweight: weighted ? r.bodyweight : null }] : []));

export function progressView(d: Db, date: string, window: ProgressWindow, hidden: readonly string[] = []): ProgressView {
  const program = readProgram(d);
  const h = historyView(d);
  const alive = new Set(d.all<{ id: string }>('SELECT id FROM templates WHERE archived = 0').map((r) => r.id));
  const sessions = program.sessions.filter((s) => alive.has(s.id));
  const blocks = program.structure.kind === 'periodized' ? [...program.structure.blocks].sort((a, b) => a.startDate.localeCompare(b.startDate)) : [];
  const current = blocks.find((m) => date >= m.startDate && diffDays(m.startDate, date) < totalWeeks(m) * 7) ?? null;
  const days = window === 'cycle' && current ? Math.max(7, diffDays(current.startDate, date) + 1) : window === 7 ? 7 : 28;
  const from = addDaysIso(date, -(days - 1));

  // Les chiffres de la fenêtre : séances faites et prévues, temps, records.
  const done = d.all<{ id: string; date: string; started_at: number; ended_at: number | null }>("SELECT id, date, started_at, ended_at FROM workouts WHERE status = 'completed' AND date BETWEEN ? AND ?", [from, date]);
  let planned = 0;
  for (let i = 0; i < days; i++) planned += sessionsOn(program.structure.pattern, addDaysIso(from, i)).filter((id) => alive.has(id)).length;
  const minutes = Math.round(done.reduce((n, w) => n + (w.ended_at ? Math.max(0, w.ended_at - w.started_at) : 0), 0) / 60_000);

  const slots = sessions.flatMap((s) => s.slots);
  const exerciseIds = [...new Set(slots.map((x) => x.exerciseId))];
  const formats = [...BUILTIN_FORMATS, ...program.formats];
  let records = 0;
  const lifts: ProgressView['lifts'] = [];
  const plateaus: ProgressView['plateaus'] = [];
  const ups: ProgressView['ups'] = [];
  for (const id of exerciseIds) {
    const e = program.exercises.find((x) => x.id === id);
    if (!e) continue;
    const weighted = e.loadType === 'bodyweight';
    const rows = rowsOf(d, id);
    const recs = setRecords(rows, weighted);
    records += recordEvents(recs).filter((r) => r.date >= from).length;
    const slot = slots.find((x) => x.exerciseId === id)!;
    if (slot.strategy.id === 'percent_reference') {
      // Le lift : sa référence et son estimé (lest net), la tendance du meilleur e1RM des 8 dernières séances.
      const typed = h.typedOneRm(id);
      const series = e1rmSeries(recs, program.reference.reliableMaxReps);
      // Le calcul rend déjà le lest net pour un lesté (poids du corps de chaque séance retiré).
      const net = (v: number) => Math.round(v * 10) / 10;
      const last = series[series.length - 1];
      const before = series.filter((p) => p.date < from).at(-1);
      lifts.push({
        exerciseId: id,
        name: e.name,
        reference: typed && typed.mode === 'manual' ? `${kg(typed.value, weighted)} kg` : null,
        estimate: last ? `${kg(net(last.e1rm), weighted)}` : null,
        trend: series.slice(-8).map((p) => net(p.e1rm)),
        rising: last && before ? last.e1rm > before.e1rm * 1.005 : null,
      });
      // Plateau : pas de gain au-delà de 0,5 % sur deux cycles (le calcul de l'ancienne app).
      const stagnation = detectStagnation(bestPerCycle(recs, blocks.map((b) => b.id)));
      if (stagnation.stagnant && !hidden.includes(`${id}:${stagnation.cycles}`)) plateaus.push({ exerciseId: id, name: e.name, cycles: stagnation.cycles });
    } else {
      // Ce qui monte, dans la grandeur de l'exercice : mieux dans la fenêtre qu'avant ?
      const scheme = formats.find((f) => f.id === slot.formatId)?.scheme ?? 'sets';
      const inWin = rows.filter((r) => r.date >= from);
      const earlier = rows.filter((r) => r.date < from);
      if (!inWin.length) continue;
      const perSession = (list: Row[], f: (x: Row[]) => number) => Math.max(0, ...[...new Set(list.map((r) => r.workout))].map((w) => f(list.filter((r) => r.workout === w))));
      let metric = 'meilleure série';
      let now = '';
      let before: string | null = null;
      let better = false;
      if (scheme === 'interval') {
        metric = 'reps totales';
        const sum = (x: Row[]) => x.reduce((n, r) => n + (r.reps ?? 0), 0);
        const a = perSession(inWin, sum);
        const b = perSession(earlier, sum);
        [now, before, better] = [String(a), b ? String(b) : null, a > b];
      } else if (scheme === 'hold' || scheme === 'for_time') {
        metric = scheme === 'hold' ? 'meilleur temps' : 'temps';
        const a = Math.max(0, ...inWin.map((r) => r.duration ?? 0));
        const b = Math.max(0, ...earlier.map((r) => r.duration ?? 0));
        [now, before, better] = [clock(a), b ? clock(b) : null, scheme === 'hold' ? a > b : b > 0 && a < b];
      } else if (scheme === 'amrap') {
        metric = 'tours';
        const a = Math.max(0, ...inWin.map((r) => r.rounds ?? 0));
        const b = Math.max(0, ...earlier.map((r) => r.rounds ?? 0));
        [now, before, better] = [`${a} tours`, b ? `${b} tours` : null, a > b];
      } else {
        // Comparé avec un même poids du corps des deux côtés (le plus récent) : une vieille séance sans poids noté
        // ne doit pas faire croire à un progrès.
        const bw = weighted ? (h.bodyweight(date) ?? 75) : 0;
        const score = (r: Row) => (r.weight! + bw) * (1 + r.reps! / 30);
        const best = (x: Row[]) => x.filter((r) => r.weight !== null && r.reps !== null).sort((p, q) => score(q) - score(p))[0];
        const a = best(inWin);
        const b = best(earlier);
        if (!a) continue;
        metric = 'charge × reps';
        [now, before, better] = [`${kg(a.weight!, weighted)} × ${a.reps}`, b ? `${kg(b.weight!, weighted)} × ${b.reps}` : null, !b || score(a) > score(b) * 1.005];
      }
      ups.push({ exerciseId: id, name: e.name, metric, now, before, better });
    }
  }
  ups.sort((a, b) => Number(b.better) - Number(a.better) || a.name.localeCompare(b.name, 'fr'));

  // Séries par muscle sur la fenêtre (le volume du corps, en séries faites).
  const volume = bodyVolume(d, date, days);
  const muscles = volume.regions
    .filter((r) => r.perWeek > 0)
    .sort((a, b) => b.perWeek - a.perWeek)
    .map((r) => ({ id: r.id, label: r.label, sets: Math.round((r.perWeek * days) / 7) }));

  // Régularité sur 14 semaines : une case par semaine, plus foncée quand l'objectif (la semaine type) est atteint.
  const goal = Math.max(1, program.structure.pattern.filter((p) => alive.has(p.templateId)).length || 3);
  const dates = d.all<{ date: string }>("SELECT date FROM workouts WHERE status = 'completed'").map((r) => r.date);
  const c = weeklyConsistency(dates, date, goal, 14);
  const total = c.weeks.reduce((n, w) => n + w.sessions, 0);

  // Le poids du corps : la dernière valeur, la moyenne sur 7 jours, la tendance par semaine.
  const entries = d.all<{ date: string; value: number }>("SELECT date, value FROM body_entries WHERE metric = 'bodyweight' ORDER BY date");
  const trend = bodyTrend(entries, null);
  const lastEntry = entries[entries.length - 1];

  const hasLifts = lifts.length > 0;
  return {
    profile: hasLifts ? 'lifts' : 'free',
    subtitle: current ? `${current.name} · semaine ${Math.floor(diffDays(current.startDate, date) / 7) + 1} sur ${totalWeeks(current)}` : program.structure.kind === 'periodized' ? 'Par blocs' : 'Routine',
    window: { days, from, cycle: current?.name ?? null },
    stats: { sessions: done.length, planned, minutes, records },
    lifts,
    plateaus,
    ups: ups.slice(0, 8),
    muscles,
    consistency: { weeks: c.weeks.map((w) => ({ start: w.start, sessions: w.sessions, level: w.sessions === 0 ? 0 : w.sessions < goal ? 1 : w.sessions === goal ? 2 : 3 })), total, perWeek: Math.round((total / 14) * 10) / 10, current: c.weeks.at(-1)?.sessions ?? 0 },
    bodyweight: lastEntry && trend ? { value: lastEntry.value, average: Math.round(trend.average * 10) / 10, rate: trend.ratePerWeek === null ? null : Math.round(trend.ratePerWeek * 100) / 100 } : null,
  };
}

