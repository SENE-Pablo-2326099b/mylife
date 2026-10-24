// GÉNÉRÉ depuis MyLife/packages/sync-client — ne pas modifier ici (MyLife : npm run vendor).
/**
 * Ce que le navigateur garde pour la personne connectée, en dehors des données synchronisées : la clé
 * d'API Anthropic, la conversation avec l'assistant, les aperçus de l'accueil, la date de la dernière
 * sauvegarde. Quand un **autre** compte se connecte sur l'appareil, tout cela est effacé : il ne voit ni
 * n'utilise rien du précédent. (Les données des apps, elles, sont effacées par la synchro : `autoJoin`.)
 */
export const DEVICE_OWNER_KEY = 'mylife:device-owner';

const PERSONAL_KEYS = [
  // Clé d'API Anthropic (et ses anciens noms).
  'mylife:anthropic-key',
  'myfinances-anthropic-key',
  'myperf_anthropic_api_key',
  // Conversation avec l'assistant de MyFinances, journal des erreurs, autorisation bancaire en cours.
  'myfinances-assistant-history',
  'myfinances-assistant-mode',
  'myfinances-errors',
  'myperf-errors',
  'myraveloc-errors',
  'pendingAuth',
];
// Aperçus, dates de sauvegarde, compteurs et préférences du Personnage, données des espaces partagés, Mes apps,
// problèmes de synchro notés.
// `mylife:app:` : les collections synchronisées des apps de l'accueil (packages/ui/src/collectionSync.ts).
export const PERSONAL_PREFIXES = ['mylife:glance:', 'mylife:backup', 'mylife:stats', 'mylife:character', 'mylife:space:', 'mylife:music', 'mylife:games', 'mylife:copilot', 'mylife:miniapps', 'mylife:sync-issue', 'mylife:app:'];

/** À appeler à chaque connexion : efface les traces d'un compte précédent (ou inconnu), puis note le nouveau. */
export function claimDevice(login: string): void {
  try {
    const ls = globalThis.localStorage;
    if (!ls || ls.getItem(DEVICE_OWNER_KEY) === login) return;
    for (const k of PERSONAL_KEYS) ls.removeItem(k);
    const keys = Array.from({ length: ls.length }, (_, i) => ls.key(i)).filter((k): k is string => k !== null);
    for (const k of keys) if (PERSONAL_PREFIXES.some((p) => k.startsWith(p))) ls.removeItem(k);
    // Rappels écrits par l'appareil (plan lu par le service worker) : ceux du compte précédent disparaissent.
    if (typeof indexedDB !== 'undefined') indexedDB.deleteDatabase('mylife-reminders');
    ls.setItem(DEVICE_OWNER_KEY, login);
  } catch {
    /* stockage indisponible : rien à effacer */
  }
}

/** Appareil d'avant cette règle, déjà connecté : sa session en cours en est la propriétaire. */
export function adoptDevice(login: string): void {
  try {
    const ls = globalThis.localStorage;
    if (ls && ls.getItem(DEVICE_OWNER_KEY) === null) ls.setItem(DEVICE_OWNER_KEY, login);
  } catch {
    /* stockage indisponible */
  }
}
