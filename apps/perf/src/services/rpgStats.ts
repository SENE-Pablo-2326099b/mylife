import { Platform } from 'react-native';

import { db, subscribeData } from '@/db/db';
import { exerciseActivity, setRecordsFor, workoutSummaries } from '@/db/repos/history';
import { listExercises } from '@/db/repos/exercises';
import { loadSettings } from '@/db/repos/settings';
import { recordEvents } from '@/domain/analytics';
import { addDays, today } from '@/domain/dates';
import { RELIABLE_MAX_REPS } from '@/domain/reference';
import { forceWeeks } from '@/domain/rpg';
import { readStats, sameStats, statsKey, writeCopilotCard, type AppStats } from '@/vendor/lumen';
import { listPlanned } from '@/db/repos/planning';
import { listMesocycles } from '@/db/repos/cycles';
import { phaseFor } from '@/domain/mesocycle';
import { statsOverview } from './statsService';

/**
 * Compteurs de MyPerf pour le Personnage MyLife : séances et records par semaine, objectif de séances.
 * Sur le web (même adresse que l'accueil), déposés dans le stockage commun : l'accueil les lit et les
 * synchronise. Dans l'app Android, gardés ici et envoyés par la synchro des réglages communs (prefs.ts).
 */
const NATIVE_KEY = 'stats_perf';

export function computePerfStats(day = today()): Pick<AppStats, 'weeks' | 'goal'> {
  const from = addDays(day, -7 * 104);
  const done = workoutSummaries(from, day).filter((w) => w.status === 'completed' && w.setCount > 0);
  const sessions = done.map((w) => w.date);
  // Durée réelle (séance oubliée ouverte : 4 h au plus).
  const minutes = done.map((w) => ({ date: w.date, minutes: w.endedAt ? Math.min(240, Math.max(0, (w.endedAt - w.startedAt) / 60_000)) : 0 }));
  const exercises = new Map(listExercises(true).map((e) => [e.id, e]));
  const records = exerciseActivity().flatMap((a) => {
    const main = exercises.get(a.exerciseId)?.progressionType === 'top_set_backoff';
    return recordEvents(setRecordsFor(a.exerciseId), main ? RELIABLE_MAX_REPS : undefined).map((e) => e.date);
  });
  return { weeks: forceWeeks(sessions, records, from, minutes), goal: loadSettings().weeklyGoal };
}

/** Ligne gardée par l'app Android (lue par la synchro des réglages communs). */
export function nativeStats(): AppStats | null {
  const raw = db().first<{ v: string }>('SELECT v FROM sync_state WHERE k = ?', [NATIVE_KEY])?.v;
  try {
    return raw ? (JSON.parse(raw) as AppStats) : null;
  } catch {
    return null;
  }
}

let onNativeChange: (() => void) | null = null;
export function onPerfStatsChange(fn: () => void): void {
  onNativeChange = fn;
}

export function publishPerfStats(): void {
  const next: AppStats = { v: 1, at: Date.now(), ...computePerfStats() };
  if (Platform.OS === 'web') {
    if (sameStats(readStats('perf'), next)) return;
    try {
      localStorage.setItem(statsKey('perf'), JSON.stringify(next));
      window.dispatchEvent(new Event('mylife:stats'));
    } catch {
      /* stockage indisponible */
    }
    return;
  }
  if (sameStats(nativeStats(), next)) return;
  db().run('INSERT INTO sync_state (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', [NATIVE_KEY, JSON.stringify(next)]);
  onNativeChange?.();
}

/**
 * Fiche de contexte pour Copilot (accueil MyLife, web seulement) : objectif de la semaine, séances prévues,
 * cycle en cours, dernières séances et records. Sur l'appareil, jamais synchronisée.
 */
export function publishCopilotCard(day = today()): void {
  if (Platform.OS !== 'web') return;
  const o = statsOverview(day);
  const meso = [...listMesocycles()].reverse().find((m) => {
    const p = phaseFor(m, day);
    return p.kind === 'work' || p.kind === 'deload' || p.kind === 'before';
  });
  const phase = meso ? phaseFor(meso, day) : null;
  const recent = workoutSummaries(addDays(day, -28), day)
    .filter((w) => w.status === 'completed' && w.setCount > 0)
    .slice(0, 8)
    .map((w) => ({ date: w.date, name: w.name, sets: w.setCount, minutes: w.endedAt ? Math.round((w.endedAt - w.startedAt) / 60_000) : null }));
  writeCopilotCard('perf', {
    day,
    weeklyGoal: o.weeklyGoal,
    sessionsThisWeek: o.consistency.weeks[o.consistency.weeks.length - 1]?.sessions ?? 0,
    goalStreakWeeks: o.consistency.streak,
    workoutsLast30Days: o.workouts30,
    planned: listPlanned(day, addDays(day, 21))
      .filter((p) => p.workoutId === null)
      .map((p) => ({ date: p.date, session: p.title })),
    cycle: meso && phase ? { name: meso.name, start: meso.startDate, workWeeks: meso.workWeeks, deloadWeeks: meso.deloadWeeks, phase: phase.kind, week: 'week' in phase ? phase.week : null } : null,
    recentWorkouts: recent,
    recentRecords: o.recentRecords.map((r) => ({ date: r.date, exercise: r.name, weight: r.weight, reps: r.reps, e1rm: Math.round(r.e1rm * 10) / 10 })),
    mainLifts: o.mainLifts.map((l) => ({ exercise: l.name, bestE1rm: Math.round(l.best * 10) / 10, lest: l.lest })),
    stagnant: o.stagnant.map((s) => s.name),
  });
}

let watching = false;
/**
 * Au lancement, puis quelques secondes après chaque écriture en base (une séance finie, un import).
 * `ready` : l'appareil est relié au compte connecté (pendant un changement de compte, les données sur
 * l'appareil sont encore celles de l'ancien : rien n'est publié).
 */
export function watchPerfStats(ready: () => boolean): void {
  if (watching) return;
  watching = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const soon = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (!ready()) return soon();
      try {
        publishPerfStats();
        publishCopilotCard();
      } catch {
        /* base en cours de remplacement : au prochain changement */
      }
    }, 3000);
  };
  subscribeData(soon);
  soon();
}
