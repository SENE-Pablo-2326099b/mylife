/**
 * Verrou du défilement de la page, partagé par toutes les couches (feuilles, palette, espaces) :
 * un compteur, pas une sauvegarde / restauration. Deux couches qui se chevauchent (l'une se ferme
 * pendant que l'autre s'ouvre) ne peuvent plus laisser la page bloquée.
 */
let locks = 0;

export function lockScroll(): () => void {
  locks++;
  document.body.style.overflow = 'hidden';
  let released = false;
  return () => {
    if (released) return;
    released = true;
    locks = Math.max(0, locks - 1);
    if (locks === 0) document.body.style.overflow = '';
  };
}
