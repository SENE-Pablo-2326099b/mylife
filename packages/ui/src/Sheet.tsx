import { AnimatePresence, m, useDragControls, useIsPresent, type PanInfo } from 'framer-motion';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './icons';
import { springs } from './motion';
import { IconButton, Tap } from './primitives';
import { useBreakpoint } from './responsive';
import { lockScroll } from './scrollLock';

/**
 * Une lentille de verre qui flotte au-dessus de l'app. Sur téléphone elle monte du bas et se jette
 * vers le bas pour la fermer (glisser avec résistance, sensible à la vitesse) ; sur grand écran c'est
 * un panneau centré. Le monde derrière s'assombrit et se floute : de la profondeur, pas un rideau noir.
 */
export function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title?: string; children: ReactNode; footer?: ReactNode }) {
  return createPortal(
    <AnimatePresence>
      {open && (
        <SheetPanel key="sheet" onClose={onClose} title={title} footer={footer}>
          {children}
        </SheetPanel>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function SheetPanel({ onClose, title, children, footer }: { onClose: () => void; title?: string; children: ReactNode; footer?: ReactNode }) {
  const wide = useBreakpoint() === 'expanded';
  const controls = useDragControls();
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Fermeture lue au moment voulu : l'installation (focus, clavier, verrou du défilement) ne se fait
  // qu'une fois à l'ouverture, même si l'écran derrière se redessine (sinon le focus est volé en boucle).
  const close = useRef(onClose);
  close.current = onClose;
  // Dès qu'elle commence à partir, la feuille laisse passer les clics et rend le défilement : une
  // fermeture qui croise une ouverture (ou une animation qui n'aboutit pas) ne bloque jamais l'app.
  const present = useIsPresent();
  const presentRef = useRef(present);
  presentRef.current = present;
  const unlock = useRef<() => void>(() => undefined);
  useEffect(() => {
    if (!present) unlock.current();
  }, [present]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (!presentRef.current) return;
      if (e.key === 'Escape') close.current();
      if (e.key === 'Tab' && ref.current) {
        // Piège à focus : la tabulation reste dans la feuille.
        const focusables = ref.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])');
        if (focusables.length === 0) return;
        const first = focusables[0] as HTMLElement;
        const last = focusables[focusables.length - 1] as HTMLElement;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    unlock.current = lockScroll();
    return () => {
      window.removeEventListener('keydown', onKey);
      unlock.current();
      previous?.focus?.({ preventScroll: true });
    };
  }, []);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 120 || info.velocity.y > 900) onClose();
  };

  return (
    <div className="fixed inset-0 z-50" style={present ? undefined : { pointerEvents: 'none' }}>
      <m.div className="sheet-veil absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.2 } }} onClick={onClose} aria-hidden />
      <div className={`pointer-events-none absolute inset-0 flex justify-center ${wide ? 'items-center p-6' : 'items-end px-2'}`} style={wide ? undefined : { paddingBottom: 'max(calc(var(--safe-bottom) - 4px), 8px)' }}>
        <m.div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          aria-label={title ? undefined : 'Feuille'}
          tabIndex={-1}
          style={present ? undefined : { pointerEvents: 'none' }}
          className={`glass glass-lens pointer-events-auto flex max-h-[88dvh] w-full flex-col overflow-hidden outline-none ${wide ? 'max-w-[520px]' : 'max-w-[640px]'} rounded-[var(--r-sheet)]`}
          initial={wide ? { opacity: 0, scale: 0.94, y: 24 } : { y: '100%' }}
          animate={wide ? { opacity: 1, scale: 1, y: 0 } : { y: 0 }}
          exit={
            wide
              ? {
                  opacity: 0,
                  scale: 0.96,
                  y: 16,
                  transition: { duration: 0.18 },
                }
              : { y: '110%', transition: { ...springs.snappy, damping: 30 } }
          }
          transition={springs.soft}
          drag={wide ? false : 'y'}
          dragControls={controls}
          dragListener={false}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0.15, bottom: 1 }}
          onDragEnd={onDragEnd}
        >
          {/* Poignée + titre : la zone qui se glisse (le contenu, lui, défile). */}
          <div className="shrink-0 touch-none select-none" onPointerDown={(e) => !wide && controls.start(e)}>
            <div className="flex justify-center pb-1 pt-2.5">{!wide && <span className="h-[5px] w-[38px] rounded-[3px] opacity-50" style={{ background: 'var(--text-muted)' }} />}</div>
            <div className="flex items-start gap-2 pl-[18px] pr-2">
              {title && (
                <h2 id={titleId} className="t-title line-clamp-2 min-w-0 flex-1 pb-2 pt-1">
                  {title}
                </h2>
              )}
              {!title && <div className="flex-1" />}
              <IconButton icon="close" label="Fermer" onClick={onClose} size={20} />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-[18px] pb-4">{children}</div>
          {footer && (
            <div className="shrink-0 border-t px-[18px] pb-4 pt-3" style={{ borderColor: 'var(--border)' }}>
              {footer}
            </div>
          )}
        </m.div>
      </div>
    </div>
  );
}

export interface SheetAction {
  label: string;
  icon: IconName;
  onClick: () => void;
  destructive?: boolean;
  hidden?: boolean;
}

/** Lignes d'actions (icône + libellé), comme une feuille d'actions ; chacune ferme la feuille d'abord. */
export function ActionList({ actions, onClose }: { actions: readonly SheetAction[]; onClose: () => void }) {
  return (
    <div className="-mx-2 flex flex-col gap-0.5">
      {actions
        .filter((a) => !a.hidden)
        .map((a) => (
          <Tap
            key={a.label}
            onClick={() => {
              onClose();
              a.onClick();
            }}
            scaleTo={0.98}
            className="flex h-[54px] items-center gap-3 rounded-md px-3 text-left"
          >
            <span
              className="flex h-[34px] w-[34px] items-center justify-center rounded-sm"
              style={{
                background: a.destructive ? 'var(--danger-soft)' : 'var(--surface-alt)',
                color: a.destructive ? 'var(--danger)' : 'var(--text)',
              }}
            >
              <Icon name={a.icon} size={18} />
            </span>
            <span className={`t-body-strong ${a.destructive ? 'text-danger' : ''}`}>{a.label}</span>
          </Tap>
        ))}
    </div>
  );
}
