import { AnimatePresence, m } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons';
import { haptic, springs } from './motion';
import { Glass, Tap } from './primitives';
import { themePalette, THEMES, type ThemeId } from './themes';

/** Un reflet qui balaie le verre : « quelque chose arrive ». */
export function Shimmer({ height, width = '100%', className = 'rounded-sm' }: { height: number; width?: number | string; className?: string }) {
  return <div className={`shimmer ${className}`} style={{ height, width }} aria-hidden />;
}

/** Carte fantôme qui imite un bloc de contenu pendant le chargement. */
export function SkeletonCard({ lines = 3, tall = false }: { lines?: number; tall?: boolean }) {
  return (
    <Glass className="flex flex-col gap-3 rounded-lg p-4" aria-busy="true" aria-label="Chargement">
      <Shimmer height={12} width="35%" />
      <Shimmer height={tall ? 34 : 22} width="60%" className="rounded-xs" />
      {Array.from({ length: lines }, (_, i) => (
        <Shimmer key={i} height={10} width={`${90 - i * 15}%`} />
      ))}
    </Glass>
  );
}

/**
 * Valider une action importante = allumer une lumière : une orbe d'accent qui s'éclaire avec un
 * petit rebond (ressort liquide) et une lueur. `trigger` change → l'orbe rejoue.
 */
export function Orb({ trigger, gold = false, size = 56 }: { trigger: unknown; gold?: boolean; size?: number }) {
  const first = useRef(true);
  const [key, setKey] = useState(0);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    haptic('success');
    setKey((k) => k + 1);
  }, [trigger]);
  return (
    <m.span
      key={key}
      className={`liquid inline-flex items-center justify-center rounded-full ${gold ? 'liquid-gold text-ink' : ''}`}
      style={{ width: size, height: size, boxShadow: `0 0 ${size * 0.6}px ${gold ? 'var(--gold-halo)' : 'var(--accent-glow)'}, inset 0 1px 0 var(--highlight)` }}
      initial={key === 0 ? false : { scale: 0.82 }}
      animate={{ scale: 1 }}
      transition={springs.liquid}
      aria-hidden
    >
      <Icon name={gold ? 'trophy' : 'check'} size={size * 0.45} />
    </m.span>
  );
}

/** Confirmation plein écran brève : l'orbe s'allume au centre (enregistrement d'un objectif, fin d'accueil…). */
export function OrbFlash({ show, gold, message }: { show: boolean; gold?: boolean; message?: string }) {
  return (
    <AnimatePresence>
      {show && (
        <m.div className="pointer-events-none fixed inset-0 z-[70] flex flex-col items-center justify-center gap-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <m.span initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={springs.liquid}>
            <Orb trigger={0} gold={gold} size={84} />
          </m.span>
          {message && <p className="t-headline">{message}</p>}
        </m.div>
      )}
    </AnimatePresence>
  );
}

/** Un thème en miniature : son champ, une carte de verre avec une ligne de titre, une ligne et son accent. */
function ThemePreview({ id }: { id: ThemeId }) {
  const p = themePalette(id);
  return (
    <div className="relative h-[92px] overflow-hidden rounded-md p-2" style={{ background: `linear-gradient(180deg, ${p.field[0]}, ${p.field[1]} 55%, ${p.field[2]})` }}>
      <span className="absolute -right-3.5 -top-[18px] h-16 w-16 rounded-full opacity-[0.35]" style={{ background: p.halos.violet }} />
      <span className="absolute -left-5 top-[18px] h-12 w-12 rounded-full opacity-[0.22]" style={{ background: p.halos.gold }} />
      <div className="absolute inset-x-2 bottom-2 flex flex-col gap-[5px] rounded-[10px] border p-[7px]" style={{ background: p.glass.raised.solidFill, borderColor: p.glass.raised.rim }}>
        <span className="h-[5px] w-[62%] rounded-[3px] opacity-85" style={{ background: p.text }} />
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: p.gold }} />
          <span className="h-1 flex-1 rounded-sm" style={{ background: p.textMuted }} />
          <span className="h-3 w-4 rounded" style={{ background: p.well }} />
          <span className="h-3 w-3.5 rounded" style={{ background: `linear-gradient(135deg, ${p.accentGradient[0]}, ${p.accentGradient[1]})` }} />
        </span>
      </div>
    </div>
  );
}

/** Choix du thème : chaque thème en miniature ; un tap l'applique tout de suite. */
export function ThemePicker({ value, onChange }: { value: ThemeId; onChange: (id: ThemeId) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 min-[560px]:grid-cols-4" role="radiogroup" aria-label="Thème">
      {THEMES.map((th) => {
        const selected = th.id === value;
        return (
          <Tap
            key={th.id}
            onClick={() => onChange(th.id)}
            scaleTo={0.96}
            role="radio"
            ariaChecked={selected}
            label={`Thème ${th.name} : ${th.description}`}
            className="rounded-lg border-2 p-[5px] text-left"
            style={{ borderColor: selected ? 'var(--accent)' : 'transparent' }}
          >
            <ThemePreview id={th.id} />
            <span className="flex items-center gap-1.5 px-1 pb-0.5 pt-1.5">
              <span className="min-w-0 flex-1">
                <span className="t-body-strong block truncate">{th.name}</span>
                <span className="t-caption block truncate text-muted">{th.description}</span>
              </span>
              {selected && <Icon name="check-circle" size={20} className="text-accent" />}
            </span>
          </Tap>
        );
      })}
    </div>
  );
}

/**
 * En attendant des données : rien pendant 150 ms (la plupart des lectures locales finissent avant,
 * donc aucun clignotement), puis un squelette discret si c'est plus long. Jamais d'état « vide » faux.
 */
export function Pending({ cards = 2 }: { cards?: number }) {
  const [late, setLate] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setLate(true), 150);
    return () => clearTimeout(id);
  }, []);
  if (!late) return null;
  return (
    <div className="space-y-3" aria-busy="true">
      {Array.from({ length: cards }, (_, i) => (
        <SkeletonCard key={i} tall={i === 0} />
      ))}
    </div>
  );
}
