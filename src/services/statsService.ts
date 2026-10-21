import {
  recordEvents,
  weeklyConsistency,
  type Consistency,
  type RecordEvent,
  bestPerCycle,
  detectStagnation,
  e1rmSeries,
  personalRecords,
  setE1rm,
  topSetHistory,
  weeklyVolume,
  type MuscleVolume,
  type CycleBest,
  type E1rmPoint,
  type PersonalRecords,
} from '@/domain/analytics';
import { addDays, startOfWeek } from '@/domain/dates';
import { RELIABLE_MAX_REPS, type Reference } from '@/domain/reference';
import { latestBodyweight } from '@/db/repos/body';
import type { Muscle, SetType } from '@/domain/types';
import { listMesocycles } from '@/db/repos/cycles';
import { listExercises } from '@/db/repos/exercises';
import { cycleBestsAll, exerciseActivity, setRecordsFor, volumeSets, workoutSummaries } from '@/db/repos/history';
import { loadSettings } from '@/db/repos/settings';
import { listTemplateExercises, listTemplates } from '@/db/repos/templates';

import { referenceFor } from './workoutService';

export interface SessionHistory {
  workoutId: string;
  date: string;
  sets: { setType: SetType; weight: number; reps: number; note: string }[];
  bestE1rm: number;
}

export interface ExerciseStats {
  series: E1rmPoint[];
  cycles: (CycleBest & { name: string })[];
  topSets: ReturnType<typeof topSetHistory>;
  prs: PersonalRecords;
  sessions: SessionHistory[];
  stagnation: { stagnant: boolean; cycles: number };
  /** Main lifts: e1RM from sets above this rep count is flagged unreliable. */
  reliableMaxReps: number | null;
  /** Main lifts: reference 1RM behind the loads (total mass for weighted work). */
  reference: Reference | null;
  /** Latest bodyweight, to show a weighted lift's reference as lest. */
  bodyweight: number | null;
}

export function exerciseStats(exerciseId: string, today: string): ExerciseStats {
  const records = setRecordsFor(exerciseId);
  const exercise = listExercises(true).find((e) => e.id === exerciseId);
  const main = exercise?.progressionType === 'top_set_backoff';
  const reliableMaxReps = main ? RELIABLE_MAX_REPS : undefined;
  const mesos = listMesocycles();
  const names = new Map(mesos.map((m) => [m.id, m.name]));
  const cycles = bestPerCycle(
    records,
    mesos.map((m) => m.id),
  ).map((c) => ({ ...c, name: names.get(c.mesocycleId) ?? '' }));
  const series = e1rmSeries(records, reliableMaxReps);

  const sessionsMap = new Map<string, SessionHistory>();
  for (const r of records) {
    let s = sessionsMap.get(r.workoutId);
    if (s === undefined) {
      s = { workoutId: r.workoutId, date: r.date, sets: [], bestE1rm: 0 };
      sessionsMap.set(r.workoutId, s);
    }
    s.sets.push({ setType: r.setType, weight: r.weight, reps: r.reps, note: r.note });
    if (r.setType !== 'warmup') s.bestE1rm = Math.max(s.bestE1rm, setE1rm(r));
  }

  return {
    series,
    cycles,
    topSets: topSetHistory(records),
    prs: personalRecords(records, 12, reliableMaxReps),
    sessions: [...sessionsMap.values()].reverse(),
    stagnation: detectStagnation(cycles),
    reliableMaxReps: reliableMaxReps ?? null,
    reference: main ? referenceFor(exerciseId, today) : null,
    bodyweight: latestBodyweight(today),
  };
}

export interface MainLift {
  exerciseId: string;
  name: string;
  lest: boolean;
  /** Reference 1RM behind the loads, as logged (lest for weighted lifts); null without history. */
  reference: number | null;
  provisional: boolean;
  best: number;
  /** The record comes from a set of 6 reps or fewer (false: only higher-rep estimates exist). */
  bestReliable: boolean;
  /** Best e1RM of the current/last cycle vs the one before (null with a single cycle). */
  delta: number | null;
  lastTop: { weight: number; reps: number; date: string } | null;
  values: number[];
}

export interface RecentRecord extends RecordEvent {
  exerciseId: string;
  name: string;
  lest: boolean;
}

export interface StatsOverview {
  consistency: Consistency;
  weeklyGoal: number;
  recentRecords: RecentRecord[];
  mainLifts: MainLift[];
  stagnant: { exerciseId: string; name: string; cycles: number }[];
  workouts30: number;
  sets7: number;
  progress: { exerciseId: string; name: string; last: number; values: number[]; sessions: number }[];
}

