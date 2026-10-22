// GÉNÉRÉ depuis MyLife/packages/ui — ne pas modifier ici (MyLife : npm run vendor).
import { useSyncExternalStore } from 'react';

/** Les écrans poussés masquent la barre d'onglets (un écran = un objectif ; le retour est en haut). */
let hidden = 0;
const listeners = new Set<() => void>();

export function setDockHidden(on: boolean): void {
  hidden = Math.max(0, hidden + (on ? 1 : -1));
  listeners.forEach((l) => l());
}

export function useDockHidden(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => hidden > 0,
    () => false,
  );
}
