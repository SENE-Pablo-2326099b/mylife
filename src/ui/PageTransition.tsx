import { AnimatePresence, motion, type Variants } from 'framer-motion';
import { useRef, type ReactNode } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { springs } from './motion';

/**
 * Transitions spatiales entre écrans. Les sections principales sont côte à côte : on glisse vers la
 * gauche ou la droite selon leur ordre. Un écran ouvert depuis une section vient par-dessus, de la
 * droite, pendant que l'ancien recule ; le retour fait l'inverse. Le défilement revient en haut une
 * fois l'ancien écran parti.
 */

const ROOTS = ['/', '/budget', '/operations', '/patrimoine', '/reglages'];

type Move = { kind: 'tab'; dir: number } | { kind: 'push' } | { kind: 'pop' };

const variants: Variants = {
  enter: (m: Move) => (m.kind === 'tab' ? { x: m.dir * 36, opacity: 0 } : m.kind === 'push' ? { x: 56, opacity: 0 } : { scale: 0.96, opacity: 0 }),
  center: { x: 0, scale: 1, opacity: 1, transition: springs.soft },
  exit: (m: Move) => ({
    ...(m.kind === 'tab' ? { x: m.dir * -36 } : m.kind === 'push' ? { scale: 0.96 } : { x: 56 }),
    opacity: 0,
    transition: { duration: 0.14, ease: [0.4, 0, 1, 1] },
  }),
};

export function PageTransition({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const nav = useNavigationType();
  const prev = useRef(pathname);
  const move = useRef<Move>({ kind: 'push' });
  if (prev.current !== pathname) {
    const a = ROOTS.indexOf(prev.current);
    const b = ROOTS.indexOf(pathname);
    move.current = a >= 0 && b >= 0 ? { kind: 'tab', dir: Math.sign(b - a) || 1 } : nav === 'POP' ? { kind: 'pop' } : { kind: 'push' };
    prev.current = pathname;
  }
  return (
    <AnimatePresence mode="wait" initial={false} custom={move.current} onExitComplete={() => window.scrollTo(0, 0)}>
      <motion.div key={pathname} custom={move.current} variants={variants} initial="enter" animate="center" exit="exit" style={{ transformOrigin: '50% 30%' }}>
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
