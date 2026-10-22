import { AnimatePresence, m } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MYLIFE_APPS, MYLIFE_DESTINATIONS, MYLIFE_HOME } from '../vendor/lumen';
import { kitApp, openMyLifeApp } from './app';
import { Icon, type IconName } from './icons';
import { Layer } from './Layer';
import { haptic, springs } from './motion';
import { setPaletteOpen, usePaletteOpen } from './paletteStore';
import { foldText, rankItems, setPaletteQuery, usePaletteQuery, type PaletteItem } from './palette';
import { lockScroll } from './scrollLock';

/**
 * Palette de commande, la même dans toutes les apps MyLife : une seule porte vers tout. On tape
 * quelques lettres et on y est — un écran, une action, une donnée de l'app, ou un endroit d'une autre
 * app MyLife (« séance » depuis MyFinances ouvre MyPerf). Clavier : flèches, Entrée, Échap ;
 * Ctrl/Cmd + K pour l'ouvrir de partout.
 *
 * L'app fournit ses propres entrées (calculées avec la saisie, lue par `usePaletteQuery`) ; la palette
 * ajoute les autres apps.
 */

const APP_ICON: Record<string, IconName> = { finances: 'diamond', perf: 'barbell', raveloc: 'navigate', home: 'home' };
const appName = (id: string) => (id === 'home' ? MYLIFE_HOME.name : (MYLIFE_APPS.find((a) => a.id === id)?.name ?? id));

/** Les autres apps (sans saisie), ou leurs endroits qui correspondent (avec saisie). */
function otherApps(q: string): PaletteItem[] {
  const here = kitApp().id;
  if (!q) {
    const apps = [MYLIFE_HOME, ...MYLIFE_APPS].filter((a) => a.id !== here);
    return apps.map((a) => ({ id: `app-${a.id}`, group: 'Tes apps MyLife', icon: APP_ICON[a.id], title: a.name, hint: a.tagline, run: () => openMyLifeApp(a.path) }));
  }
  const found = MYLIFE_DESTINATIONS.filter((d) => d.app !== here).map<PaletteItem>((d) => ({
    id: `dest-${d.path}`,
    group: 'Dans tes autres apps',
    icon: APP_ICON[d.app],
    title: d.title,
    hint: appName(d.app),
    keywords: `${d.keywords} ${appName(d.app)}`,
    run: () => openMyLifeApp(d.path),
  }));
  return rankItems(found, q).slice(0, 4);
}

export function CommandPalette({ items, placeholder = 'Chercher, aller, agir…' }: { items: PaletteItem[]; placeholder?: string }) {
  const open = usePaletteOpen();
  const raw = usePaletteQuery();
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const q = foldText(raw.trim());
  const all = [...items, ...otherApps(q)];

  // Ctrl/Cmd + K de partout ; Échap pour fermer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(!open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setPaletteQuery('');
    setActive(0);
    const t = setTimeout(() => input.current?.focus(), 30);
    const unlock = lockScroll();
    return () => {
      clearTimeout(t);
      unlock();
    };
  }, [open]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(all.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const it = all[active];
      if (it) {
        haptic('tap');
        it.run();
      }
    } else if (e.key === 'Escape') {
      setPaletteOpen(false);
    }
  };

  let lastGroup = '';
  return createPortal(
    <AnimatePresence>
      {open && (
        <Layer className="fixed inset-0 z-[70]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
          <button type="button" aria-label="Fermer" className="palette-veil absolute inset-0 cursor-default" onClick={() => setPaletteOpen(false)} />
          <m.div
            role="dialog"
            aria-modal="true"
            aria-label="Rechercher et agir"
            className="glass glass-lens relative mx-auto flex max-h-[min(640px,calc(100dvh-24px))] w-[min(640px,calc(100vw-20px))] flex-col overflow-hidden rounded-xl"
            style={{ marginTop: 'calc(var(--safe-top) + 10px)' }}
            initial={{ y: -16, scale: 0.96 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: -10, scale: 0.98, transition: { duration: 0.15 } }}
            transition={springs.liquid}
          >
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Icon name="search" size={20} className="text-accent" />
              <input
                ref={input}
                value={raw}
                onChange={(e) => setPaletteQuery(e.target.value)}
                onKeyDown={onKey}
                placeholder={placeholder}
                aria-label={placeholder}
                aria-controls="palette-list"
                aria-activedescendant={all[active] ? `pal-${all[active]!.id}` : undefined}
                className="h-[60px] min-w-0 flex-1 bg-transparent text-[18px] font-medium outline-none placeholder:text-muted focus-visible:outline-none"
                enterKeyHint="go"
              />
              <kbd className="t-caption hidden rounded-xs border border-line px-1.5 py-0.5 text-muted sm:inline">Échap</kbd>
            </div>
            <div ref={list} id="palette-list" role="listbox" className="no-scrollbar flex-1 overflow-y-auto p-2">
              {all.length === 0 && <p className="t-small px-3 py-6 text-center text-muted">Rien de trouvé.</p>}
              {all.map((it, i) => {
                const head = it.group !== lastGroup ? it.group : null;
                lastGroup = it.group;
                const on = i === active;
                return (
                  <div key={it.id}>
                    {head && <p className="t-label px-3 pb-1 pt-3 text-muted">{head}</p>}
                    <button
                      type="button"
                      id={`pal-${it.id}`}
                      role="option"
                      aria-selected={on}
                      data-index={i}
                      onMouseMove={() => setActive(i)}
                      onClick={() => {
                        haptic('tap');
                        it.run();
                      }}
                      className="relative flex min-h-[52px] w-full items-center gap-3 rounded-md px-3 text-left"
                    >
                      <span aria-hidden className={`bead absolute inset-0 rounded-md transition-opacity duration-150 ${on ? 'opacity-100' : 'opacity-0'}`} />
                      <span aria-hidden className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-[16px]" style={{ background: on ? 'var(--accent-soft)' : 'var(--surface-alt)' }}>
                        {it.emoji ?? (it.icon && <Icon name={it.icon} size={17} className={on ? 'text-accent' : 'text-secondary'} />)}
                      </span>
                      <span className="relative min-w-0 flex-1">
                        <span className="t-body-strong block truncate">{it.title}</span>
                        {it.hint && <span className="t-caption block truncate text-muted">{it.hint}</span>}
                      </span>
                      {it.right && <span className="num relative font-display text-[14px] font-semibold">{it.right}</span>}
                      {on && <Icon name="chevron-forward" size={16} className="relative text-accent" />}
                    </button>
                  </div>
                );
              })}
            </div>
          </m.div>
        </Layer>
      )}
    </AnimatePresence>,
    document.body,
  );
}
