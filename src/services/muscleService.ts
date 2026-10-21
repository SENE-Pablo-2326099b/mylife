import { e1rmSeries } from '@/domain/analytics';
import { regionById, regionLoads, type RegionId, type RegionLoad } from '@/domain/bodyMap';
import { addDays } from '@/domain/dates';
import { RELIABLE_MAX_REPS } from '@/domain/reference';
import type { Exercise } from '@/domain/types';
import { listExercises } from '@/db/repos/exercises';
import { exerciseActivity, setRecordsFor, volumeSets } from '@/db/repos/history';
import { loadSettings } from '@/db/repos/settings';

/** Load of every body region (weekly sets averaged over `windowDays`, 8-week trend, last day). */
export function bodyMapData(today: string, windowDays: number): RegionLoad[] {
  const from = addDays(today, -Math.max(windowDays, 8 * 7));
  return regionLoads(volumeSets(from, today), today, windowDays, 8);
}

export interface RegionExercise {
  exercise: Exercise;
  /** Primary (the region is its target) or secondary. */
  role: 'primary' | 'secondary';
  sessions: number;
  lastDate: string | null;
  /** Latest e1RM (reliable sets only for main lifts) and the trend behind it. */
  e1rm: number | null;
  trend: number[];
}

export interface RegionDetail {
  region: RegionId;
  label: string;
  load: RegionLoad;
  /** Sum of the weekly targets of the region's muscles (Réglages), null when none. */
  target: number | null;
  exercises: RegionExercise[];
}

/** Everything about one region: load, target, and its exercises (trained ones first). */
export function regionDetail(id: RegionId, today: string, windowDays: number): RegionDetail {
  const region = regionById(id);
  const load = bodyMapData(today, windowDays).find((l) => l.region === id) ?? { region: id, perWeek: 0, weekly: [], indirectPerWeek: 0, indirectThisWeek: 0, lastDate: null };
  const targets = loadSettings().volumeTargets;
  const targetSum = region.muscles.reduce((s, m) => s + (targets[m] ?? 0), 0);
  const activity = new Map(exerciseActivity().map((a) => [a.exerciseId, a]));

  const exercises: RegionExercise[] = listExercises()
    .flatMap((e): RegionExercise[] => {
      const primary = e.primaryMuscles.some((m) => region.muscles.includes(m));
      const secondary = !primary && e.secondaryMuscles.some((m) => region.muscles.includes(m));
      if (!primary && !secondary) return [];
      const act = activity.get(e.id);
      let e1rm: number | null = null;
      let trend: number[] = [];
      if (act !== undefined) {
        const series = e1rmSeries(setRecordsFor(e.id), e.progressionType === 'top_set_backoff' ? RELIABLE_MAX_REPS : undefined);
        trend = series.slice(-8).map((p) => p.e1rm);
        e1rm = trend[trend.length - 1] ?? null;
      }
      return [{ exercise: e, role: primary ? 'primary' : 'secondary', sessions: act?.sessions ?? 0, lastDate: act?.lastDate ?? null, e1rm, trend }];
    })
    .sort((a, b) => {
      if (a.role !== b.role) return a.role === 'primary' ? -1 : 1;
      if ((a.lastDate === null) !== (b.lastDate === null)) return a.lastDate === null ? 1 : -1;
      if (a.lastDate !== null && b.lastDate !== null && a.lastDate !== b.lastDate) return a.lastDate < b.lastDate ? 1 : -1;
      return a.exercise.name.localeCompare(b.exercise.name, 'fr');
    });

  return { region: id, label: region.label, load, target: targetSum > 0 ? targetSum : null, exercises };
}
