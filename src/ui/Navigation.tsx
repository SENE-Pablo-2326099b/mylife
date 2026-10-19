import { animate, motion, useMotionValue } from 'framer-motion';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { APP_NAME, APP_TAGLINE } from '../lib/app';
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
}

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

/**
 * L'indicateur liquide : deux bords sur des ressorts différents — le bord avant file, le bord
 * arrière rattrape — si bien que la perle s'étire comme une goutte qui glisse sur le verre.
 */
function useLiquidEdges(index: number, slot: number, pad: number) {
  const left = useMotionValue(index * slot + pad);
  const right = useMotionValue((index + 1) * slot - pad);
  const prev = useRef(index);
  const first = useRef(true);
  useEffect(() => {
    if (slot <= 0 || index < 0) return;
    if (first.current) {
      first.current = false;
      left.set(index * slot + pad);
      right.set((index + 1) * slot - pad);
      prev.current = index;
      return;
    }
    const toRight = index >= prev.current;
    const lead = { ...springs.liquid, stiffness: 420, damping: 24 };
    const trail = { ...springs.soft, stiffness: 150 };
    const a = animate(left, index * slot + pad, toRight ? trail : lead);
    const b = animate(right, (index + 1) * slot - pad, toRight ? lead : trail);
    prev.current = index;
    return () => {
      a.stop();
      b.stop();
    };
  }, [index, slot, pad, left, right]);
  return { left, right };
}

/** Téléphones et tablettes : une capsule de verre flottante en bas ; l'onglet actif s'allume. */
export function Dock({ tabs }: { tabs: TabDef[] }) {
  const { pathname } = useLocation();
  const hidden = useDockHidden();
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const index = activeIndex(tabs, pathname);
  const slot = width / tabs.length;
  const tight = width > 0 && slot < 62;
  const { left, right } = useLiquidEdges(index, slot, tight ? 3 : 6);
  const beadWidth = useMotionValue(0);
  useEffect(() => {
    const update = () => beadWidth.set(Math.max(0, right.get() - left.get()));
    update();
    const u1 = left.on('change', update);
    const u2 = right.on('change', update);
    return () => {
      u1();
      u2();
    };
  }, [left, right, beadWidth]);

  return (
    <motion.nav
      aria-label="Navigation principale"
      className="fixed inset-x-0 z-40 flex justify-center"
      style={{ bottom: `max(var(--safe-bottom), ${DOCK_MARGIN}px)`, paddingLeft: DOCK_MARGIN, paddingRight: DOCK_MARGIN }}
      initial={false}
      animate={{ y: hidden ? 120 : 0, opacity: hidden ? 0 : 1 }}
      transition={springs.soft}
      aria-hidden={hidden}
    >
      <div className="glass glass-float w-full max-w-[560px] overflow-hidden rounded-[30px]">
        <div ref={ref} className="relative flex" style={{ height: DOCK_HEIGHT }}>
          {width > 0 && index >= 0 && <motion.span aria-hidden className="bead absolute bottom-[7px] top-[7px] rounded-lg" style={{ left, width: beadWidth }} />}
          {tabs.map((tab, i) => {
            const focused = i === index;
            return (
              <Link
                key={tab.to}
                to={tab.to}
                tabIndex={hidden ? -1 : undefined}
                aria-current={focused ? 'page' : undefined}
                onClick={() => haptic('tap')}
                className="relative flex flex-1 flex-col items-center justify-center gap-[3px]"
              >
                <span className="relative">
                  <Icon name={focused ? tab.active : tab.icon} size={22} className={focused ? 'text-accent' : 'text-muted'} />
                  <CountBadge n={tab.badge} />
                </span>
                <span className={`max-w-full truncate px-0.5 font-semibold ${focused ? 'text-ink' : 'text-muted'}`} style={{ fontSize: `min(${tight ? 9 : 10.5}px * 1.15, ${tight ? 0.5625 : 0.65625}rem)` }}>
                  {tab.label}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </motion.nav>
  );
}

/** Grand écran : une haute vitre à gauche — la marque, les sections, et ce qui se passe en ce moment. */
export function Sidebar({ tabs, footer }: { tabs: TabDef[]; footer?: ReactNode }) {
  const { pathname } = useLocation();
  const index = activeIndex(tabs, pathname);
  const ROW = 48;
  return (
    <nav aria-label="Navigation principale" className="fixed bottom-4 left-4 top-4 z-40" style={{ width: SIDEBAR_WIDTH }}>
      <div className="glass glass-float flex h-full flex-col rounded-xl p-3">
        <div className="flex items-center gap-2.5 px-2 pb-6 pt-2">
          <span className="liquid flex h-[34px] w-[34px] items-center justify-center rounded-[11px]">
            <Icon name="diamond-fill" size={18} />
          </span>
          <span>
            <span className="t-title block text-[18px]">{APP_NAME}</span>
            <span className="t-caption block text-muted">{APP_TAGLINE}</span>
          </span>
        </div>
        <div className="relative">
          {index >= 0 && <motion.span aria-hidden className="bead absolute inset-x-0 rounded-md" style={{ height: ROW }} initial={false} animate={{ y: index * ROW }} transition={springs.liquid} />}
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
export function Navigation({ tabs, sidebarFooter }: { tabs: TabDef[]; sidebarFooter?: ReactNode }) {
  const bp = useBreakpoint();
  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--nav-left', bp === 'expanded' ? `${SIDEBAR_WIDTH + 32}px` : '0px');
  }, [bp]);
  return bp === 'expanded' ? <Sidebar tabs={tabs} footer={sidebarFooter} /> : <Dock tabs={tabs} />;
}
