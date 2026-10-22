import { AnimatePresence, m } from 'framer-motion';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { getMeta } from '../db/db';
import { openMyLifeApp } from '../lib/app';
import { relativeTime } from '../lib/relative';
import { syncCloud, useCloud } from '../sync/cloud';
import { runSync, useSyncState } from '../sync/store';
import { Icon, type IconName } from '../ui/icons';
import { haptic, springs } from '../ui/motion';
import { MYLIFE_APPS } from '../vendor/lumen';
import { Layer } from '../ui/Layer';
import { lockScroll } from '../ui/scrollLock';

/**
 * Espaces MyLife : l'écosystème en plein écran. Chaque app est une grande carte de verre ; en choisir
 * une la fait grandir jusqu'à remplir l'écran, puis on y entre. En dessous : le compte et les banques
 * (état, synchro) et les raccourcis. Conçu pour accueillir les prochaines apps de MyLife.
 */

interface Space {
  id: string;
  name: string;
  tagline: string;
  icon: IconName;
  /** Couleurs de la carte (dégradé). */
  colors: [string, string];
  /** null : l'app ouverte. */
  open: (() => void) | null;
}

// Les apps de MyLife, dans le même ordre et aux mêmes couleurs dans toutes les apps (paquet partagé).
const SPACES: Space[] = MYLIFE_APPS.map((a) => ({
  id: a.id,
  name: a.name,
  tagline: a.tagline,
  icon: a.icon === 'diamond' ? 'diamond-fill' : a.icon,
  colors: a.colors,
  open: a.id === 'finances' ? null : () => openMyLifeApp(a.path),
}));

