import { DEFAULT_CATEGORIES, DEFAULT_SETTINGS, buildDefaultRules } from '../domain/defaults';
import { normalizeSettings } from '../domain/settingsModel';
import { db, getMeta, setMeta, type BudgetDB } from './db';
import type { Settings } from './types';

/** Initialise la base au premier lancement (réglages, catégories, règles par défaut) et migre les réglages. */
export async function ensureSeeded(database: BudgetDB = db): Promise<void> {
  await database.transaction('rw', [database.settings, database.categories, database.rules, database.meta], async () => {
    const stored = await database.settings.get('main');
    // Complète / migre les réglages (v1 mono-utilisateur → listes personnalisables).
    const settings = normalizeSettings(stored ?? DEFAULT_SETTINGS);
    await database.settings.put(settings);
    if (!(await getMeta<boolean>('seeded', database))) {
      if ((await database.categories.count()) === 0) await database.categories.bulkPut(DEFAULT_CATEGORIES);
      if ((await database.rules.count()) === 0) await database.rules.bulkPut(buildDefaultRules(settings.holderNames));
      await setMeta('seeded', true, database);
    }
  });
}

export async function getSettings(database: BudgetDB = db): Promise<Settings> {
  return normalizeSettings((await database.settings.get('main')) ?? DEFAULT_SETTINGS);
}

export async function updateSettings(patch: Partial<Settings>, database: BudgetDB = db): Promise<void> {
  const current = await getSettings(database);
  await database.settings.put({ ...current, ...patch, id: 'main' });
}
