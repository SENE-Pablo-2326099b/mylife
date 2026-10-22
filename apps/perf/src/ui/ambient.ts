import { useSyncExternalStore } from 'react';

/**
 * Lumière d'état : une lueur posée en haut du champ de lumière (séance en cours, séance du jour
 * faite…). null = rien à signaler. Même principe que dans MyFinances (budget du jour).
 */
export type Ambient = 'accent' | 'success' | 'warning' | 'danger' | null;
let ambient: Ambient = null;
const listeners = new Set<() => void>();

export function setAmbient(next: Ambient): void {
  if (next === ambient) return;
  ambient = next;
  listeners.forEach((l) => l());
}

export function useAmbient(): Ambient {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => ambient,
    () => ambient,
  );
}
