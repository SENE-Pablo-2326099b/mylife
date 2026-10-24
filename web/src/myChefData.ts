import { parsePantryItem, parseShoppingItem } from './vendor/lumen';
import { defineCollection } from './ui/collectionSync';

/**
 * Données de MyChef, chiffrées et synchronisées (app de synchro `chef`) : le garde-manger et la liste de courses, une
 * ligne par aliment (même aliment = même identifiant sur tous les appareils, voir `foodId`).
 */
export const pantry = defineCollection({ app: 'chef', name: 'pantry', parse: parsePantryItem, max: 1500 });
export const shopping = defineCollection({ app: 'chef', name: 'list', parse: parseShoppingItem, max: 500 });
