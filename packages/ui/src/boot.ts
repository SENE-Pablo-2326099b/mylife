import { configureApp, type KitAppId } from './app';
import { installErrorLog } from './errorLog';
import { installGlassLight } from './glassLight';
import { startPrefsSync } from './prefsSync';
import { bootTheme } from './themeRuntime';

/**
 * Démarrage commun des apps web MyLife, avant le premier rendu : nom de l'app, journal d'erreurs
 * local, bonnes couleurs dès la première image, lumière au contact du verre, apparence synchronisée
 * entre appareils.
 */
export function bootMyLife(id: KitAppId): void {
  configureApp(id);
  // Plantages gardés sur l'appareil (jamais envoyés) pour pouvoir les signaler.
  installErrorLog();
  bootTheme();
  installGlassLight();
  startPrefsSync();
}
