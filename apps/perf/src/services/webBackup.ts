import { Platform } from 'react-native';

/**
 * Sauvegarde hebdomadaire de MyPerf sur le web (mêmes règles que packages/ui/src/backup.ts de MyLife) :
 * la date de la dernière sauvegarde reste dans le navigateur, une copie est proposée tous les 7 jours,
 * « Plus tard » repousse d'un jour. L'app Android a ses sauvegardes automatiques (autoBackup.ts).
 */
const EVERY = 7 * 86_400_000;
const SNOOZE = 86_400_000;
const LAST = 'mylife:backup:perf';
const SNOOZED = 'mylife:backup-snooze:perf';
export const BACKUP_EVENT = 'mylife:backup';

const read = (k: string): number | null => {
  try {
    const v = Number(localStorage.getItem(k));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
};
const write = (k: string, v: number) => {
  try {
    localStorage.setItem(k, String(v));
  } catch {
    /* stockage indisponible */
  }
  window.dispatchEvent(new Event(BACKUP_EVENT));
};

export const lastWebBackup = () => (Platform.OS === 'web' ? read(LAST) : null);
export const markWebBackedUp = () => Platform.OS === 'web' && write(LAST, Date.now());
export const snoozeWebBackup = () => Platform.OS === 'web' && write(SNOOZED, Date.now());

export function webBackupDue(now = Date.now()): boolean {
  if (Platform.OS !== 'web') return false;
  const snoozed = read(SNOOZED);
  if (snoozed !== null && now - snoozed < SNOOZE) return false;
  const last = read(LAST);
  return last === null || now - last >= EVERY;
}
