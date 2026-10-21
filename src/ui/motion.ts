import { Platform } from 'react-native';
import { Easing, FadeIn, FadeOut, LinearTransition, ReduceMotion, type WithSpringConfig } from 'react-native-reanimated';

/**
 * Motion vocabulary. Everything physical uses springs; durations are only for light (opacity).
 * Every preset honours the system "reduce motion" setting.
 */
export const springs = {
  /** Presses, toggles: quick and firm. */
  snappy: { damping: 20, stiffness: 320, mass: 0.6, reduceMotion: ReduceMotion.System },
  /** Surfaces settling into place. */
  soft: { damping: 22, stiffness: 170, mass: 0.9, reduceMotion: ReduceMotion.System },
  /** Liquid indicators: a little overshoot, like a drop finding its place. */
  liquid: { damping: 15, stiffness: 210, mass: 0.7, reduceMotion: ReduceMotion.System },
} satisfies Record<string, WithSpringConfig>;

export const fadeIn = (delay = 0) => FadeIn.duration(220).delay(delay).reduceMotion(ReduceMotion.System);
export const fadeOut = FadeOut.duration(160).reduceMotion(ReduceMotion.System);

/** Layout changes (rows added/removed, cards expanding) glide instead of jumping. */
export const glide = LinearTransition.springify().damping(22).stiffness(200).reduceMotion(ReduceMotion.System);

export const easeOut = Easing.bezier(0.22, 1, 0.36, 1);

/**
 * Layout animations (`entering` / `exiting` / `layout`) for elements in the normal flow.
 * On the web, Reanimated leaves them absolutely positioned after they run, breaking the layout:
 * there they are skipped (the shared-value based transitions still animate).
 */
export function flowAnim<T>(anim: T): T | undefined {
  return Platform.OS === 'web' ? undefined : anim;
}
