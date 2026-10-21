import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useRestTimer } from '@/state/restTimerStore';

/**
 * Three real layouts, not one stretched:
 * - compact (phones): single column, floating dock at the bottom;
 * - medium (tablets, small windows): single wider column, dock;
 * - expanded (laptop/desktop): glass sidebar on the left, multi-column screens.
 */
export type Breakpoint = 'compact' | 'medium' | 'expanded';

export function breakpointFor(width: number): Breakpoint {
  if (width >= 1024) return 'expanded';
  if (width >= 640) return 'medium';
  return 'compact';
}

export function useBreakpoint(): Breakpoint {
  return breakpointFor(useWindowDimensions().width);
}

/** Max readable width of the content column. */
export const CONTENT_MAX: Record<Breakpoint, number> = { compact: 680, medium: 760, expanded: 1180 };

export const DOCK_HEIGHT = 64;
export const DOCK_MARGIN = 12;
export const SIDEBAR_WIDTH = 248;

/** Space to leave under scrolling content so the floating dock never hides it. */
export function useDockInset(): number {
  const insets = useSafeAreaInsets();
  const bp = useBreakpoint();
  // The rest timer capsule stacks above the dock while it runs.
  const resting = useRestTimer((s) => s.endAt !== null);
  if (bp === 'expanded') return 32;
  return DOCK_HEIGHT + DOCK_MARGIN + Math.max(insets.bottom, DOCK_MARGIN) + 24 + (resting ? REST_BAR_HEIGHT + 8 : 0);
}

/** Height of the floating rest timer capsule (RestTimerBar). */
export const REST_BAR_HEIGHT = 52;
