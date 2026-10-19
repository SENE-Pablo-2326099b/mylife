import { useSyncExternalStore } from 'react';
import { haptic } from './motion';

/**
 * Retours qui ne bloquent jamais : une capsule de verre flottante, avec « Annuler » le cas échéant.
 * Toute suppression passe par là (jamais de popup de confirmation).
 */
export interface Toast {
  id: number;
  message: string;
  tone?: 'default' | 'gold' | 'danger';
  actionLabel?: string;
  onAction?: () => void;
  /** Appelé quand le toast disparaît sans que l'action ait été choisie. */
  onExpire?: () => void;
  duration: number;
}

let current: Toast | null = null;
let seq = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function clear(expired: boolean) {
  const t = current;
  current = null;
  if (timer) clearTimeout(timer);
  timer = null;
  emit();
  if (expired) t?.onExpire?.();
}

export function toast(input: Omit<Toast, 'id' | 'duration'> & { duration?: number }): void {
  // Le toast précédent se termine (et confirme son action différée) avant le suivant.
  if (current) clear(true);
  current = { duration: input.actionLabel ? 6000 : 3200, ...input, id: ++seq };
  if (input.tone === 'gold') haptic('success');
  emit();
  timer = setTimeout(() => clear(true), current.duration);
}

/** « Annuler » touché : le toast part sans confirmer l'action différée. */
export function runToastAction(): void {
  const t = current;
  current = null;
  if (timer) clearTimeout(timer);
  timer = null;
  emit();
  t?.onAction?.();
}

export function dismissToast(): void {
  if (current) clear(true);
}

/**
 * Suppression annulable : `remove` s'exécute tout de suite, `restore` si l'on touche « Annuler ».
 */
export async function undoable(message: string, remove: () => Promise<unknown>, restore: () => Promise<unknown>): Promise<void> {
  await remove();
  haptic('warning');
  toast({ message, actionLabel: 'Annuler', onAction: () => void restore() });
}

/**
 * Action différée (déconnexion d'une banque…) : n'a lieu qu'à la disparition du toast,
 * « Annuler » l'empêche.
 */
export function deferred(message: string, action: () => Promise<unknown> | void): void {
  haptic('warning');
  toast({ message, actionLabel: 'Annuler', onExpire: () => void action() });
}

export function useToast(): Toast | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => null,
  );
}
