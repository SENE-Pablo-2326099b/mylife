import { useEffect, useRef, type ReactNode } from 'react';
import { IconClose } from './icons';

/** Panneau modal (bas d'écran sur mobile), fermable avec Échap. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      previous?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 sm:items-center" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="pb-safe max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-t-3xl border border-line bg-surface p-4 outline-none sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="inline-flex h-11 w-11 items-center justify-center rounded-xl hover:bg-raised" aria-label="Fermer">
            <IconClose />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
