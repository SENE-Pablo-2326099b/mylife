import { configureApp } from '../ui/app';

/** MyFinances dans le kit MyLife : nom affiché (titres, sauvegardes), chemin, journal d'erreurs. */
export const APP = configureApp('finances');
/** Nom affiché de l'app (titre, sauvegardes). */
export const APP_NAME = APP.name;
/**
 * Chemin de l'app sous MyLife (« /finances »), sans barre finale ; vide en test.
 * Toutes les apps MyLife partagent une même origine : une connexion, une synchro.
 */
export const BASE_PATH = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
export { openMyLifeApp } from '../ui/app';
