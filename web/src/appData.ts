import { readGames, readMiniApps, readMusic } from './ui/stats';

/**
 * Ce que chaque app de l'accueil met dans l'export de « Mes données » (registre `HOME_APPS`, champ `exportable`).
 * Une app qui s'ajoute (`npm run new-app`) ajoute ici sa ligne ; `tests/contract.test.ts` le vérifie.
 */
export const APP_EXPORTS: Record<string, () => unknown> = {
  musique: () => readMusic(),
  jeux: () => readGames(),
  'mes-apps': () => Object.values(readMiniApps()).filter((a) => a.spec),
  // new-app: exports (repère du générateur, ne pas retirer)
};
