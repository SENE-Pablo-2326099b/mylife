import { m, useMotionValueEvent, useScroll } from 'framer-motion';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { kitApp } from './app';
import { useDockHidden } from './dockStore';
import { Icon, type IconName } from './icons';
import { haptic, springs } from './motion';
import { DOCK_HEIGHT, DOCK_MARGIN, SIDEBAR_WIDTH, useBreakpoint } from './responsive';

export interface TabDef {
  to: string;
  label: string;
  icon: IconName;
  active: IconName;
  /** Préfixes d'URL qui allument l'onglet. */
  match: string[];
  badge?: number;
  /** false : seulement dans la barre latérale (grand écran) ; sur téléphone, on y va par la palette ou les Espaces. */
  inDock?: boolean;
}

/** Le pictogramme de l'app dans la barre latérale. */
const BRAND_ICON: Record<string, IconName> = { finances: 'diamond-fill', perf: 'barbell', raveloc: 'navigate', home: 'sparkles' };

function activeIndex(tabs: TabDef[], pathname: string): number {
  let best = -1;
  let bestLen = -1;
  tabs.forEach((t, i) => {
    for (const m of t.match) {
      const hit = m === '/' ? pathname === '/' : pathname === m || pathname.startsWith(`${m}/`);
      if (hit && m.length > bestLen) {
        best = i;
        bestLen = m.length;
      }
    }
  });
  return best;
}

function CountBadge({ n }: { n?: number }) {
  if (!n) return null;
  return (
    <span className="absolute -right-2.5 -top-1.5 min-w-[17px] rounded-pill px-1 text-center font-display text-[10px] font-semibold leading-[17px]" style={{ background: 'var(--danger)', color: 'var(--bg)' }}>
      {n > 9 ? '9+' : n}
      <span className="sr-only"> à voir</span>
    </span>
  );
}

/** Le dock se range quand on descend dans un écran et revient dès qu'on remonte. */
function useScrollTucked(): boolean {
  // La position vient de la valeur de défilement partagée de framer (lue une fois par image pour tout
  // l'écran) : pas de lecture de scrollY ici, qui forcerait une mise en page après chaque écriture.
  const { scrollY } = useScroll();
  const { pathname } = useLocation();
  const [tucked, setTucked] = useState(false);
  const last = useRef(0);
  // Changement d'écran : le dock reste visible, et le saut de défilement (position retrouvée d'un
  // onglet, retour en haut) ne compte pas comme un geste vers le bas.
  const settle = useRef(0);
  const [seen, setSeen] = useState(pathname);
  if (seen !== pathname) {
    setSeen(pathname);
    setTucked(false);
  }
  useEffect(() => {
    settle.current = performance.now() + 400;
  }, [pathname]);
  useMotionValueEvent(scrollY, 'change', (y) => {
    if (performance.now() < settle.current) {
      last.current = y;
      return;
    }
    const dy = y - last.current;
    if (Math.abs(dy) < 8) return;
    last.current = y;
    const next = dy > 0 && y > 120;
    setTucked((t) => (t === next ? t : next));
  });
  return tucked;
}

/**
 * Téléphones et tablettes : un dock de verre flottant. L'onglet actif s'étire en capsule lumineuse
 * (icône + nom), les autres restent des icônes ; au centre, l'orbe ouvre la palette de commande
 * (appui long : l'assistant). Le dock se range au défilement et revient en remontant.
 */
