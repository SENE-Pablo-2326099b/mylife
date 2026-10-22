/**
 * Lumière au contact du verre : sous le pointeur (souris) ou au toucher (doigt), la plaque de verre
 * visée reçoit la position du contact (--mx / --my) et s'éclaire (--gl → 1), puis s'éteint en fondu
 * (transition de --gl dans index.css). Un seul écouteur pour toute l'app ; seule la plaque visée est
 * modifiée, rien n'est redessiné ailleurs.
 */
let lit: HTMLElement | null = null;

/**
 * La plaque éclairée : une carte, jamais une grande surface (feuille, palette, dock, barre) — leur
 * lumière animée repeindrait tout leur contenu à chaque image, à chaque toucher.
 */
function plateAt(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const plate = target.closest('.glass') as HTMLElement | null;
  if (!plate || plate.classList.contains('glass-lens') || plate.classList.contains('glass-float') || plate.closest('[role="dialog"]')) return null;
  return plate;
}

function light(el: HTMLElement | null, x: number, y: number) {
  if (lit && lit !== el) lit.style.setProperty('--gl', '0');
  lit = el;
  if (!el) return;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--mx', `${Math.round(x - r.left)}px`);
  el.style.setProperty('--my', `${Math.round(y - r.top)}px`);
  el.style.setProperty('--gl', '1');
}

function dim() {
  lit?.style.setProperty('--gl', '0');
  lit = null;
}

export function installGlassLight(): void {
  if (typeof window === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  document.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType !== 'mouse') return;
      light(plateAt(e.target), e.clientX, e.clientY);
    },
    { passive: true },
  );
  document.addEventListener(
    'pointerdown',
    (e) => {
      const el = plateAt(e.target);
      light(el, e.clientX, e.clientY);
      // Onde de lumière qui part du point de contact (relancée à chaque appui).
      if (el) {
        el.classList.remove('rippling');
        void el.offsetWidth;
        el.classList.add('rippling');
        el.addEventListener('animationend', () => el.classList.remove('rippling'), { once: true });
      }
    },
    { passive: true },
  );
  const release = (e: PointerEvent) => e.pointerType !== 'mouse' && dim();
  document.addEventListener('pointerup', release, { passive: true });
  document.addEventListener('pointercancel', release, { passive: true });
  document.addEventListener('pointerleave', dim, { passive: true });
  // Défilement au doigt : le contact n'est plus un appui, la lumière s'éteint.
  window.addEventListener('scroll', () => lit && dim(), { passive: true });
}
