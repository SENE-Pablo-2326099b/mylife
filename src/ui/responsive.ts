import { useSyncExternalStore } from 'react';

/**
 * Trois vraies mises en page, pas une seule étirée :
 * - compact (téléphones, < 640 px) : une colonne, barre d'onglets flottante en bas ;
 * - medium (tablettes, petites fenêtres) : colonne plus large, barre d'onglets ;
 * - expanded (≥ 1024 px) : barre latérale de verre à gauche, écrans sur plusieurs colonnes.
 */
export type Breakpoint = 'compact' | 'medium' | 'expanded';

export function breakpointFor(width: number): Breakpoint {
  if (width >= 1024) return 'expanded';
  if (width >= 640) return 'medium';
  return 'compact';
}

function subscribe(cb: () => void) {
  window.addEventListener('resize', cb);
  return () => window.removeEventListener('resize', cb);
}

export function useWindowWidth(): number {
  return useSyncExternalStore(subscribe, () => window.innerWidth, () => 390);
}

export function useWindowHeight(): number {
  return useSyncExternalStore(subscribe, () => window.innerHeight, () => 844);
}

export function useBreakpoint(): Breakpoint {
  return breakpointFor(useWindowWidth());
}

/** Gouttière latérale : généreuse sur téléphone (16 px), plus large au-delà. */
export const GUTTER: Record<Breakpoint, number> = { compact: 16, medium: 24, expanded: 32 };

export const DOCK_HEIGHT = 64;
export const DOCK_MARGIN = 12;
export const SIDEBAR_WIDTH = 248;
