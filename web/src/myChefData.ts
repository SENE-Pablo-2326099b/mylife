import { STARTER_RECIPES, findFood, foodId, parsePantryItem, parsePlannedMeal, parseRecipe, parseShoppingItem, type Recipe } from './vendor/lumen';
import { defineCollection } from './ui/collectionSync';

/**
 * Données de MyChef, chiffrées et synchronisées (app de synchro `chef`) : le garde-manger et la liste de courses, une
 * ligne par aliment (même aliment = même identifiant sur tous les appareils, voir `foodId`).
 */
export const pantry = defineCollection({ app: 'chef', name: 'pantry', parse: parsePantryItem, max: 1500 });
export const shopping = defineCollection({ app: 'chef', name: 'list', parse: parseShoppingItem, max: 500 });

/** Tes recettes (format `mychef-recipe`), une ligne chacune. */
export const recipes = defineCollection({ app: 'chef', name: 'recipes', parse: parseRecipe, max: 500 });

export interface CookedMeal {
  v: 1;
  title: string;
  day: string;
  /** Elle a utilisé un aliment qui périmait bientôt (gaspillage évité). */
  saved?: boolean;
}
const parseCooked = (raw: unknown): CookedMeal | null => {
  const o = raw as Partial<CookedMeal> | null;
  return o && o.v === 1 && typeof o.title === 'string' && typeof o.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.day) ? { v: 1, title: o.title.slice(0, 80), day: o.day, ...(o.saved === true ? { saved: true } : {}) } : null;
};
/** Les repas cuisinés (« J'ai cuisiné ») : l'historique et les compteurs du Personnage (Vitalité). */
export const cooked = defineCollection({ app: 'chef', name: 'cooked', parse: parseCooked, max: 3000 });

/** Aliment d'une recette → article de liste de courses (rayon du catalogue, même identifiant partout). */
export const listItemFor = (name: string) => {
  const food = findFood(name);
  return { id: foodId(name), item: { v: 1 as const, name: food?.name ?? name, aisle: food?.aisle ?? ('autre' as const) } };
};

/** Les repas prévus de la semaine (une ligne par jour et par repas : `AAAA-MM-JJ-midi`). */
export const plan = defineCollection({ app: 'chef', name: 'plan', parse: parsePlannedMeal, max: 400 });

/** Tes recettes puis les recettes fournies (identifiants `fournie-<n>`), comme les voient Recettes et Semaine. */
export function withStarters(mine: readonly { id: string; value: Recipe }[]): { id: string; value: Recipe; mine: boolean }[] {
  return [...mine.map((m) => ({ id: m.id, value: m.value, mine: true })), ...STARTER_RECIPES.map((r, k) => ({ id: `fournie-${k}`, value: r, mine: false }))];
}
