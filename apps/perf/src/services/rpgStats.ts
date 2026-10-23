import { Platform } from 'react-native';

import { db, subscribeData } from '@/db/db';
import { exerciseActivity, setRecordsFor, workoutSummaries } from '@/db/repos/history';
import { listExercises } from '@/db/repos/exercises';
import { loadSettings } from '@/db/repos/settings';
import { recordEvents } from '@/domain/analytics';
import { addDays, today } from '@/domain/dates';
import { RELIABLE_MAX_REPS } from '@/domain/reference';
import { forceWeeks } from '@/domain/rpg';
import { readStats, sameStats, statsKey, type AppStats } from '@/vendor/lumen';

/**
 * Compteurs de MyPerf pour le Personnage MyLife : séances et records par semaine, objectif de séances.
 * Sur le web (même adresse que l'accueil), déposés dans le stockage commun : l'accueil les lit et les
 * synchronise. Dans l'app Android, gardés ici et envoyés par la synchro des réglages communs (prefs.ts).
 */
const NATIVE_KEY = 'stats_perf';

export function computePerfStats(day = today()): Pick<AppStats, 'weeks' | 'goal'> {
  const from = addDays(day, -7 * 104);
  const sessions = workoutSummaries(from, day)
    .filter((w) => w.status === 'completed' && w.setCount > 0)
    .map((w) => w.date);
  const exercises = new Map(listExercises(true).map((e) => [e.id, e]));
  const records = exerciseActivity().flatMap((a) => {
    const main = exercises.get(a.exerciseId)?.progressionType === 'top_set_backoff';
    return recordEvents(setRecordsFor(a.exerciseId), main ? RELIABLE_MAX_REPS : undefined).map((e) => e.date);
  });
  return { weeks: forceWeeks(sessions, records, from), goal: loadSettings().weeklyGoal };
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
      } catch {
        /* base en cours de remplacement : au prochain changement */
      }
    }, 3000);
  };
  subscribeData(soon);
  soon();
}
