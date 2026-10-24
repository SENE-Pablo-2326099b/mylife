import type { StatId } from './character';

/**
 * Registre des apps qui vivent dans l'accueil MyLife (web/src/pages), le « contrat d'app » de la V4
 * (docs/CONTRAT-APP.md). Chaque app y déclare ses prises une fois ; l'accueil (tuiles), « Mes données » (export) et
 * la page de confidentialité en découlent, et `tests/contract.test.ts` vérifie le reste : effacement quand un autre
 * compte se connecte, route, destinations de la palette, app de synchro déclarée au serveur.
 * Une nouvelle app : `npm run new-app <id> "<Nom>"`, qui ajoute son entrée avant le repère ci-dessous.
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
  /** Stat du Personnage qu'elle fait monter. */
  stat?: StatId;
}

export const HOME_APPS: readonly HomeAppInfo[] = [
  { id: 'sorties', name: 'Sorties', path: '/sorties', icon: 'flag-fill', tagline: 'Chaud ? Planning, budget, sac', storage: ['mylife:space:'], sync: { spaces: true }, exportable: false, privacy: 'tes sorties (réponses, planning, dépenses, liste, ID)', stat: 'social' },
  { id: 'crew', name: 'Crew', path: '/crew', icon: 'people-fill', tagline: 'Ton niveau face à tes amis', storage: ['mylife:space:'], sync: { spaces: true }, exportable: false, privacy: 'tes scores et pactes dans tes Crews' },
  { id: 'musique', name: 'MyMusique', path: '/musique', icon: 'sparkles', tagline: 'Tes stats d’écoute', storage: ['mylife:music'], sync: { mylife: ['music'] }, exportable: true, privacy: 'le résumé de ton écoute (jamais l’export Spotify entier)', stat: 'culture' },
  { id: 'jeux', name: 'MyGames', path: '/jeux', icon: 'play', tagline: 'Heures de jeu, ton temps', storage: ['mylife:games'], sync: { mylife: ['games'] }, exportable: true, privacy: 'tes heures de jeu' },
  { id: 'mes-apps', name: 'Mes apps', path: '/mes-apps', icon: 'apps', tagline: 'Lecture, sommeil, habitudes : crée les tiennes, sans code', wide: true, storage: ['mylife:miniapps'], sync: { app: 'miniapps' }, exportable: true, privacy: 'tes apps sans code et leurs saisies' },
  { id: 'objectifs', name: 'MyObjectifs', path: '/objectifs', icon: 'flag', tagline: 'Tes objectifs, mesurés par tes apps', storage: ['mylife:app:objectifs:'], sync: { app: 'objectifs' }, exportable: true, privacy: 'tes objectifs (titre, cible, date limite)' },
  // new-app: entrées (repère du générateur, ne pas retirer)
];

export const homeApp = (id: string): HomeAppInfo | undefined => HOME_APPS.find((a) => a.id === id);
