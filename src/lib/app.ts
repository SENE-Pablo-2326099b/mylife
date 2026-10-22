/** Nom affiché de l'app (titre, manifeste, sauvegardes). */
export const APP_NAME = 'MyFinances';
/**
 * Chemin de l'app sous MyLife (« /finances »), sans barre finale ; vide en test.
 * Toutes les apps MyLife partagent une même origine : une connexion, une synchro.
 */
export const BASE_PATH = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
/** Ouvre une autre app MyLife (même adresse : la session et le compte suivent). */
export function openMyLifeApp(path: string): void {
  window.location.assign(path);
}
export const APP_TAGLINE = 'Budget, patrimoine, placements';
