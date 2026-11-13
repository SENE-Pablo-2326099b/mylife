// GÉNÉRÉ depuis MyLife/packages/lumen — ne pas modifier ici (MyLife : npm run vendor).
/**
 * Registre des apps qui vivent dans l'accueil MyLife (web/src/pages), le « contrat d'app » de la V4
 * (docs/CONTRAT-APP.md). Chaque app y déclare ses prises une fois ; l'accueil (tuiles), « Mes données » (export) et
 * la page de confidentialité en découlent, et `tests/contract.test.ts` vérifie le reste : effacement quand un autre
 * compte se connecte, route, destinations de la palette. Remplacé en phase 2 par le contrat de module de la V5.
 */
export interface HomeAppInfo {
  id: string;
  name: string;
  /** Écran principal (une route de web/src/App.tsx, une destination de la palette). */
  path: string;
  /** Nom d'une icône du kit (packages/ui/src/icons.tsx). */
  icon: string;
  /** Une ligne sous le nom, sur l'accueil. */
  tagline: string;
  /** Grande carte sur toute la largeur plutôt qu'une tuile. */
  wide?: boolean;
  /** Préfixes de ce qu'elle garde sur l'appareil : tous effacés quand un autre compte se connecte. */
  storage: readonly string[];
  /** Où ses données vont, chiffrées : sa propre app de synchro (`SYNC_APPS`), des lignes de `mylife`, des espaces partagés. */
  sync: { app: string } | { mylife: readonly string[] } | { spaces: true };
  /** Ses données dans l'export de « Mes données » (les espaces partagés n'y sont pas : ils appartiennent au groupe). */
  exportable: boolean;
  /** Ce qu'elle garde, en quelques mots, pour la page de confidentialité. */
  privacy: string;
}

export const HOME_APPS: readonly HomeAppInfo[] = [
  { id: 'sorties', name: 'Sorties', path: '/sorties', icon: 'flag-fill', tagline: 'Chaud ? Planning, budget, sac', storage: ['mylife:space:'], sync: { spaces: true }, exportable: false, privacy: 'tes sorties (réponses, planning, dépenses, liste, ID)' },
];

export const homeApp = (id: string): HomeAppInfo | undefined => HOME_APPS.find((a) => a.id === id);
