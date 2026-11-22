import { addDays, diffDays, startOfWeek } from './dates';
import type { Muscle } from './types';
import { isIndirect, type VolumeSet } from './analytics';

/**
 * Body map regions: what you tap on the anatomy drawing, the drawing's part ids (slugs of
 * react-native-body-highlighter) and the app's muscles they stand for. The drawing has a single
 * upper-back part, so « Dos » covers the lats and the mid back.
 */
export type BodyView = 'front' | 'back';
export type RegionId =
  | 'chest'
  | 'shoulders'
  | 'rear_delts'
  | 'biceps'
  | 'triceps'
  | 'forearms'
  | 'abs'
  | 'traps'
  | 'back'
  | 'lower_back'
  | 'glutes'
  | 'quads'
  | 'hamstrings'
  | 'adductors'
  | 'calves';

export interface BodyRegion {
  id: RegionId;
  label: string;
  muscles: readonly Muscle[];
  /** Drawing parts per view. */
  slugs: Partial<Record<BodyView, readonly string[]>>;
}

export const BODY_REGIONS: readonly BodyRegion[] = [
  { id: 'chest', label: 'Pectoraux', muscles: ['chest'], slugs: { front: ['chest'] } },
  { id: 'shoulders', label: 'Épaules', muscles: ['shoulders'], slugs: { front: ['deltoids'] } },
  { id: 'rear_delts', label: 'Arrière d’épaule', muscles: ['rear_delts'], slugs: { back: ['deltoids'] } },
  { id: 'biceps', label: 'Biceps', muscles: ['biceps'], slugs: { front: ['biceps'] } },
  { id: 'triceps', label: 'Triceps', muscles: ['triceps'], slugs: { front: ['triceps'], back: ['triceps'] } },
  { id: 'forearms', label: 'Avant-bras', muscles: ['forearms'], slugs: { front: ['forearm'], back: ['forearm'] } },
  { id: 'abs', label: 'Abdos', muscles: ['abs'], slugs: { front: ['abs', 'obliques'] } },
  { id: 'traps', label: 'Trapèzes', muscles: ['traps'], slugs: { front: ['trapezius'], back: ['trapezius'] } },
  { id: 'back', label: 'Dos', muscles: ['lats', 'back'], slugs: { back: ['upper-back'] } },
  { id: 'lower_back', label: 'Lombaires', muscles: ['lower_back'], slugs: { back: ['lower-back'] } },
  { id: 'glutes', label: 'Fessiers', muscles: ['glutes'], slugs: { back: ['gluteal'] } },
  { id: 'quads', label: 'Quadriceps', muscles: ['quads'], slugs: { front: ['quadriceps'] } },
  { id: 'hamstrings', label: 'Ischios', muscles: ['hamstrings'], slugs: { back: ['hamstring'] } },
  { id: 'adductors', label: 'Adducteurs', muscles: ['adductors'], slugs: { front: ['adductors'], back: ['adductors'] } },
  { id: 'calves', label: 'Mollets', muscles: ['calves'], slugs: { front: ['calves', 'tibialis'], back: ['calves'] } },
];

export function regionAt(view: BodyView, slug: string | undefined): BodyRegion | null {
  if (slug === undefined) return null;
  return BODY_REGIONS.find((r) => r.slugs[view]?.includes(slug) === true) ?? null;
}

export function regionById(id: RegionId): BodyRegion {
  return BODY_REGIONS.find((r) => r.id === id) ?? (BODY_REGIONS[0] as BodyRegion);
}

export interface RegionLoad {
  region: RegionId;
  /** Hard sets per week, averaged over the window (primary = 1, secondary = ½; arms: isolation only). */
  perWeek: number;
  /** Hard sets per week for the last `weeks` calendar weeks, oldest first (current week last). */
  weekly: number[];
  /** Arms: compound sets that also work them, per week over the window and this week (not in the counts above). */
  indirectPerWeek: number;
  indirectThisWeek: number;
  /** Last day it got a hard set, null if never in the data. */
  lastDate: string | null;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Training load per body region: weekly-averaged hard sets over the last `windowDays`, the weekly
 * trend and the last day trained. A set counts for a region if one of its muscles belongs to it
 * (primary 1, secondary ½, never twice for the same region).
 */
export function regionLoads(sets: readonly VolumeSet[], today: string, windowDays = 28, weeks = 8): RegionLoad[] {
  const current = startOfWeek(today);
  const weekStarts = Array.from({ length: weeks }, (_, i) => addDays(current, 7 * (i - weeks + 1)));
  return BODY_REGIONS.map((region) => {
    let inWindow = 0;
    let indirectWindow = 0;
    let indirectThisWeek = 0;
    const weekly = weekStarts.map(() => 0);
    let lastDate: string | null = null;
    for (const s of sets) {
      if (s.setType === 'warmup' || s.date > today) continue;
      const primary = s.primaryMuscles.find((m) => region.muscles.includes(m));
      const secondary = primary === undefined ? s.secondaryMuscles.find((m) => region.muscles.includes(m)) : undefined;
      const muscle = primary ?? secondary;
      if (muscle === undefined) continue;
      const v = primary !== undefined ? 1 : 0.5;
      const age = diffDays(s.date, today);
      if (isIndirect(muscle, s.category)) {
        if (age < windowDays) indirectWindow += v;
        if (startOfWeek(s.date) === current) indirectThisWeek += v;
        continue;
      }
      if (age < windowDays) inWindow += v;
      const wi = weekStarts.indexOf(startOfWeek(s.date));
      if (wi >= 0) weekly[wi] = (weekly[wi] ?? 0) + v;
      if (lastDate === null || s.date > lastDate) lastDate = s.date;
    }
    return {
      region: region.id,
      perWeek: round1(inWindow / (windowDays / 7)),
      weekly: weekly.map(round1),
      indirectPerWeek: round1(indirectWindow / (windowDays / 7)),
      indirectThisWeek: round1(indirectThisWeek),
      lastDate,
    };
  });
}

/** Colour level on the map: 0 untrained, 1 light (< 5 sets/week), 2 moderate (< 10), 3 high (≥ 10). */
export function loadLevel(perWeek: number): 0 | 1 | 2 | 3 {
  if (perWeek <= 0) return 0;
  if (perWeek < 5) return 1;
  if (perWeek < 10) return 2;
  return 3;
}
