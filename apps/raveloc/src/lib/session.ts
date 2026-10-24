/**
 * Compte MyLife sur le web : la session commune à toutes les apps de l'adresse (accueil, MyFinances,
 * MyPerf, MyRave) — une seule connexion. Voir vendor/mylife-sync/web.ts.
 */
export { currentSession, onSessionChange, uidOf, webPlatform as platform } from '../vendor/mylife-sync/web';
