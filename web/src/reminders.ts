import { EVERY_DAY, localToday, type MiniApp } from './vendor/lumen';
import { currentSession } from './vendor/mylife-sync/web';
import { currentEndpoint, sendWakeups, setRemindersCount } from './push';
import { readMiniApps } from './ui/stats';

/**
 * Rappels écrits par l'appareil (V4, F2). L'appareil calcule ses rappels (« Lecture : note ta saisie du jour » à 21 h),
 * les range dans sa base locale (IndexedDB, lue par le service worker `push-sw.js`), et n'envoie au serveur que des
 * **heures de réveil** en minutes UTC. Au réveil, le serveur envoie un signal vide ; le service worker retrouve ici le
 * rappel du moment et l'écrit. Le serveur ne sait pas de quoi tu es rappelé.
 */

export interface PlannedReminder {
  id: string;
  title: string;
  body: string;
  url: string;
  /** Minute de la journée, heure locale. */
  minute: number;
  /** Bit 0 = lundi … bit 6 = dimanche. */
  days: number;
  /** Jours (AAAA-MM-JJ) où il ne sonne pas : déjà fait. */
  skip: string[];
}

const DB = 'mylife-reminders';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function writePlan(plan: PlannedReminder[]): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(plan, 'plan');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/** Les rappels de « Mes apps » : une app avec un rappel, qui ne sonne pas le jour où elle a déjà une saisie. */
export function miniAppReminders(apps: readonly MiniApp[], today = localToday()): PlannedReminder[] {
  return apps
    .filter((a) => a.spec && a.reminder)
    .map((a) => ({
      id: `miniapp:${a.id}`,
      title: a.spec!.name,
      body: 'Pense à noter ta saisie du jour.',
      url: `/mes-apps/${a.id}`,
      minute: a.reminder!.minute,
      days: a.reminder!.days || EVERY_DAY,
      skip: a.entries.some((e) => e.day === today) ? [today] : [],
    }));
}

/** Minutes UTC des réveils, pour un fuseau donné (décalage en minutes, comme `getTimezoneOffset`). */
export function wakeupMinutes(plan: readonly PlannedReminder[], offset = new Date().getTimezoneOffset()): number[] {
  return [...new Set(plan.map((r) => (((r.minute + offset) % 1440) + 1440) % 1440))].sort((a, b) => a - b);
}

let lastSent = '';

/** Recalcule le plan de l'appareil et ses heures de réveil (au lancement, et quand « Mes apps » change). */
export async function refreshReminders(): Promise<void> {
  if (typeof indexedDB === 'undefined' || !currentSession()) return;
  const plan = miniAppReminders(Object.values(readMiniApps()));
  setRemindersCount(plan.length);
  try {
    await writePlan(plan);
    const endpoint = await currentEndpoint();
    if (!endpoint) return;
    const minutes = wakeupMinutes(plan);
    const key = `${endpoint}|${minutes.join(',')}`;
    if (key === lastSent) return;
    await sendWakeups(endpoint, minutes);
    lastSent = key;
  } catch {
    /* hors ligne, notifications désactivées : on réessaiera au prochain changement */
  }
}