export function statsOverview(today: string): StatsOverview {
  const exercises = new Map(listExercises(true).map((e) => [e.id, e]));
  const mesoOrder = listMesocycles().map((m) => m.id);

  const byExercise = new Map<string, Map<string, number>>();
  for (const r of cycleBestsAll()) {
    const m = byExercise.get(r.exerciseId) ?? new Map<string, number>();
    m.set(r.mesocycleId, r.best);
    byExercise.set(r.exerciseId, m);
  }
  const stagnant: StatsOverview['stagnant'] = [];
  byExercise.forEach((bests, exerciseId) => {
    const ordered = mesoOrder.flatMap((id) => {
      const e1rm = bests.get(id);
      return e1rm === undefined ? [] : [{ e1rm }];
    });
    const s = detectStagnation(ordered);
    if (s.stagnant) stagnant.push({ exerciseId, name: exercises.get(exerciseId)?.name ?? '?', cycles: s.cycles });
  });

  const summaries = workoutSummaries(addDays(today, -29), today).filter((w) => w.status === 'completed');
  const sets7 = summaries.filter((w) => w.date >= addDays(today, -6)).reduce((n, w) => n + w.setCount, 0);

  // Progress list: the 12 most recently trained exercises, main lifts first.
  const activity = exerciseActivity().slice(0, 12);
  const progress = activity
    .map((a) => {
      const series = e1rmSeries(setRecordsFor(a.exerciseId)).slice(-12);
      const last = series[series.length - 1]?.e1rm ?? 0;
      return { exerciseId: a.exerciseId, name: exercises.get(a.exerciseId)?.name ?? '?', last, values: series.map((p) => p.e1rm), sessions: a.sessions };
    })
    .sort((a, b) => {
      const pa = exercises.get(a.exerciseId)?.progressionType === 'top_set_backoff' ? 0 : 1;
      const pb = exercises.get(b.exerciseId)?.progressionType === 'top_set_backoff' ? 0 : 1;
      return pa - pb;
    });

  // Main lifts: exercises done as top set + backoff in the session templates.
  const mainIds = new Set<string>();
  for (const tpl of listTemplates()) {
    for (const te of listTemplateExercises(tpl.id)) {
      const ex = exercises.get(te.exerciseId);
      if (ex !== undefined && !ex.archived && (te.progressionType ?? ex.progressionType) === 'top_set_backoff') mainIds.add(ex.id);
    }
  }
  const mainLifts: MainLift[] = [...mainIds].map((id) => {
    const st = exerciseStats(id, today);
    const ex = exercises.get(id);
    const last = st.cycles[st.cycles.length - 1];
    const prev = st.cycles[st.cycles.length - 2];
    const top = st.topSets[st.topSets.length - 1];
    return {
      exerciseId: id,
      name: ex?.name ?? '?',
      lest: ex?.loadType === 'bodyweight',
      reference: st.reference === null ? null : st.reference.value - (ex?.loadType === 'bodyweight' ? (st.bodyweight ?? 0) : 0),
      provisional: st.reference?.status === 'provisional',
      best: st.prs.bestE1rm?.e1rm ?? 0,
      bestReliable: st.prs.bestE1rm?.reliable ?? true,
      delta: last !== undefined && prev !== undefined ? last.e1rm - prev.e1rm : null,
      lastTop: top === undefined ? null : { weight: top.weight, reps: top.reps, date: top.date },
      values: st.series.slice(-16).map((p) => p.e1rm),
    };
  });

  // Consistency over the last 12 weeks (streak may reach further back).
  const settings = loadSettings();
  const dates = workoutSummaries(addDays(today, -7 * 104), today)
    .filter((w) => w.status === 'completed' && w.setCount > 0)
    .map((w) => w.date);
  const consistency = weeklyConsistency(dates, today, settings.weeklyGoal);

  // Latest records, every exercise (main lifts: sets ≤ 6 reps only).
  const recentRecords: RecentRecord[] = exerciseActivity()
    .flatMap((a) => {
      const ex = exercises.get(a.exerciseId);
      if (ex === undefined) return [];
      const main = ex.progressionType === 'top_set_backoff';
      return recordEvents(setRecordsFor(a.exerciseId), main ? RELIABLE_MAX_REPS : undefined).map((e) => ({
        ...e,
        exerciseId: ex.id,
        name: ex.name,
        lest: ex.loadType === 'bodyweight',
      }));
    })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.gain - a.gain))
    .slice(0, 5);

  return {
    consistency,
    weeklyGoal: settings.weeklyGoal,
    recentRecords,
    mainLifts,
    stagnant,
    workouts30: summaries.length,
    sets7,
    progress: progress.filter((p) => !mainIds.has(p.exerciseId)),
  };
}

export interface WeekMuscleVolume {
  muscle: Muscle;
  /** Direct hard sets (what the targets compare to). */
  sets: number;
  /** Arms: compound sets that also work them, shown apart. */
  indirect: number;
}

/** Hard sets per muscle for the week starting at `weekStart` (Monday), sorted desc. */
export function weekVolume(weekStart: string): WeekMuscleVolume[] {
  const start = startOfWeek(weekStart);
  const map = weeklyVolume(volumeSets(start, addDays(start, 6))).get(start) ?? new Map<Muscle, MuscleVolume>();
  return [...map.entries()]
    .map(([muscle, v]) => ({ muscle, sets: v.direct, indirect: v.indirect }))
    .sort((a, b) => b.sets - a.sets || b.indirect - a.indirect);
}
