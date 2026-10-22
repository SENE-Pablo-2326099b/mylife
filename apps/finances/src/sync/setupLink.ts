import { updateSettings } from '../db/seed';

/** Mot de passe contenu dans un fragment `#relais=<mot de passe>`, ou null. */
export function parseSetupHash(hash: string): string | null {
  const match = /(?:^#|&)relais=([^&]+)/.exec(hash);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]).trim() || null;
  } catch {
    return null;
  }
}

/**
 * Lien de configuration `https://…/synchro#relais=<mot de passe>` (affiché par `npm run setup`) :
 * enregistre le mot de passe du relais sur l'appareil puis efface le fragment de l'URL.
 * Le fragment (#…) n'est jamais envoyé au serveur.
 */
export async function absorbSetupLink(): Promise<boolean> {
  if (!/(?:^#|&)relais=/.test(window.location.hash)) return false;
  const password = parseSetupHash(window.location.hash);
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  if (!password) return false;
  await updateSettings({ bridgePassword: password });
  return true;
}
