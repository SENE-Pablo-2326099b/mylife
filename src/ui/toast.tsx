import { AnimatePresence, motion } from 'framer-motion';
import { Icon } from './icons';
import { Tap } from './primitives';
import { useBreakpoint } from './responsive';
import { useDockHidden } from './dockStore';
import { runToastAction, useToast } from './toastStore';

export function ToastHost() {
  const t = useToast();
  const bp = useBreakpoint();
  const dockHidden = useDockHidden();
  const bottom = bp === 'expanded' || dockHidden ? 24 : 96;
  const gold = t?.tone === 'gold';
  return (
    <div className="pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-4" style={{ bottom: `calc(var(--safe-bottom) + ${bottom}px)`, paddingLeft: 'calc(var(--nav-left, 0px) + 16px)' }} aria-live="polite" role="status">
      <AnimatePresence>
        {t && (
          <motion.div
            key={t.id}
            className="pointer-events-auto w-full max-w-[520px]"
            initial={{ opacity: 0, scale: 0.85, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, y: 16, transition: { duration: 0.16 } }}
            transition={{ type: 'spring', damping: 16, stiffness: 220 }}
          >
            <div className={`glass glass-float flex min-h-[50px] items-center gap-2 rounded-pill pr-1 ${gold ? 'pl-3' : 'pl-[18px]'}`} style={gold ? { boxShadow: '0 10px 30px var(--gold-halo), inset 0 1px 0 var(--glass-float-spec)' } : undefined}>
              {gold && (
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gold" style={{ background: 'var(--gold-soft)' }}>
                  <Icon name="trophy" size={17} />
                </span>
              )}
              {t.tone === 'danger' && <Icon name="warning" size={18} className="text-danger" />}
              <p className="t-body-strong min-w-0 flex-1 py-2 pr-2">{t.message}</p>
              {t.actionLabel && (
                <Tap
                  onClick={runToastAction}
                  className="flex h-10 shrink-0 items-center rounded-pill px-3.5 text-accent"
                  style={{ background: 'var(--accent-soft)' }}
                >
                  <span className="t-body-strong">{t.actionLabel}</span>
                </Tap>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
