// GÉNÉRÉ depuis MyLife/packages/ui — ne pas modifier ici (MyLife : npm run vendor).
import { useSyncExternalStore } from 'react';

/**
 * Sauvegarde hebdomadaire : les données de MyFinances et de MyPerf vivent dans le navigateur (vider les
 * données du site les efface). Une fois par semaine, l'app propose de télécharger une copie. La date de la
 * dernière sauvegarde reste sur l'appareil (jamais synchronisée : elle dépend de l'appareil).
 */
export const BACKUP_EVERY_MS = 7 * 86_400_000;
const SNOOZE_MS = 86_400_000;
const lastKey = (app: string) => `mylife:backup:${app}`;
const snoozeKey = (app: string) => `mylife:backup-snooze:${app}`;
const EVENT = 'mylife:backup';

function num(key: string): number | null {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function put(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* stockage indisponible : le rappel reviendra */
  }
  window.dispatchEvent(new Event(EVENT));
}

export const lastBackupAt = (app: string) => num(lastKey(app));

/** À appeler quand une sauvegarde vient d'être téléchargée (par le rappel ou à la main). */
export function markBackedUp(app: string, at = Date.now()): void {
  put(lastKey(app), at);
}

export const snoozeBackup = (app: string, at = Date.now()) => put(snoozeKey(app), at);

/** Une sauvegarde est-elle due ? (jamais faite ou vieille de 7 jours, et pas repoussée depuis un jour) */
export function backupDue(last: number | null, snoozed: number | null, now = Date.now()): boolean {
  if (snoozed !== null && now - snoozed < SNOOZE_MS) return false;
  return last === null || now - last >= BACKUP_EVERY_MS;
}

function subscribe(fn: () => void) {
  window.addEventListener(EVENT, fn);
  window.addEventListener('storage', fn);
  return () => {
    window.removeEventListener(EVENT, fn);
    window.removeEventListener('storage', fn);
  };
}

/** `due` : le rappel doit s'afficher ; `last` : date de la dernière sauvegarde (null : jamais). */
export function useBackupStatus(app: string): { due: boolean; last: number | null } {
  const raw = useSyncExternalStore(subscribe, () => `${num(lastKey(app))}|${num(snoozeKey(app))}`, () => 'null|null');
  const [l, s] = raw.split('|');
  const last = l === 'null' ? null : Number(l);
  return { due: backupDue(last, s === 'null' ? null : Number(s)), last };
}
