import { useRef, type PointerEvent as ReactPointerEvent, type SyntheticEvent } from 'react';

/**
 * Faire glisser une rangée défilante à la souris : le doigt et le pavé tactile le font déjà, la souris n'a pas de
 * prise sur une rangée sans barre de défilement. Une rangée aimantée se recale ensuite sur la carte la plus proche,
 * ou la suivante dans le sens du geste ; le clic qui termine un glissement ne sélectionne rien.
 */
export function useMouseSwipe() {
  const drag = useRef<{ id: number; x: number; left: number; moved: boolean; snaps: boolean } | null>(null);
  const swallow = useRef(false);
  const end = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (!d.moved) return;
    const el = e.currentTarget;
    delete el.dataset.dragging;
    swallow.current = true;
    setTimeout(() => (swallow.current = false), 0);
    if (!d.snaps) {
      el.style.scrollSnapType = '';
      return;
    }
    const cards = [...el.children] as HTMLElement[];
    const max = el.scrollWidth - el.clientWidth;
    const stops = cards.map((c) => Math.min(max, c.offsetLeft - cards[0]!.offsetLeft));
    const nearest = (left: number) => stops.reduce((best, s, k) => (Math.abs(s - left) < Math.abs(stops[best]! - left) ? k : best), 0);
    let k = nearest(el.scrollLeft);
    const dx = d.left - el.scrollLeft;
    if (k === nearest(d.left) && Math.abs(dx) > 30) k = Math.max(0, Math.min(stops.length - 1, k + (dx < 0 ? 1 : -1)));
    el.scrollTo({ left: stops[k] ?? 0, behavior: 'smooth' });
    setTimeout(() => (el.style.scrollSnapType = ''), 450);
  };
  return {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      const el = e.currentTarget;
      el.style.scrollSnapType = '';
      drag.current = { id: e.pointerId, x: e.clientX, left: el.scrollLeft, moved: false, snaps: getComputedStyle(el).scrollSnapType !== 'none' };
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      const el = e.currentTarget;
      const dx = e.clientX - d.x;
      if (!d.moved) {
        if (Math.abs(dx) < 6) return;
        d.moved = true;
        el.setPointerCapture(e.pointerId);
        el.style.scrollSnapType = 'none';
        el.dataset.dragging = 'true';
      }
      el.scrollLeft = d.left - dx;
    },
    onPointerUp: end,
    onPointerCancel: end,
    onClickCapture: (e: SyntheticEvent) => {
      if (!swallow.current) return;
      swallow.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
    onDragStart: (e: SyntheticEvent) => e.preventDefault(),
  };
}
