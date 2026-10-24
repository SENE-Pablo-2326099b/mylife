import { EVERY_DAY, STARTER_RECIPES, addDaysIso, findFood, foodKey, localToday, type MiniApp, type PantryItem, type PlannedMeal, type Recipe } from './vendor/lumen';
import { pantry, plan as chefPlan, recipes } from './myChefData';

const mealList = () => chefPlan.list().map((m) => m.value);
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
  /** Un seul jour (AAAA-MM-JJ) : un rappel ponctuel (MyChef : sortir un aliment du congélateur la veille). */
  date?: string;
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

const keyOf = (name: string) => foodKey(findFood(name)?.name ?? name);

/**
 * MyChef : la veille d'un repas prévu, à 20 h, « sors le poulet du congélateur » pour chaque ingrédient rangé au
 * congélateur. Rappels ponctuels (une date).
 */
export function chefReminders(meals: readonly PlannedMeal[], mine: readonly { id: string; value: Recipe }[], stock: readonly PantryItem[], today = localToday()): PlannedReminder[] {
  const frozen = new Map(stock.filter((p) => p.place === 'congel' && p.level !== 'out').map((p) => [keyOf(p.name), p.name]));
  if (!frozen.size) return [];
  const all = [...mine, ...STARTER_RECIPES.map((r, k) => ({ id: `fournie-${k}`, value: r }))];
  const out: PlannedReminder[] = [];
  for (const m of meals) {
    if (m.leftover || !m.recipeId || m.day <= today) continue;
    const r = all.find((x) => x.id === m.recipeId)?.value;
    const items = [...new Set((r?.ingredients ?? []).map((i) => frozen.get(keyOf(i.name))).filter((n): n is string => !!n))];
    if (!items.length) continue;
    out.push({ id: `chef:${m.day}-${m.slot}`, title: 'MyChef', body: `Sors du congélateur pour demain : ${items.join(', ').toLowerCase()} (${m.title}).`, url: '/chef?vue=semaine', minute: 20 * 60, days: EVERY_DAY, skip: [], date: addDaysIso(m.day, -1) });
  }
  return out;
}

/** Minutes UTC des réveils, pour un fuseau donné (décalage en minutes, comme `getTimezoneOffset`). */
export function wakeupMinutes(plan: readonly PlannedReminder[], offset = new Date().getTimezoneOffset()): number[] {
  return [...new Set(plan.map((r) => (((r.minute + offset) % 1440) + 1440) % 1440))].sort((a, b) => a - b);
}

let lastSent = '';

/** Recalcule le plan de l'appareil et ses heures de réveil (au lancement, et quand « Mes apps » change). */
export async function refreshReminders(): Promise<void> {
  if (typeof indexedDB === 'undefined' || !currentSession()) return;
  const plan = [...miniAppReminders(Object.values(readMiniApps())), ...chefReminders(mealList(), recipes.list(), pantry.list().map((p) => p.value))];
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
