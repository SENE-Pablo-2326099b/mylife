import type { ReactNode } from 'react';
import { NavLink, Link } from 'react-router-dom';
import { IconBell, IconCycle, IconList, IconSettings, IconSync, IconToday } from './icons';

const tabs = [
  { to: '/', label: 'Aujourd’hui', icon: IconToday, end: true },
  { to: '/cycle', label: 'Cycle', icon: IconCycle },
  { to: '/transactions', label: 'Opérations', icon: IconList },
  { to: '/alertes', label: 'Alertes', icon: IconBell },
  { to: '/reglages', label: 'Réglages', icon: IconSettings },
];

export function Layout({ children, alertCount = 0, syncing = false, syncBadge }: { children: ReactNode; alertCount?: number; syncing?: boolean; syncBadge?: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-xl flex-col">
      <a href="#contenu" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-accent focus:px-3 focus:py-2 focus:text-black">
        Aller au contenu
      </a>
      <header className="pt-safe sticky top-0 z-20 border-b border-line/50 bg-bg/90 backdrop-blur">
        <div className="flex h-14 items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2 font-bold tracking-tight">
            <img src="/favicon.svg" alt="" width={26} height={26} />
            Budget Dodge
          </Link>
          <Link
            to="/synchro"
            className="relative inline-flex h-11 items-center gap-2 rounded-xl px-3 text-sm text-muted hover:bg-raised hover:text-ink"
            aria-label="Synchronisation bancaire"
          >
            <IconSync size={20} className={syncing ? 'animate-spin' : ''} />
            {syncBadge}
          </Link>
        </div>
      </header>
      <main id="contenu" className="flex-1 px-4 pb-28 pt-4">
        {children}
      </main>
      <nav aria-label="Navigation principale" className="pb-safe fixed inset-x-0 bottom-0 z-20 border-t border-line/60 bg-bg/95 backdrop-blur">
        <ul className="mx-auto grid max-w-xl grid-cols-5">
          {tabs.map(({ to, label, icon: Icon, end }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  `relative flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] ${isActive ? 'text-accent' : 'text-muted hover:text-ink'}`
                }
              >
                <Icon size={22} />
                <span>{label}</span>
                {to === '/alertes' && alertCount > 0 && (
                  <span className="absolute right-[22%] top-1.5 min-w-[18px] rounded-full bg-bad px-1 text-center text-[10px] font-bold leading-[18px] text-black">
                    {alertCount}
                    <span className="sr-only"> alertes</span>
                  </span>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
