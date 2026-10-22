import { useSyncExternalStore } from 'react';

/** Palette de commande : ouverte depuis l'orbe du dock, la barre latérale ou Ctrl/Cmd + K. */
let open = false;
const listeners = new Set<() => void>();

export function setPaletteOpen(on: boolean): void {
  if (open === on) return;
  open = on;
  listeners.forEach((l) => l());
}

export function usePaletteOpen(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => open,
    () => false,
  );
}
