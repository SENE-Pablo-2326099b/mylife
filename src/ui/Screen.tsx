import { motion, useMotionValueEvent, useScroll, useTransform } from 'framer-motion';
import { useEffect, useState, type ReactNode } from 'react';
import { setMood, type Mood } from './mood';
import { useGoBack } from './useGoBack';
import { setDockHidden } from './dockStore';
import { springs } from './motion';
import { Button, EmptyState, IconButton } from './primitives';
import { useBreakpoint } from './responsive';
import { APP_NAME } from '../lib/app';

const ANDROID = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);

/**
 * Apparition échelonnée des blocs d'un écran : chacun monte et se pose sur un ressort.
 * Désactivée sur Android (composer des blocs de verre en fondu ralentissait l'ouverture des écrans)
 * et quand « réduire les animations » est actif (MotionConfig).
 */
export function Reveal({ index = 0, children, className = '' }: { index?: number; children: ReactNode; className?: string }) {
  if (ANDROID) return <div className={className}>{children}</div>;
  return (
    <motion.div className={className} initial={{ opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }} transition={{ ...springs.soft, delay: Math.min(index, 10) * 0.06 }}>
      {children}
    </motion.div>
  );
}

const COLUMN = { compact: 'max-w-content px-4', medium: 'max-w-content-md px-6', expanded: 'max-w-content-lg px-8' } as const;

/**
 * Coque d'écran. Les écrans à onglets s'ouvrent sur un grand titre (sur-titre or + titre) qui se
 * condense en barre de verre flottante au défilement ; les écrans poussés portent cette barre dès le
 * départ, avec un bouton retour. Le champ de lumière suit le défilement (parallaxe) et change
 * d'ambiance par section (`mood`). `footer` : l'action principale, fixée en bas sous le pouce.
 */
export function Screen({
  title,
  kicker,
  right,
  children,
  mood,
  stack = false,
  back = '/',
  footer,
  titleHidden = false,
}: {
  title: string;
  /** Sur-titre en petites capitales or (« BUDGET », « DÉPENSES »). */
  kicker?: string;
  right?: ReactNode;
  children: ReactNode;
  mood: Mood;
  /** Écran poussé : barre de verre et bouton retour dès le départ. */
  stack?: boolean;
  /** Où revenir sans historique. */
  back?: string;
  footer?: ReactNode;
  /** Pas de grand titre (l'écran porte son propre en-tête). */
  titleHidden?: boolean;
}) {
  const bp = useBreakpoint();
  const goBack = useGoBack(back);
  const { scrollY } = useScroll();
  const barOpacity = useTransform(scrollY, [24, 64], [stack ? 1 : 0, 1]);
  const barTitleOpacity = useTransform(scrollY, [40, 80], [stack ? 1 : 0, 1]);
  const barTitleY = useTransform(scrollY, [40, 80], [stack ? 0 : 8, 0]);
  const titleOpacity = useTransform(scrollY, [0, 60], [1, 0]);
  const titleY = useTransform(scrollY, [-100, 0, 100], [30, 0, -24]);
  const [barShown, setBarShown] = useState(stack);
  useMotionValueEvent(scrollY, 'change', (y) => setBarShown(stack || y > 24));

  useEffect(() => {
    setMood(mood);
  }, [mood]);
  useEffect(() => {
    document.title = `${title} · ${APP_NAME}`;
  }, [title]);
  useEffect(() => {
    if (!stack) return;
    setDockHidden(true);
    return () => setDockHidden(false);
  }, [stack]);

  const column = `mx-auto w-full ${COLUMN[bp]}`;
  const docked = !stack && bp !== 'expanded';
  const bottomPad = (footer ? 84 : 0) + (docked ? 112 : 32);

  return (
    <div className="min-h-[100dvh]" style={{ paddingLeft: 'var(--nav-left, 0px)', paddingTop: `calc(var(--safe-top) + ${stack ? 68 : 16}px)`, paddingBottom: `calc(var(--safe-bottom) + ${bottomPad}px)` }}>
      <main id="contenu" className={column} tabIndex={-1}>
        {!stack && !titleHidden && (
          <motion.header className="mb-4 flex items-end gap-2" style={{ opacity: titleOpacity, y: titleY }}>
            <div className="min-w-0 flex-1">
              {kicker && <p className="t-label mb-1 text-gold">{kicker}</p>}
              <h1 className={`${bp === 'expanded' ? 't-hero' : 't-large'} truncate first-letter:uppercase`}>{title}</h1>
            </div>
            {right && <div className="flex shrink-0 items-center gap-1">{right}</div>}
          </motion.header>
        )}
        {stack && <h1 className="sr-only">{title}</h1>}
        {stack && kicker && <p className="t-label mb-3 px-0.5 text-gold">{kicker}</p>}
        {children}
      </main>

      {/* Barre condensée : ne prend les touchers qu'une fois visible. */}
      <motion.div className="fixed inset-x-0 top-0 z-30" style={{ opacity: barOpacity, left: 'var(--nav-left, 0px)', pointerEvents: barShown ? 'auto' : 'none' }}>
        <div className="glass glass-float rounded-none border-x-0 border-t-0" style={{ paddingTop: 'var(--safe-top)' }}>
          <div className={`${column} flex h-14 items-center gap-1`}>
            {stack && <IconButton icon="chevron-back" label="Retour" tone="ink" onClick={goBack} className="-ml-2" />}
            <motion.p className="t-headline min-w-0 flex-1 truncate first-letter:uppercase" style={{ opacity: barTitleOpacity, y: barTitleY }} aria-hidden={!stack}>
              {title}
            </motion.p>
            {right && <div className="flex shrink-0 items-center gap-1">{right}</div>}
          </div>
        </div>
      </motion.div>
      <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-20" style={{ height: 'var(--safe-top)', background: 'var(--status-veil)' }} />

      {footer && (
        <div className="pointer-events-none fixed inset-x-0 z-30" style={{ left: 'var(--nav-left, 0px)', bottom: `calc(var(--safe-bottom) + ${docked ? 96 : 12}px)` }}>
          <div className={`${column} pointer-events-auto`}>{footer}</div>
        </div>
      )}
    </div>
  );
}

/** Écran poussé dont l'élément n'existe plus (supprimé, lien périmé) : le dit et propose le retour. */
export function NotFoundScreen({ title, body, back = '/' }: { title: string; body?: string; back?: string }) {
  const goBack = useGoBack(back);
  return (
    <Screen stack title="" mood="focus" back={back}>
      <EmptyState
        icon="alert-circle"
        title={title}
        body={body ?? 'Il a peut-être été supprimé.'}
        action={
          <Button variant="secondary" icon="chevron-back" onClick={goBack}>
            Retour
          </Button>
        }
      />
    </Screen>
  );
}
