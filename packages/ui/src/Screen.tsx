import { m, useMotionValueEvent, useScroll, useTransform } from 'framer-motion';
import { useEffect, useState, type ReactNode } from 'react';
import { setMood, type Mood } from './mood';
import { useGoBack } from './useGoBack';
import { setDockHidden } from './dockStore';
import { Button, EmptyState, IconButton } from './primitives';
import { useBreakpoint } from './responsive';
import { PullToRefresh } from './PullToRefresh';
import { useTabActive } from './tabActive';
import { kitApp } from './app';


/**
 * Apparition échelonnée des blocs d'un écran : chacun monte et se pose sur un ressort.
 * Désactivée sur Android (composer des blocs de verre en fondu ralentissait l'ouverture des écrans)
 * et quand « réduire les animations » est actif (MotionConfig).
 */
/**
 * Bloc d'écran. L'entrée est orchestrée une seule fois par l'écran entier (Screen) plutôt que bloc par
 * bloc : `index` ne sert plus qu'à garder les appels existants lisibles.
 */
export function Reveal({ index = 0, children, className = '' }: { index?: number; children: ReactNode; className?: string }) {
  // Au-delà des deux premiers blocs (toujours visibles à l'ouverture), le navigateur ne met en page
  // et ne peint un bloc que lorsqu'il approche de l'écran : ouverture d'écran plus rapide, défilement
  // plus léger, et la taille déjà vue est retenue (pas de saut de la barre de défilement).
  return <div className={`${index >= 2 ? 'cv-auto' : ''} ${className}`}>{children}</div>;
}

const COLUMN = { compact: 'max-w-content px-4', medium: 'max-w-content-md px-6', expanded: 'max-w-content-lg px-8' } as const;