export function Dock({ tabs, onOrb, onOrbHold }: { tabs: TabDef[]; onOrb: () => void; onOrbHold?: () => void }) {
  const { pathname } = useLocation();
  const hidden = useDockHidden();
  const tucked = useScrollTucked();
  const index = activeIndex(tabs, pathname);
  const half = Math.ceil(tabs.length / 2);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);

  const tab = (t: TabDef, i: number) => {
    const focused = i === index;
    return (
      <Link
        key={t.to}
        to={t.to}
        tabIndex={hidden ? -1 : undefined}
        aria-current={focused ? 'page' : undefined}
        aria-label={t.label}
        onClick={(e) => {
          haptic('tap');
          // Onglet déjà ouvert : on remonte en haut au lieu de recharger.
          if (focused && pathname === t.to) {
            e.preventDefault();
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }
        }}
        className="relative flex h-12 items-center justify-center"
      >
        <m.span layout transition={springs.liquid} className={`relative flex h-12 items-center gap-2 ${focused ? 'px-4' : 'px-3.5'}`}>
          {focused && <m.span layoutId="dock-pill" className="dock-pill absolute inset-0 rounded-pill" transition={springs.liquid} />}
          <span className="relative">
            <Icon name={focused ? t.active : t.icon} size={22} className={focused ? 'text-accent' : 'text-secondary'} />
            <CountBadge n={t.badge} />
          </span>
          {focused && (
            <m.span
              layout="position"
              className="relative whitespace-nowrap text-[13px] font-semibold text-ink"
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ ...springs.soft, delay: 0.05 }}
            >
              {t.label}
            </m.span>
          )}
        </m.span>
      </Link>
    );
  };

  return (
    <m.nav
      aria-label="Navigation principale"
      className="pointer-events-none fixed inset-x-0 z-40 flex justify-center"
      style={{ bottom: `max(var(--safe-bottom), ${DOCK_MARGIN}px)`, paddingLeft: DOCK_MARGIN, paddingRight: DOCK_MARGIN }}
      initial={false}
      animate={{ y: hidden ? 130 : tucked ? 96 : 0, opacity: hidden ? 0 : 1, scale: tucked ? 0.92 : 1 }}
      transition={springs.soft}
      aria-hidden={hidden}
    >
      <m.div layout transition={springs.liquid} className="glass glass-float dock-shell pointer-events-auto flex items-center gap-0.5 rounded-pill p-1.5" style={{ height: DOCK_HEIGHT }}>
        {tabs.slice(0, half).map((t, i) => tab(t, i))}
        <button
          type="button"
          aria-label={onOrbHold ? 'Chercher, aller, agir (appui long : assistant)' : 'Chercher, aller, agir'}
          tabIndex={hidden ? -1 : undefined}
          className="orb relative mx-1 flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full"
          onPointerDown={() => {
            held.current = false;
            hold.current = setTimeout(() => {
              held.current = true;
              haptic('success');
              onOrbHold?.();
            }, 480);
          }}
          onPointerUp={() => hold.current && clearTimeout(hold.current)}
          onPointerLeave={() => hold.current && clearTimeout(hold.current)}
          onClick={() => {
            if (held.current) return;
            haptic('tap');
            onOrb();
          }}
        >
          <span aria-hidden className="orb-ring absolute inset-0 rounded-full" />
          <Icon name="search" size={22} className="relative" />
        </button>
        {tabs.slice(half).map((t, i) => tab(t, i + half))}
      </m.div>
    </m.nav>
  );
}

/** Grand écran : une haute vitre à gauche — la marque, les sections, et ce qui se passe en ce moment. */
export function Sidebar({ tabs, footer, onSearch }: { tabs: TabDef[]; footer?: ReactNode; onSearch: () => void }) {
  const { pathname } = useLocation();
  const index = activeIndex(tabs, pathname);
  const ROW = 48;
  return (
    <nav aria-label="Navigation principale" className="fixed bottom-4 left-4 top-4 z-40" style={{ width: SIDEBAR_WIDTH }}>
      <div className="glass glass-float flex h-full flex-col rounded-xl p-3">
        <div className="flex items-center gap-2.5 px-2 pb-6 pt-2">
          <span className="liquid flex h-[34px] w-[34px] items-center justify-center rounded-[11px]">
            <Icon name={BRAND_ICON[kitApp().id] ?? 'sparkles'} size={18} />
          </span>
          <span>
            <span className="t-title block text-[18px]">{kitApp().name}</span>
            <span className="t-caption block text-muted">{kitApp().tagline}</span>
          </span>
        </div>
        <button type="button" onClick={onSearch} className="hl etched mb-4 flex h-11 items-center gap-2.5 rounded-md px-3 text-left">
          <Icon name="search" size={18} className="text-accent" />
          <span className="t-body flex-1 text-muted">Chercher, agir…</span>
          <kbd className="t-caption rounded-xs border border-line px-1.5 text-muted">Ctrl K</kbd>
        </button>
        <div className="relative">
          {index >= 0 && <m.span aria-hidden className="bead absolute inset-x-0 rounded-md" style={{ height: ROW }} initial={false} animate={{ y: index * ROW }} transition={springs.liquid} />}
          {tabs.map((tab, i) => {
            const focused = i === index;
            return (
              <Link key={tab.to} to={tab.to} aria-current={focused ? 'page' : undefined} className="hl relative flex items-center gap-3 rounded-md px-3" style={{ height: ROW }}>
                <span className="relative">
                  <Icon name={focused ? tab.active : tab.icon} size={20} className={focused ? 'text-accent' : 'text-secondary'} />
                  <CountBadge n={tab.badge} />
                </span>
                <span className={`t-body-strong flex-1 ${focused ? 'text-ink' : 'text-secondary'}`}>{tab.label}</span>
              </Link>
            );
          })}
        </div>
        <div className="flex-1" />
        {footer}
      </div>
    </nav>
  );
}

/** Navigation adaptative : capsule en bas sur téléphone et tablette, barre latérale sur grand écran. */
export function Navigation({ tabs, sidebarFooter, onSearch, onAssistant }: { tabs: TabDef[]; sidebarFooter?: ReactNode; onSearch: () => void; onAssistant?: () => void }) {
  const bp = useBreakpoint();
  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--nav-left', bp === 'expanded' ? `${SIDEBAR_WIDTH + 32}px` : '0px');
  }, [bp]);
  // Le dock garde les sections du quotidien ; les réglages passent par la palette et les espaces MyLife.
  return bp === 'expanded' ? <Sidebar tabs={tabs} footer={sidebarFooter} onSearch={onSearch} /> : <Dock tabs={tabs.filter((t) => t.inDock !== false)} onOrb={onSearch} onOrbHold={onAssistant} />;
}
