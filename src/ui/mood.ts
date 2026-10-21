import { useSyncExternalStore } from 'react';

/** Ambiances de section : où la lumière se rassemble. */
export type Mood = 'today' | 'budget' | 'activity' | 'wealth' | 'settings' | 'focus';
export const MOODS: Mood[] = ['today', 'budget', 'activity', 'wealth', 'settings', 'focus'];

let mood: Mood = 'today';
const listeners = new Set<() => void>();

export function setMood(next: Mood): void {
  if (next === mood) return;
  mood = next;
  listeners.forEach((l) => l());
}

export function useMood(): Mood {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => mood,
    () => mood,
  );
}

/**
 * Lumière d'état : une lueur posée en haut du champ, verte, ambre ou rouge selon que le budget tient,
 * frôle ou dépasse. null = pas d'état à montrer (l'écran ne parle pas du budget).
 */
export type Ambient = 'success' | 'warning' | 'danger' | null;
let ambient: Ambient = null;
const ambientListeners = new Set<() => void>();

export function setAmbient(next: Ambient): void {
  if (next === ambient) return;
  ambient = next;
  ambientListeners.forEach((l) => l());
}

export function useAmbient(): Ambient {
  return useSyncExternalStore(
    (l) => {
      ambientListeners.add(l);
      return () => ambientListeners.delete(l);
    },
    () => ambient,
    () => ambient,
  );
}
