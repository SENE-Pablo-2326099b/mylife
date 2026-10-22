// GÉNÉRÉ depuis MyLife/packages/ui — ne pas modifier ici (MyLife : npm run vendor).
import { useSyncExternalStore } from 'react';
import { ApiError, type Session } from '../vendor/mylife-sync';
import { currentSession, onSessionChange, pendingRecovery, type PendingRecovery } from '../vendor/mylife-sync/web';

/** La session MyLife de cet appareil (commune à toutes les apps web), suivie en direct. */
export function useSession(): Session | null {
  return useSyncExternalStore(onSessionChange, currentSession, currentSession);
}

/** Clé de secours d'un compte neuf pas encore mise de côté. */
export function usePendingRecovery(): PendingRecovery | null {
  // Instantané en texte : stable tant que rien ne change (useSyncExternalStore compare par identité).
  const value = useSyncExternalStore(onSessionChange, () => JSON.stringify(pendingRecovery()), () => 'null');
  return JSON.parse(value) as PendingRecovery | null;
}

export const errorText = (e: unknown) => (e instanceof ApiError && e.status === 0 ? 'Pas de réseau : réessaie une fois connecté.' : e instanceof Error ? e.message : String(e));
