// GÉNÉRÉ depuis MyLife/packages/ui — ne pas modifier ici (MyLife : npm run vendor).
import { animate, m, useMotionValue, useTransform } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons';
import { haptic, springs } from './motion';

/**
 * Tirer pour actualiser : en haut d'un écran, on tire vers le bas ; une goutte de verre descend,
 * s'étire avec la traction et sa flèche tourne. Passé le seuil (vibration), on relâche : elle tourne
 * pendant l'actualisation puis remonte. Le contenu suit le doigt, freiné.
 */
const THRESHOLD = 76;
const MAX = 130;

export function PullToRefresh({ onRefresh }: { onRefresh: () => Promise<unknown> }) {
  const pull = useMotionValue(0);
  const [busy, setBusy] = useState(false);
  const armed = useRef(false);
  const start = useRef<number | null>(null);
  const y = useTransform(pull, [0, MAX], [-56, 46]);
  const stretch = useTransform(pull, [0, THRESHOLD, MAX], [0.6, 1, 1.25]);
  const rotate = useTransform(pull, [0, MAX], [0, 300]);
  const opacity = useTransform(pull, [0, 24], [0, 1]);

  useEffect(() => {
    const main = document.getElementById('contenu');
    const shift = pull.on('change', (v) => main && (main.style.transform = v > 0 ? `translateY(${v * 0.45}px)` : ''));
    const down = (e: TouchEvent) => {
      if (busy || window.scrollY > 0 || e.touches.length !== 1) return;
      start.current = e.touches[0]!.clientY;
      armed.current = false;
    };
    const move = (e: TouchEvent) => {
      if (start.current === null) return;
      const dy = e.touches[0]!.clientY - start.current;
      if (dy <= 0 || window.scrollY > 0) {
        pull.set(0);
        return;
      }
      const v = Math.min(MAX, dy * 0.55);
      pull.set(v);
      if (v >= THRESHOLD && !armed.current) {
        armed.current = true;
        haptic('tap');
      } else if (v < THRESHOLD) armed.current = false;
    };
    const up = () => {
      if (start.current === null) return;
      start.current = null;
      if (pull.get() >= THRESHOLD) {
        setBusy(true);
        animate(pull, THRESHOLD, springs.snappy);
        void onRefresh().finally(() => {
          setBusy(false);
          animate(pull, 0, springs.soft);
        });
      } else animate(pull, 0, springs.soft);
    };
    window.addEventListener('touchstart', down, { passive: true });
    window.addEventListener('touchmove', move, { passive: true });
    window.addEventListener('touchend', up, { passive: true });
    window.addEventListener('touchcancel', up, { passive: true });
    return () => {
      shift();
      if (main) main.style.transform = '';
      window.removeEventListener('touchstart', down);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', up);
      window.removeEventListener('touchcancel', up);
    };
  }, [busy, onRefresh, pull]);

  return (
    <m.div aria-hidden className="pointer-events-none fixed inset-x-0 z-30 flex justify-center" style={{ top: 'var(--safe-top)', y, opacity }}>
      <m.span className="glass glass-float flex h-11 w-11 items-center justify-center rounded-full text-accent" style={{ scaleY: stretch }}>
        <m.span style={{ rotate }} className={busy ? 'spin' : ''}>
          <Icon name="sync" size={20} />
        </m.span>
      </m.span>
    </m.div>
  );
}
