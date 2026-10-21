/** Nom affiché de l'app (titre, manifeste, sauvegardes). */
export const APP_NAME = 'MyFinances';
/**
 * Chemin de l'app sous MyLife (« /finances »), sans barre finale ; vide en test.
 * Toutes les apps MyLife partagent une même origine : une connexion, une synchro.
 */
export const BASE_PATH = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
export const APP_TAGLINE = 'Budget, patrimoine, placements';
