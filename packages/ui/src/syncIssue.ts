/**
 * Problèmes de synchro à montrer plutôt qu'à taire (page Compte) : un refus du serveur qui revient à chaque
 * passage, une ligne trop grosse. Gardé sur l'appareil, effacé avec le reste quand un autre compte se connecte.
 */
const PREFIX = 'mylife:sync-issue:';

export interface SyncIssue {
  at: number;
  message: string;
}

export function noteSyncIssue(app: string, message: string): void {
  try {
    localStorage.setItem(`${PREFIX}${app}`, JSON.stringify({ at: Date.now(), message: message.slice(0, 200) }));
  } catch {
    /* stockage indisponible */
  }
}

export function clearSyncIssue(app: string): void {
  try {
    localStorage.removeItem(`${PREFIX}${app}`);
  } catch {
    /* stockage indisponible */
  }
}

export function readSyncIssue(app: string): SyncIssue | null {
  try {
    const v = JSON.parse(localStorage.getItem(`${PREFIX}${app}`) ?? 'null') as SyncIssue | null;
    return v && typeof v.at === 'number' && typeof v.message === 'string' ? v : null;
  } catch {
    return null;
  }
}
