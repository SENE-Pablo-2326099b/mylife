/** Premier lancement de MyLife sur cet appareil (écran de bienvenue montré une fois). */
const KEY = 'mylife:welcomed';

/** Le premier lancement a-t-il déjà eu lieu sur cet appareil ? (déjà connecté : oui). */
export function welcomed(): boolean {
  try {
    return localStorage.getItem(KEY) === '1' || !!localStorage.getItem('mylife-session');
  } catch {
    return true;
  }
}

export function markWelcomed() {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* tant pis : l'accueil se remontrera */
  }
}
