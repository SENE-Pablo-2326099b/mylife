// GÉNÉRÉ depuis MyLife/packages/ui — ne pas modifier ici (MyLife : npm run vendor).
import { AnimatePresence, m } from 'framer-motion';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Icon } from './icons';
import { haptic, springs } from './motion';
import { Glass, Tap } from './primitives';
import { withAlpha } from './theme';
import { styleOf, themeInfo, themePalette, THEMES, type ThemeId } from './themes';

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

/** Le fond, la carte et le bouton d'un thème en miniature, dessinés avec sa propre identité. */
function ThemePreview({ id }: { id: ThemeId }) {
  const p = themePalette(id);
  const st = styleOf(id);
  const ink = p.text;
  const card: CSSProperties =
    st.card === 'brutal'
      ? { background: '#FFFFFF', border: `2px solid ${ink}`, boxShadow: `3px 3px 0 ${ink}`, borderRadius: 5 }
      : st.card === 'clay'
        ? { background: p.glass.raised.fill, boxShadow: `4px 5px 10px ${withAlpha(p.accent, 0.2)}, -3px -3px 8px rgba(255,255,255,0.9), inset 2px 2px 4px rgba(255,255,255,0.9)`, borderRadius: 16 }
        : st.card === 'outline'
          ? { background: p.glass.raised.solidFill, border: `1px solid ${withAlpha(p.accent, 0.6)}`, boxShadow: `0 0 12px -2px ${p.accentGlow}`, borderRadius: 3 }
          : st.card === 'solid'
            ? { background: p.glass.raised.fill, border: `1px solid ${p.glass.raised.rim}`, borderRadius: 6 }
            : { background: p.glass.raised.solidFill, border: `1px solid ${p.glass.raised.rim}`, borderRadius: 10 };
  const button: CSSProperties =
    st.button === 'brutal'
      ? { background: p.accent, border: `1.5px solid ${ink}`, borderRadius: 999 }
      : st.button === 'outline'
        ? { border: `1px solid ${p.accent}`, boxShadow: `0 0 8px ${p.accentGlow}`, borderRadius: 2 }
        : st.button === 'solid'
          ? { background: p.accent, borderRadius: 3 }
          : { background: `linear-gradient(135deg, ${p.accentGradient[0]}, ${p.accentGradient[1]})`, borderRadius: 999 };
  const field =
    st.backdrop === 'grid'
      ? `linear-gradient(${withAlpha(p.accent, 0.16)} 1px, transparent 1px) 0 0 / 12px 12px, linear-gradient(90deg, ${withAlpha(p.accent, 0.16)} 1px, transparent 1px) 0 0 / 12px 12px, ${p.bg}`
      : st.backdrop === 'plain' && st.id === 'brut'
        ? `radial-gradient(circle, ${withAlpha(ink, 0.25)} 1px, transparent 1.4px) 0 0 / 9px 9px, ${p.bg}`
        : `linear-gradient(180deg, ${p.field[0]}, ${p.field[1]} 55%, ${p.field[2]})`;
  const halos = st.backdrop === 'halos' || st.backdrop === 'blobs';
  return (
    <div className="relative h-[92px] overflow-hidden rounded-md p-2" style={{ background: field }}>
      {halos && <span className="absolute -right-3.5 -top-[18px] h-16 w-16 rounded-full opacity-[0.35]" style={{ background: p.halos.violet, filter: st.backdrop === 'blobs' ? 'blur(6px)' : undefined }} />}
      {halos && <span className="absolute -left-5 top-[18px] h-12 w-12 rounded-full opacity-[0.22]" style={{ background: p.halos.gold, filter: st.backdrop === 'blobs' ? 'blur(6px)' : undefined }} />}
      <span
        className="absolute left-2.5 top-1.5 text-[19px] leading-none"
        style={{ color: ink, fontFamily: `'${st.fonts.display}', sans-serif`, fontWeight: st.titleWeight, textTransform: st.labelCase === 'upper' ? 'uppercase' : undefined }}
        aria-hidden
      >
        Aa
      </span>
      <div className="absolute inset-x-2 bottom-2 flex flex-col gap-[5px] p-[7px]" style={card}>
        <span className="h-[5px] w-[62%] rounded-[3px] opacity-85" style={{ background: ink }} />
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: p.gold }} />
          <span className="h-1 flex-1 rounded-sm" style={{ background: p.textMuted }} />
          <span className="h-3 w-6" style={button} />
        </span>
      </div>
    </div>
  );
}

function ThemeTile({ id, selected, onChange }: { id: ThemeId; selected: boolean; onChange: (id: ThemeId) => void }) {
  const th = themeInfo(id);
  return (
    <Tap
      onClick={() => onChange(id)}
      scaleTo={0.96}
      role="radio"
      ariaChecked={selected}
      label={`Thème ${th.name} : ${th.description}`}
      className="rounded-lg border-2 p-[5px] text-left"
      style={{ borderColor: selected ? 'var(--accent)' : 'transparent' }}
    >
      <ThemePreview id={id} />
      <span className="flex items-center gap-1.5 px-1 pb-0.5 pt-1.5">
        <span className="min-w-0 flex-1">
          <span className="t-body-strong block truncate">{th.name}</span>
          <span className="t-caption block truncate text-muted">{th.description}</span>
        </span>
        {selected && <Icon name="check-circle" size={20} className="text-accent" />}
      </span>
    </Tap>
  );
}

/**
 * Choix du thème, en deux familles : les identités (chacune sa forme, sa typographie, sa matière) et
 * les palettes de Lumen, le verre d'origine. Un tap l'applique tout de suite.
 */
export function ThemePicker({ value, onChange }: { value: ThemeId; onChange: (id: ThemeId) => void }) {
  const identities = THEMES.filter((t) => t.style !== 'lumen');
  const lumen = THEMES.filter((t) => t.style === 'lumen');
  return (
    <div role="radiogroup" aria-label="Thème" className="flex flex-col gap-3">
      <p className="t-label text-muted">Identités · chacune sa forme, sa typographie, sa matière</p>
      <div className="grid grid-cols-2 gap-2 min-[560px]:grid-cols-4">
        {identities.map((th) => (
          <ThemeTile key={th.id} id={th.id} selected={th.id === value} onChange={onChange} />
        ))}
      </div>
      <p className="t-label mt-2 text-muted">Lumen · verre et lumière</p>
      <div className="grid grid-cols-2 gap-2 min-[560px]:grid-cols-4">
        {lumen.map((th) => (
          <ThemeTile key={th.id} id={th.id} selected={th.id === value} onChange={onChange} />
        ))}
      </div>
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
