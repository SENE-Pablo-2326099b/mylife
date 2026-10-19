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