/**
 * Coque d'écran. Les écrans à onglets s'ouvrent sur un grand titre (sur-titre or + titre) qui se
 * condense en barre de verre au défilement ; les écrans poussés portent cette barre dès le départ,
 * avec un bouton retour. Le champ de lumière suit le défilement (parallaxe) et change d'ambiance par
 * section (`mood`). `footer` : l'action principale, fixée en bas sous le pouce.
 *
 * Condensation pilotée par une seule progression p (0 → 1 entre 8 et 64 px de défilement) :
 * - grand titre : s'efface (p 0 → 0,45), rétrécit (1 → 0,94) et monte ; élastique en tirant vers le bas ;
 * - barre : flou et teinte montent de p 0,35 à 1, titre déjà effacé (jamais d'opacité animée sur un
 *   élément flouté, jamais de titre flouté en traînée) ;
 *   liseré et ombre se posent à la fin (p 0,85 → 1) ;
 * - titre de la barre : apparaît de p 0,55 à 1 en montant de 6 px ;
 * - actions : celles du grand titre s'effacent avant que celles de la barre n'apparaissent
 *   (jamais deux jeux visibles à la fois) ; seules les visibles reçoivent les touchers.
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
  onRefresh,
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
  /** Tirer vers le bas en haut de l'écran pour actualiser (écrans principaux). */
  onRefresh?: () => Promise<unknown>;
}) {
  const bp = useBreakpoint();
  const goBack = useGoBack(back);
  const { scrollY } = useScroll();
  const p = useTransform(scrollY, [8, 64], stack ? [1, 1] : [0, 1], { clamp: true });
  const titleOpacity = useTransform(p, [0, 0.45], [1, 0]);
  // Le verre ne monte qu'une fois le grand titre presque effacé : jamais de titre flouté en traînée.
  const glass = useTransform(p, [0.35, 1], [0, 1]);
  const titleScale = useTransform(scrollY, [-120, 0, 64], [1.06, 1, 0.94]);
  const titleY = useTransform(scrollY, [-120, 0, 64], [24, 0, -12]);
  const edgeOpacity = useTransform(p, [0.85, 1], [0, 1]);
  const barTitleOpacity = useTransform(p, [0.55, 1], [0, 1]);
  const barTitleY = useTransform(p, [0.55, 1], [6, 0]);
  const headerActions = useTransform(p, [0, 0.4], [1, 0]);
  const barActions = useTransform(p, [0.6, 1], [0, 1]);
  const [condensed, setCondensed] = useState(stack);
  useMotionValueEvent(p, 'change', (v) => {
    const next = stack || v > 0.5;
    setCondensed((c) => (c === next ? c : next));
  });

  // Onglet gardé en arrière-plan : il ne pilote ni l'ambiance ni le titre ; il les reprend en revenant.
  const active = useTabActive();
  useEffect(() => {
    if (active) setMood(mood);
  }, [mood, active]);
  useEffect(() => {
    if (active) document.title = `${title} · ${kitApp().name}`;
  }, [title, active]);
  useEffect(() => {
    if (!stack) return;
    setDockHidden(true);
    return () => setDockHidden(false);
  }, [stack]);

  const column = `mx-auto w-full ${COLUMN[bp]}`;
  const docked = !stack && bp !== 'expanded';
  const bottomPad = (footer ? 84 : 0) + (docked ? 112 : 32);
  // Titre long dans la barre (écrans poussés) : sur deux lignes, plus petit, plutôt que coupé.
  const longTitle = title.length > 22;

  return (
    <div className="min-h-[100dvh]" style={{ paddingLeft: 'var(--nav-left, 0px)', paddingTop: `calc(var(--safe-top) + ${stack ? 68 : 16}px)`, paddingBottom: `calc(var(--safe-bottom) + ${bottomPad}px)` }}>
      <main id={active ? 'contenu' : undefined} className={column} tabIndex={-1}>
        {!stack && !titleHidden && (
          <header className="mb-4">
            {/* Ligne du haut : sur-titre et actions ; le titre a ensuite toute la largeur (pas de mot coupé à 320 px). */}
            {(kicker || right) && (
              <div className="flex min-h-11 items-center gap-2">
                <m.p className="t-label min-w-0 flex-1 text-gold" style={{ opacity: titleOpacity }}>
                  {kicker}
                </m.p>
                {right && (
                  <m.div className="flex shrink-0 items-center gap-1" style={{ opacity: headerActions, pointerEvents: condensed ? 'none' : 'auto' }} aria-hidden={condensed} {...(condensed ? { inert: '' } : {})}>
                    {right}
                  </m.div>
                )}
              </div>
            )}
            <m.h1
              className={`${bp === 'expanded' ? 't-hero' : 't-large'} line-clamp-2 origin-bottom-left text-balance first-letter:uppercase will-change-transform`}
              style={{ opacity: titleOpacity, scale: titleScale, y: titleY }}
            >
              {title}
            </m.h1>
          </header>
        )}
        {stack && <h1 className="sr-only">{title}</h1>}
        {stack && kicker && <p className="t-label mb-3 px-0.5 text-gold">{kicker}</p>}
        {children}
      </main>

      {/* Barre : transparente au repos (les touchers passent au grand titre), verre une fois condensée. */}
      <m.div className="condense-bar fixed inset-x-0 top-0 z-30" style={{ ['--p' as string]: glass, left: 'var(--nav-left, 0px)', pointerEvents: condensed ? 'auto' : 'none' }}>
        <m.div aria-hidden className="condense-edge pointer-events-none absolute inset-0" style={{ opacity: edgeOpacity }} />
        <div className="relative" style={{ paddingTop: 'var(--safe-top)' }}>
          <div className={`${column} flex h-14 items-center gap-1`}>
            {stack && <IconButton icon="chevron-back" label="Retour" tone="ink" onClick={goBack} className="-ml-2" />}
            <m.p
              className={`${longTitle && stack ? 't-body-strong line-clamp-2 leading-tight' : 't-headline truncate'} min-w-0 flex-1 first-letter:uppercase`}
              style={{ opacity: barTitleOpacity, y: barTitleY }}
              aria-hidden={!stack}
            >
              {title}
            </m.p>
            {right && (
              <m.div className="flex shrink-0 items-center gap-1" style={{ opacity: stack ? 1 : barActions }} aria-hidden={!condensed} {...(condensed ? {} : { inert: '' })}>
                {right}
              </m.div>
            )}
          </div>
        </div>
      </m.div>
      <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-20" style={{ height: 'var(--safe-top)', background: 'var(--status-veil)' }} />
      {onRefresh && active && <PullToRefresh onRefresh={onRefresh} />}

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
