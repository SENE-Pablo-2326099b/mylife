/**
 * Données personnelles de l'auteur (programme réel + historique du carnet) : elles ne sont embarquées que
 * dans un build privé (`EXPO_PUBLIC_PERSONAL_DATA=1`). La version publique (web, MyLife) n'en contient
 * AUCUNE : un nouvel utilisateur démarre sur une base vide, avec la bibliothèque d'exercices générique.
 * Le propriétaire récupère ses données par son compte, ou par « Importer une sauvegarde » (JSON).
 */
export const PERSONAL_BUILD = process.env.EXPO_PUBLIC_PERSONAL_DATA === '1';

type Importer = typeof import('./importer');

/** Le module d'import, ou null dans un build public (le `require` est alors éliminé du paquet). */
export function personalImporter(): Importer | null {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- chargement conditionnel voulu (build privé)
  if (process.env.EXPO_PUBLIC_PERSONAL_DATA === '1') return require('./importer') as Importer;
  return null;
}