export function Spaces({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const cloud = useCloud();
  const bank = useSyncState();
  const lastBank = useLiveQuery(() => getMeta<number>('lastSyncAt'), [bank.finishedAt]);
  const [entering, setEntering] = useState<string | null>(null);

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
  const enter = (s: Space) => {
    haptic('success');
    if (!s.open) return onClose();
    setEntering(s.id);
    // La carte remplit l'écran, puis on change d'app.
    setTimeout(() => s.open?.(), 420);
  };

  const cloudLine = !cloud.session
    ? 'Pas connecté : tout reste sur cet appareil'
    : !cloud.joined
      ? 'Connecté, appareil à relier'
      : cloud.error
        ? cloud.error
        : cloud.syncing
          ? 'Synchro en cours…'
          : `${cloud.session.login} · synchro ${relativeTime(cloud.lastSyncAt)}`;
  const bankLine = bank.error ?? (bank.syncing ? 'Interrogation des banques…' : `Synchro ${relativeTime(lastBank)}`);
  const status = (ok: boolean, busy: boolean, error: boolean) => (
    <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${busy ? 'animate-pulse' : ''}`} style={{ background: error ? 'var(--danger)' : busy ? 'var(--accent)' : ok ? 'var(--success)' : 'var(--text-muted)', boxShadow: '0 0 10px currentColor' }} />
  );

  return createPortal(
    <AnimatePresence>
      {open && (
        <Layer className="fixed inset-0 z-[65] overflow-y-auto" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} role="dialog" aria-modal="true" aria-label="Espaces MyLife">
          <div className="palette-veil fixed inset-0" onClick={onClose} aria-hidden />
          <div className="relative mx-auto w-full max-w-[560px] px-4" style={{ paddingTop: 'calc(var(--safe-top) + 18px)', paddingBottom: 'calc(var(--safe-bottom) + 24px)' }}>
            <div className="flex items-center justify-between">
              <m.p className="t-large" initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={springs.soft}>
                MyLife
              </m.p>
              <button type="button" onClick={onClose} aria-label="Fermer" className="glass glass-float flex h-11 w-11 items-center justify-center rounded-full">
                <Icon name="close" size={20} />
              </button>
            </div>
            <p className="t-small mt-1 text-secondary">Tes apps, un seul compte, tes données chiffrées.</p>

            <div className="mt-5 grid grid-cols-2 gap-3">
              {SPACES.map((s, i) => {
                const current = s.open === null;
                const zooming = entering === s.id;
                return (
                  <m.button
                    key={s.id}
                    type="button"
                    onClick={() => enter(s)}
                    className="relative aspect-[4/5] overflow-hidden rounded-xl text-left"
                    initial={{ y: 24, opacity: 0, scale: 0.94 }}
                    animate={zooming ? { scale: 4, opacity: 0.0, y: 0 } : { y: 0, opacity: 1, scale: 1 }}
                    transition={zooming ? { duration: 0.45, ease: [0.7, 0, 0.84, 0] } : { ...springs.liquid, delay: 0.04 + i * 0.06 }}
                    whileTap={{ scale: 0.96 }}
                    style={{ zIndex: zooming ? 5 : 1 }}
                  >
                    <span aria-hidden className="absolute inset-0" style={{ background: `linear-gradient(150deg, ${s.colors[0]}, ${s.colors[1]})` }} />
                    <span aria-hidden className="absolute inset-0" style={{ background: 'radial-gradient(120% 80% at 20% 0%, rgba(255,255,255,0.45), transparent 55%)' }} />
                    <span aria-hidden className="absolute inset-0 rounded-xl" style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.5), inset 0 0 0 1px rgba(255,255,255,0.18), inset 0 -24px 40px rgba(0,0,0,0.25)' }} />
                    <span className="relative flex h-full flex-col justify-between p-4 text-white">
                      <span className="flex h-12 w-12 items-center justify-center rounded-[16px]" style={{ background: 'rgba(255,255,255,0.22)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.5)' }}>
                        <Icon name={s.icon} size={26} />
                      </span>
                      <span>
                        {current && <span className="mb-1.5 inline-block rounded-pill px-2 py-0.5 text-[11px] font-semibold" style={{ background: 'rgba(255,255,255,0.25)' }}>Ouverte</span>}
                        <span className="block font-display text-[22px] font-bold leading-tight">{s.name}</span>
                        <span className="mt-0.5 block text-[13px] leading-snug opacity-90">{s.tagline}</span>
                      </span>
                    </span>
                  </m.button>
                );
              })}
            </div>

            <m.div className="glass glass-raised mt-4 overflow-hidden rounded-lg" initial={{ y: 18, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ ...springs.soft, delay: 0.14 }}>
              <div className="flex min-h-[60px] items-center gap-3 px-4 py-2">
                {status(!!cloud.joined, cloud.syncing, !!cloud.error)}
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => go('/reglages/compte')}>
                  <span className="t-body-strong block">Compte MyLife</span>
                  <span className="t-small block truncate text-secondary">{cloudLine}</span>
                </button>
                {cloud.joined && (
                  <button type="button" aria-label="Synchroniser le compte" className="flex h-11 w-11 items-center justify-center rounded-full text-accent" onClick={() => void syncCloud()}>
                    <Icon name="sync" size={19} className={cloud.syncing ? 'spin' : ''} />
                  </button>
                )}
              </div>
              <div className="ml-9 h-px bg-line" />
              <div className="flex min-h-[60px] items-center gap-3 px-4 py-2">
                {status(!!lastBank, bank.syncing, !!bank.error)}
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => go('/synchro')}>
                  <span className="t-body-strong block">Banques</span>
                  <span className="t-small block truncate text-secondary">{bankLine}</span>
                </button>
                <button type="button" aria-label="Synchroniser les banques" className="flex h-11 w-11 items-center justify-center rounded-full text-accent" onClick={() => void runSync()}>
                  <Icon name="sync" size={19} className={bank.syncing ? 'spin' : ''} />
                </button>
              </div>
            </m.div>

            <m.div className="mt-3 grid grid-cols-3 gap-2" initial={{ y: 18, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ ...springs.soft, delay: 0.2 }}>
              {(
                [
                  // Même rangée dans chaque app : l'assistant, les données propres à l'app, les réglages.
                  ['Assistant', 'sparkles', '/assistant'],
                  ['Banques', 'bank', '/synchro'],
                  ['Réglages', 'options', '/reglages'],
                ] as [string, IconName, string][]
              ).map(([label, icon, to]) => (
                <button key={to} type="button" onClick={() => go(to)} className="glass flex flex-col items-center gap-1.5 rounded-lg py-3.5">
                  <Icon name={icon} size={20} className="text-accent" />
                  <span className="t-small font-semibold">{label}</span>
                </button>
              ))}
            </m.div>
          </div>
        </Layer>
      )}
    </AnimatePresence>,
    document.body,
  );
}
