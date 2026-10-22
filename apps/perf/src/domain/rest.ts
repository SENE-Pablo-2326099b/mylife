import type { ExerciseCategory, Intention, SetType } from './types';

export interface RestSettings {
  /** Floors in seconds per exercise category. */
  floors: Record<ExerciseCategory, number>;
  /** Default rest per template intention. */
  byIntention: Record<Intention, number>;
  warmup: number;
}

export const DEFAULT_REST: RestSettings = {
  floors: { main: 300, compound: 180, isolation: 120 },
  byIntention: { power: 300, strength: 240, hypertrophy: 120 },
  warmup: 60,
};

/**
 * Rest after a set: the intention's default, never below the category floor.
 * Warmups get a short rest; drop sets chain without rest (0 → no timer).
 */
export function restSeconds(
  settings: RestSettings,
  category: ExerciseCategory,
  intention: Intention,
  setType: SetType,
): number {
  if (setType === 'drop') return 0;
  if (setType === 'warmup') return settings.warmup;
  return Math.max(settings.byIntention[intention], settings.floors[category]);
}
