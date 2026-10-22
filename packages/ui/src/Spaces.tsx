import { AnimatePresence, m, useDragControls } from 'framer-motion';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { MYLIFE_APPS, MYLIFE_HOME, type MyLifeApp } from '../vendor/lumen';
import { kitApp, openMyLifeApp } from './app';
import { useGlance } from './glance';
import { Icon, type IconName } from './icons';
import { Layer } from './Layer';
import { haptic, springs } from './motion';
import { lockScroll } from './scrollLock';
import { usePendingRecovery, useSession } from './session';

/**
 * Espaces MyLife : le même menu dans toutes les apps pour passer de l'une à l'autre. Une feuille qui
 * monte du bas (à portée de pouce, qu'on ferme en la tirant vers le bas, en touchant à côté ou avec
 * Échap) : l'accueil et les trois apps en liste, chacune avec son aperçu du moment, l'app ouverte
 * marquée ; puis le compte (et les états propres à l'app : synchro, banques) et trois raccourcis.
 * L'ordre des apps ne change jamais : on retrouve toujours la même au même endroit.
 */

export interface SpaceRow {
  id: string;
  label: string;
  detail: string;
  state: 'ok' | 'busy' | 'error' | 'off';
  /** Toucher la ligne. */
  to?: string;
  /** Bouton d'actualisation à droite. */
  onSync?: () => void;
}

export interface SpaceShortcut {
  label: string;
  icon: IconName;
  to: string;
}

const APP_ICON: Record<MyLifeApp['id'], IconName> = { finances: 'diamond-fill', perf: 'barbell', raveloc: 'navigate' };

