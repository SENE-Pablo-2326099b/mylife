import { AnimatePresence, m } from 'framer-motion';
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
 * Espaces MyLife : l'écosystème en plein écran, le même dans toutes les apps. Chaque app est une
 * grande carte de verre avec son aperçu du moment ; en choisir une la fait grandir jusqu'à remplir
 * l'écran, puis on y entre. En dessous : le compte (et les états propres à l'app : synchro, banques)
 * et trois raccourcis de l'app.
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

function AppCard({ app, index, entering, onEnter }: { app: MyLifeApp; index: number; entering: string | null; onEnter: () => void }) {
  const current = kitApp().id === app.id;
  const glance = useGlance(app.id);
  const zooming = entering === app.id;
  return (
    <m.button
      type="button"
      onClick={onEnter}
      className="relative aspect-[4/5] overflow-hidden rounded-xl text-left"
      initial={{ y: 24, opacity: 0, scale: 0.94 }}
      animate={zooming ? { scale: 4, opacity: 0, y: 0 } : { y: 0, opacity: 1, scale: 1 }}
      transition={zooming ? { duration: 0.45, ease: [0.7, 0, 0.84, 0] } : { ...springs.liquid, delay: 0.04 + index * 0.06 }}
      whileTap={{ scale: 0.96 }}
      style={{ zIndex: zooming ? 5 : 1 }}
      aria-label={`${app.name}${current ? ' (ouverte)' : ''}${glance ? ` : ${glance.title}` : ''}`}
    >
      <span aria-hidden className="absolute inset-0" style={{ background: `linear-gradient(150deg, ${app.colors[0]}, ${app.colors[1]})` }} />
      <span aria-hidden className="absolute inset-0" style={{ background: 'radial-gradient(120% 80% at 20% 0%, rgba(255,255,255,0.45), transparent 55%)' }} />
      <span aria-hidden className="absolute inset-0 rounded-xl" style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.5), inset 0 0 0 1px rgba(255,255,255,0.18), inset 0 -24px 40px rgba(0,0,0,0.25)' }} />
      <span className="relative flex h-full flex-col justify-between p-4 text-white">
        <span className="flex items-start justify-between">
          <span className="flex h-12 w-12 items-center justify-center rounded-[16px]" style={{ background: 'rgba(255,255,255,0.22)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.5)' }}>
            <Icon name={APP_ICON[app.id]} size={26} />
          </span>
          {current && (
            <span className="rounded-pill px-2 py-0.5 text-[11px] font-semibold" style={{ background: 'rgba(255,255,255,0.25)' }}>
              Ouverte
            </span>
          )}
        </span>
        <span>
          <span className="block font-display text-[22px] font-bold leading-tight">{app.name}</span>
          {glance ? (
            <>
              <span className="mt-1 block text-[14px] font-semibold leading-snug">{glance.title}</span>
              {glance.detail && <span className="mt-0.5 block text-[12.5px] leading-snug opacity-90">{glance.detail}</span>}
            </>
          ) : (
            <span className="mt-0.5 block text-[13px] leading-snug opacity-90">{app.tagline}</span>
          )}
        </span>
      </span>
    </m.button>
  );
}

export function Spaces({ open, onClose, rows = [], shortcuts = [], accountPath }: { open: boolean; onClose: () => void; rows?: SpaceRow[]; shortcuts?: SpaceShortcut[]; accountPath: string }) {
  const navigate = useNavigate();
  const session = useSession();
  const pending = usePendingRecovery();
  const [entering, setEntering] = useState<string | null>(null);
  const home = kitApp().id === 'home';

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
  const enter = (app: MyLifeApp) => {
    haptic('success');
    if (kitApp().id === app.id) return onClose();
    setEntering(app.id);
    // La carte remplit l'écran, puis on change d'app.
    setTimeout(() => openMyLifeApp(app.path), 420);
  };

  const accountRow: SpaceRow = !session
    ? { id: 'account', label: 'Compte MyLife', detail: 'Pas connecté : tout reste sur cet appareil', state: 'off', to: accountPath }
    : pending
      ? { id: 'account', label: 'Compte MyLife', detail: `${session.login} · clé de secours à mettre de côté`, state: 'error', to: accountPath }
      : { id: 'account', label: 'Compte MyLife', detail: `${session.login} · chiffré de bout en bout`, state: 'ok', to: accountPath };

  return createPortal(
    <AnimatePresence>
      {open && (
        <Layer className="fixed inset-0 z-[65] overflow-y-auto" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} role="dialog" aria-modal="true" aria-label="Espaces MyLife">
          <div className="palette-veil fixed inset-0" onClick={onClose} aria-hidden />
          <div className="relative mx-auto w-full max-w-[560px] px-4" style={{ paddingTop: 'calc(var(--safe-top) + 18px)', paddingBottom: 'calc(var(--safe-bottom) + 24px)' }}>
            <div className="flex items-center justify-between gap-2">
              <m.p className="t-large" initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={springs.soft}>
                {MYLIFE_HOME.name}
              </m.p>
              <span className="flex items-center gap-2">
                {!home && (
                  <button type="button" onClick={() => openMyLifeApp(MYLIFE_HOME.path)} className="glass glass-float flex h-11 items-center gap-2 rounded-full px-4 text-[14px] font-semibold">
                    <Icon name="home" size={18} />
                    Accueil
                  </button>
                )}
                <button type="button" onClick={onClose} aria-label="Fermer" className="glass glass-float flex h-11 w-11 items-center justify-center rounded-full">
                  <Icon name="close" size={20} />
                </button>
              </span>
            </div>
            <p className="t-small mt-1 text-secondary">Tes apps, un seul compte, tes données chiffrées.</p>

            <div className="mt-5 grid grid-cols-2 gap-3">
              {MYLIFE_APPS.map((a, i) => (
                <AppCard key={a.id} app={a} index={i} entering={entering} onEnter={() => enter(a)} />
              ))}
            </div>

            <m.div className="glass glass-raised mt-4 overflow-hidden rounded-lg" initial={{ y: 18, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ ...springs.soft, delay: 0.14 }}>
              {[accountRow, ...rows].map((r, i) => (
                <div key={r.id}>
                  {i > 0 && <div className="ml-9 h-px bg-line" />}
                  <div className="flex min-h-[60px] items-center gap-3 px-4 py-2">
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
            </m.div>

            {shortcuts.length > 0 && (
              <m.div className="mt-3 grid grid-cols-3 gap-2" initial={{ y: 18, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ ...springs.soft, delay: 0.2 }}>
                {shortcuts.map((s) => (
                  <button key={s.to} type="button" onClick={() => go(s.to)} className="glass flex flex-col items-center gap-1.5 rounded-lg py-3.5">
                    <Icon name={s.icon} size={20} className="text-accent" />
                    <span className="t-small font-semibold">{s.label}</span>
                  </button>
                ))}
              </m.div>
            )}
          </div>
        </Layer>
      )}
    </AnimatePresence>,
    document.body,
  );
}
