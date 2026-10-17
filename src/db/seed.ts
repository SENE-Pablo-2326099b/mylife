import { DEFAULT_ALERTS, DEFAULT_CATEGORIES, DEFAULT_SETTINGS, buildDefaultRules } from '../domain/defaults';
import { db, getMeta, setMeta, type BudgetDB } from './db';
import type { Settings } from './types';

/** Initialise la base au premier lancement (réglages, catégories, règles par défaut). */
export async function ensureSeeded(database: BudgetDB = db): Promise<void> {
  await database.transaction('rw', [database.settings, database.categories, database.rules, database.meta], async () => {
    const settings = await database.settings.get('main');
    if (!settings) {
      await database.settings.put(DEFAULT_SETTINGS);
    } else {
      // Complète les réglages ajoutés dans une version ultérieure.
      const merged: Settings = { ...DEFAULT_SETTINGS, ...settings, alerts: { ...DEFAULT_ALERTS, ...settings.alerts } };
      await database.settings.put(merged);
    }
    if (!(await getMeta<boolean>('seeded', database))) {
      if ((await database.categories.count()) === 0) await database.categories.bulkPut(DEFAULT_CATEGORIES);
      const owner = (settings ?? DEFAULT_SETTINGS).ownerName;
      if ((await database.rules.count()) === 0) await database.rules.bulkPut(buildDefaultRules(owner));
      await setMeta('seeded', true, database);
    }
  });
}

export async function getSettings(database: BudgetDB = db): Promise<Settings> {
  return (await database.settings.get('main')) ?? DEFAULT_SETTINGS;
}

export async function updateSettings(patch: Partial<Settings>, database: BudgetDB = db): Promise<void> {
  const current = await getSettings(database);
  await database.settings.put({ ...current, ...patch, id: 'main' });
}