function Status({ state }: { state: SpaceRow['state'] }) {
  const color = state === 'error' ? 'var(--danger)' : state === 'busy' ? 'var(--accent)' : state === 'ok' ? 'var(--success)' : 'var(--text-muted)';
  return <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${state === 'busy' ? 'animate-pulse' : ''}`} style={{ background: color, boxShadow: '0 0 10px currentColor' }} />;
}

interface Target {
  id: string;
  name: string;
  line: string;
  colors: [string, string];
  icon: IconName;
  path: string;
  tone?: string;
}

/** Une destination : tuile de couleur, nom, aperçu ; grande zone à toucher (64 px). */
function TargetRow({ t, current, entering, onEnter }: { t: Target; current: boolean; entering: boolean; onEnter: () => void }) {
  return (
    <button
      type="button"
      onClick={onEnter}
      aria-current={current ? 'true' : undefined}
      aria-label={`${current ? 'Rester dans' : 'Ouvrir'} ${t.name}${t.line ? ` : ${t.line}` : ''}`}
      className={`tap relative flex min-h-[68px] w-full items-center gap-3.5 rounded-lg px-3 py-2 text-left transition-opacity ${entering ? 'opacity-50' : ''}`}
      style={current ? { background: 'var(--accent-soft)', boxShadow: 'inset 0 0 0 1.5px var(--accent)' } : undefined}
    >
      <span
        aria-hidden
        className="flex h-[48px] w-[48px] shrink-0 items-center justify-center rounded-[15px] text-white"
        style={{ background: `linear-gradient(150deg, ${t.colors[0]}, ${t.colors[1]})`, boxShadow: `inset 0 1px 0 rgba(255,255,255,0.45), 0 6px 16px ${t.colors[1]}44` }}
      >
        <Icon name={t.icon} size={24} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="t-body-strong flex items-center gap-2">
          {t.name}
          {current && <span className="rounded-pill px-2 py-px text-[11px] font-semibold text-accent" style={{ background: 'var(--accent-tint)' }}>Ici</span>}
        </span>
        <span className="t-small block truncate" style={{ color: t.tone ?? 'var(--text-secondary)' }}>
          {t.line}
        </span>
      </span>
      {!current && <Icon name="chevron-forward" size={18} className="text-muted" />}
    </button>
  );
}

export function Spaces({ open, onClose, rows = [], shortcuts = [], accountPath }: { open: boolean; onClose: () => void; rows?: SpaceRow[]; shortcuts?: SpaceShortcut[]; accountPath: string }) {
  const navigate = useNavigate();
  const session = useSession();
  const pending = usePendingRecovery();
  const [entering, setEntering] = useState<string | null>(null);
  const here = kitApp().id;
  const controls = useDragControls();
  // Aperçus lus ici (un hook par app, toujours dans le même ordre).
  const glances = { finances: useGlance('finances'), perf: useGlance('perf'), raveloc: useGlance('raveloc') };

  useEffect(() => {
    if (!open) {
      setEntering(null);
      return;
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const unlock = lockScroll();
    return () => {
      window.removeEventListener('keydown', onKey);
      unlock();
    };
  }, [open, onClose]);

  const go = (to: string) => {
    onClose();
    navigate(to);
  };
  const enter = (t: Target) => {
    haptic('success');
    if (here === t.id) return onClose();
    setEntering(t.id);
    // Un court fondu, puis on change d'app (la transition entre pages prend le relais).
    setTimeout(() => openMyLifeApp(t.path), 140);
  };

  const targets: Target[] = [
    { id: 'home', name: MYLIFE_HOME.name, line: 'Tes apps, ton compte, l’apparence', colors: [...MYLIFE_HOME.colors], icon: 'sparkles', path: MYLIFE_HOME.path },
    ...MYLIFE_APPS.map<Target>((a) => {
      const g = glances[a.id];
      const tone = g?.tone && g.tone !== 'accent' ? `var(--${g.tone})` : undefined;
      return { id: a.id, name: a.name, line: g ? `${g.title}${g.detail ? ` · ${g.detail}` : ''}` : a.tagline, colors: a.colors, icon: APP_ICON[a.id], path: a.path, tone };
    }),
  ];

  const accountRow: SpaceRow = !session
    ? { id: 'account', label: 'Compte MyLife', detail: 'Pas connecté : tout reste sur cet appareil', state: 'off', to: accountPath }
    : pending
      ? { id: 'account', label: 'Compte MyLife', detail: `${session.login} · clé de secours à mettre de côté`, state: 'error', to: accountPath }
      : { id: 'account', label: 'Compte MyLife', detail: `${session.login} · chiffré de bout en bout`, state: 'ok', to: accountPath };

  return createPortal(
    <AnimatePresence>
      {open && (
        <Layer className="fixed inset-0 z-[65]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} role="dialog" aria-modal="true" aria-label="Espaces MyLife">
          <div className="palette-veil absolute inset-0" onClick={onClose} aria-hidden />
          <div className="pointer-events-none absolute inset-0 flex items-end justify-center px-2" style={{ paddingBottom: 'max(calc(var(--safe-bottom) - 4px), 8px)' }}>
          <m.div
            className="glass glass-lens pointer-events-auto flex max-h-[90dvh] w-full max-w-[560px] flex-col overflow-hidden rounded-[var(--r-sheet)]"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '110%', transition: { duration: 0.2 } }}
            transition={springs.soft}
            drag="y"
            dragControls={controls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 1 }}
            onDragEnd={(_e, info) => (info.offset.y > 90 || info.velocity.y > 500) && onClose()}
          >
            {/* Poignée : on la tire vers le bas pour fermer (le contenu, lui, défile). */}
            <button type="button" onClick={onClose} onPointerDown={(e) => controls.start(e)} aria-label="Fermer" className="flex h-9 w-full shrink-0 touch-none items-center justify-center">
              <span className="h-[5px] w-[38px] rounded-[3px]" style={{ background: 'var(--text-muted)', opacity: 0.5 }} />
            </button>
            <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3">
              <p className="t-label px-1 pb-1 text-muted">Aller à</p>
              <div className="flex flex-col gap-1">
                {targets.map((t) => (
                  <TargetRow key={t.id} t={t} current={here === t.id} entering={entering === t.id} onEnter={() => enter(t)} />
                ))}
              </div>

              <p className="t-label px-1 pb-1 pt-4 text-muted">Compte et synchro</p>
              <div className="overflow-hidden rounded-lg" style={{ background: 'var(--surface-alt)' }}>
                {[accountRow, ...rows].map((r, i) => (
                  <div key={r.id}>
                    {i > 0 && <div className="ml-9 h-px bg-line" />}
                    <div className="flex min-h-[58px] items-center gap-3 px-4 py-2">
                      <Status state={r.state} />
                      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => r.to && go(r.to)}>
                        <span className="t-body-strong block">{r.label}</span>
                        <span className="t-small block truncate text-secondary">{r.detail}</span>
                      </button>
                      {r.onSync && (
                        <button type="button" aria-label={`Actualiser : ${r.label}`} className="flex h-11 w-11 items-center justify-center rounded-full text-accent" onClick={r.onSync}>
                          <Icon name="sync" size={19} className={r.state === 'busy' ? 'spin' : ''} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {shortcuts.length > 0 && (
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {shortcuts.map((s) => (
                    <button key={s.to} type="button" onClick={() => go(s.to)} className="tap flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-lg" style={{ background: 'var(--surface-alt)' }}>
                      <Icon name={s.icon} size={20} className="text-accent" />
                      <span className="t-small font-semibold">{s.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </m.div>
          </div>
        </Layer>
      )}
    </AnimatePresence>,
    document.body,
  );
}
