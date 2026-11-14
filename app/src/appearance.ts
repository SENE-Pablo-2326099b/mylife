import { setThemeChoice, type ThemeChoice } from '@mylife/kit';
import { getAppearance, setAppearance, subscribeAppearance, type Appearance } from '@legacy/ui/appearance';

/**
 * Le thème de la coquille et l'apparence commune des apps d'avant (synchronisée entre appareils par le compte) se
 * traduisent l'un dans l'autre : sombre ↔ « nuit », clair ↔ « perle », comme le téléphone ↔ « suit le téléphone ».
 * Un choix fait ici part dans la synchro ; un choix venu d'un autre appareil habille aussi la coquille.
 */
export function shareTheme(c: ThemeChoice): void {
  setAppearance({ theme: c === 'clair' ? 'perle' : 'nuit', followSystem: c === 'auto' });
}

export const themeFromShared = (a: Appearance): ThemeChoice => (a.followSystem ? 'auto' : a.theme === 'perle' ? 'clair' : 'sombre');

/** Au lancement : la coquille suit l'apparence commune quand elle change (autre appareil, autre onglet). */
export function followSharedAppearance(): void {
  subscribeAppearance(() => setThemeChoice(themeFromShared(getAppearance())));
}
