import { classifyTransactions } from '../domain/classifyDb';
import { ADDED_RULE_SEEDS, DEFAULT_CATEGORIES, DEFAULT_SETTINGS, addedRules, buildDefaultRules } from '../domain/defaults';
import { normalizeSettings } from '../domain/settingsModel';
import { db, getMeta, setMeta, type BudgetDB } from './db';
import type { Settings } from './types';

/** À augmenter quand le classement change : toutes les opérations sont reclassées une fois (corrections manuelles conservées). */
const CLASSIFIER_VERSION = 2;

/** Initialise la base au premier lancement (réglages, catégories, règles par défaut) et migre les réglages. */
export async function ensureSeeded(database: BudgetDB = db): Promise<void> {
  let rulesAdded = false;
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
    // Règles par défaut apparues après l'installation : posées une fois (une règle supprimée ne revient pas).
    const applied = (await getMeta<string[]>('addedRules', database)) ?? [];
    const missing = addedRules().filter((r) => !applied.includes(r.id));
    if (missing.length) {
      const existing = new Set((await database.rules.bulkGet(missing.map((r) => r.id))).filter(Boolean).map((r) => r!.id));
      const toAdd = missing.filter((r) => !existing.has(r.id));
      if (toAdd.length) await database.rules.bulkPut(toAdd);
      await setMeta('addedRules', ADDED_RULE_SEEDS.map((r) => r.id), database);
      rulesAdded = toAdd.length > 0;
    }
    if (((await getMeta<number>('classifierVersion', database)) ?? 1) < CLASSIFIER_VERSION) {
      await setMeta('classifierVersion', CLASSIFIER_VERSION, database);
      rulesAdded = true;
    }
  });
  if (rulesAdded && (await database.transactions.count()) > 0) await classifyTransactions(database);
}

export async function getSettings(database: BudgetDB = db): Promise<Settings> {
  return normalizeSettings((await database.settings.get('main')) ?? DEFAULT_SETTINGS);
}

export async function updateSettings(patch: Partial<Settings>, database: BudgetDB = db): Promise<void> {
  const current = await getSettings(database);
  await database.settings.put({ ...current, ...patch, id: 'main' });
}
