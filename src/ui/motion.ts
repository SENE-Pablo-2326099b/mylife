// GÉNÉRÉ depuis MyLife/packages/ui — ne pas modifier ici (MyLife : npm run vendor).
import type { Transition } from 'framer-motion';

/**
 * Vocabulaire du mouvement. Tout ce qui est physique utilise des ressorts ; les durées ne servent
 * qu'à la lumière (opacité). Tout respecte « réduire les animations » (MotionConfig dans ThemeProvider).
 */
export const springs = {
  /** Pressions, interrupteurs : rapide et ferme. */
  snappy: { type: 'spring', damping: 20, stiffness: 320, mass: 0.6 },
  /** Surfaces qui se posent (feuilles, apparitions). */
  soft: { type: 'spring', damping: 22, stiffness: 170, mass: 0.9 },
  /** Indicateurs liquides : léger dépassement, comme une goutte qui trouve sa place (validation). */
  liquid: { type: 'spring', damping: 15, stiffness: 210, mass: 0.7 },
} as const satisfies Record<string, Transition>;

export const fade = { duration: 0.22, ease: [0.22, 1, 0.36, 1] } as const;

let hapticsOn = true;
export function setHapticsEnabled(on: boolean): void {
  hapticsOn = on;
}

/** Retour haptique léger (Android : Vibration API ; iOS ignore). */
export function haptic(kind: 'tap' | 'success' | 'warning' = 'tap'): void {
  if (!hapticsOn || typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(kind === 'tap' ? 8 : kind === 'success' ? [10, 40, 16] : [24, 60, 24]);
  } catch {
    /* certains navigateurs refusent hors geste utilisateur */
  }
}
