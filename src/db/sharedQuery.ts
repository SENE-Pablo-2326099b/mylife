import { liveQuery, type Subscription } from 'dexie';
import { useSyncExternalStore } from 'react';

/**
 * Une requête en direct partagée : lue UNE fois pour tous les composants qui l'utilisent (au lieu
 * d'une lecture par composant, relancée par chacun à chaque écriture), arrêtée quelques secondes après
 * le dernier abonné. Le hook renvoie undefined tant que la première lecture n'est pas arrivée.
 */
export function sharedLiveQuery<T>(query: () => Promise<T>): () => T | undefined {
  let state: T | undefined;
  let sub: Subscription | null = null;
  let refs = 0;
  let stopTimer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    refs++;
    if (stopTimer) clearTimeout(stopTimer);
    stopTimer = null;
    sub ??= liveQuery(query).subscribe({
      next: (v) => {
        state = v;
        listeners.forEach((l) => l());
      },
      error: () => undefined,
    });
    return () => {
      listeners.delete(listener);
      refs--;
      if (refs === 0)
        stopTimer = setTimeout(() => {
          sub?.unsubscribe();
          sub = null;
        }, 5000);
    };
  };
  const snapshot = () => state;
  return () => useSyncExternalStore(subscribe, snapshot);
}
