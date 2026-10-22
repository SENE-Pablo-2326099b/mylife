// GÉNÉRÉ depuis MyLife/packages/ui — ne pas modifier ici (MyLife : npm run vendor).
import { m, useMotionValueEvent, useScroll } from 'framer-motion';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Routes, Route, useLocation, useNavigationType, type Location } from 'react-router-dom';
import { TabActive } from './tabActive';

/**
 * Navigation sans rechargement, comme une app native.
 *
 * - Les onglets restent montés une fois visités : en changer ne fait qu'afficher l'écran déjà prêt
 *   (aucune relecture des données, aucun écran vide), à la position de défilement où on l'avait
 *   laissé. Chacun garde sa propre adresse (ses filtres) même quand un autre est affiché.
 * - Les écrans ouverts depuis un onglet montent en fondu (comme dans MyPerf), sans attendre la sortie
 *   de l'écran précédent ; le retour se pose en reculant.
 */

/** Les onglets de l'app, dans l'ordre du dock : chemin → écran. */
export function KeptTabs<TabPath extends string>({ pages }: { pages: Record<TabPath, ReactNode> }) {
  // Ordre des onglets (sens de la glissade) : lu dans l'effet sans le relancer.
  const order = useRef<TabPath[]>([]);
  order.current = Object.keys(pages) as TabPath[];
  const location = useLocation();
  const active = (order.current as string[]).includes(location.pathname) ? (location.pathname as TabPath) : null;
  // Dernière adresse de chaque onglet visité (ses paramètres de filtre restent les siens).
  const [kept, setKept] = useState<Partial<Record<TabPath, Location>>>(() => (active ? ({ [active]: location } as Partial<Record<TabPath, Location>>) : {}));
  if (active && kept[active] !== location) setKept((k) => ({ ...k, [active]: location }));

  // Position de défilement de chaque onglet : retenue en continu, rendue au retour.
  const scrolls = useRef<Partial<Record<TabPath, number>>>({});
  const current = useRef<TabPath | null>(active);
  const { scrollY } = useScroll();
  useMotionValueEvent(scrollY, 'change', (y) => {
    if (current.current) scrolls.current[current.current] = y;
  });
  const prevActive = useRef<TabPath | null>(active);
  const [dir, setDir] = useState(0);
  useLayoutEffect(() => {
    current.current = active;
    if (active) window.scrollTo(0, scrolls.current[active] ?? 0);
    const a = prevActive.current ? order.current.indexOf(prevActive.current) : -1;
    const b = active ? order.current.indexOf(active) : -1;
    setDir(a >= 0 && b >= 0 ? Math.sign(b - a) : 0);
    prevActive.current = active;
  }, [active]);

  return (
    <>
      {(Object.keys(kept) as TabPath[]).map((path) => {
        const on = path === active;
        return (
          <div key={path} hidden={!on} className={on && dir !== 0 ? (dir > 0 ? 'tab-in-right' : 'tab-in-left') : undefined}>
            <TabActive.Provider value={on}>
              <Routes location={on ? location : kept[path]}>
                <Route path={path} element={pages[path]} />
              </Routes>
            </TabActive.Provider>
          </div>
        );
      })}
    </>
  );
}

/** Écrans poussés (hors onglets) : entrée par la droite, ou en reculant au retour ; défilement en haut. */
export function PushedScreen({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const nav = useNavigationType();
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return (
    <m.div
      key={pathname}
      // Même mouvement que MyPerf : l'écran poussé monte en fondu ; le retour se pose en reculant.
      initial={nav === 'POP' ? { scale: 0.97, opacity: 0 } : { y: 22, opacity: 0 }}
      animate={{ y: 0, scale: 1, opacity: 1 }}
      transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
      style={{ transformOrigin: '50% 30%' }}
    >
      {children}
    </m.div>
  );
}
