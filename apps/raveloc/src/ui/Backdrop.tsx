// GÉNÉRÉ depuis MyLife/packages/ui — ne pas modifier ici (MyLife : npm run vendor).
import { m, useScroll, useTransform } from 'framer-motion';
import { useAmbient, useMood, type Mood } from './mood';
import { springs } from './motion';
import { useWindowHeight, useWindowWidth } from './responsive';
import { withAlpha } from './theme';
import { useTheme } from './themeRuntime';
import type { StyleId } from './themes';

/**
 * Le champ de lumière devant lequel se voit tout le verre.
 * Les halos dérivent lentement (la vie), suivent le défilement (parallaxe, la profondeur) et se
 * réarrangent quand on change de section (la lumière te suit). Seules des transformations sont
 * animées : peu coûteux pour le GPU. Android : pas de dérive perpétuelle (voir .android).
 */

interface HaloSpec {
  color: 'violet' | 'gold' | 'indigo' | 'orchid';
  /** Diamètre relatif au grand côté de l'écran. */
  size: number;
  /** Centre par ambiance, en fraction de l'écran (x, y). */
  at: Record<Mood, [number, number]>;
  opacity: number;
  drift: number;
  period: number;
  parallax: number;
}

const HALOS: HaloSpec[] = [
  {
    color: 'violet',
    size: 0.9,
    opacity: 0.3,
    drift: 40,
    period: 19,
    parallax: 0.25,
    at: { today: [0.85, 0.05], budget: [0.15, 0.0], activity: [0.5, -0.02], wealth: [0.95, 0.35], settings: [0.9, 0.9], focus: [0.1, 0.1] },
  },
  {
    color: 'gold',
    size: 0.8,
    opacity: 0.2,
    drift: 55,
    period: 24,
    parallax: 0.15,
    at: { today: [0.05, 0.45], budget: [0.9, 0.45], activity: [0.0, 0.7], wealth: [0.05, 0.1], settings: [0.1, 0.2], focus: [0.95, 0.45] },
  },
  {
    color: 'indigo',
    size: 1.0,
    opacity: 0.24,
    drift: 60,
    period: 29,
    parallax: 0.08,
    at: { today: [0.7, 0.95], budget: [0.55, 1.0], activity: [0.95, 0.85], wealth: [0.3, 0.95], settings: [0.5, 0.5], focus: [0.4, 1.0] },
  },
  {
    color: 'orchid',
    size: 0.55,
    opacity: 0.1,
    drift: 35,
    period: 33,
    parallax: 0.05,
    at: { today: [0.1, 0.95], budget: [0.05, 0.75], activity: [0.1, 0.25], wealth: [0.9, 0.9], settings: [0.95, 0.05], focus: [0.85, 0.95] },
  },
];

function Halo({ spec, width, height, current, gain }: { spec: HaloSpec; width: number; height: number; current: Mood; gain: number }) {
  const t = useTheme();
  const { scrollY } = useScroll();
  const parallax = useTransform(scrollY, (y) => -y * spec.parallax);
  const d = Math.max(width, height) * spec.size;
  const [fx, fy] = spec.at[current];
  const boost = (t.scheme === 'light' ? 1.6 : 1) * gain;
  const color = t.halos[spec.color];
  const gradient = `radial-gradient(circle at center, ${withAlpha(color, spec.opacity * boost)} 0%, ${withAlpha(color, spec.opacity * 0.45 * boost)} 45%, ${withAlpha(color, 0)} 70%)`;
  return (
    <m.div className="absolute left-0 top-0" style={{ width: d, height: d }} initial={false} animate={{ x: fx * width - d / 2, y: fy * height - d / 2 }} transition={springs.soft}>
      <m.div className="h-full w-full" style={{ y: parallax }}>
        <div className="halo-drift h-full w-full rounded-full" style={{ background: gradient, ['--drift' as string]: `${spec.drift}px`, ['--period' as string]: `${spec.period}s`, animationDelay: `-${spec.period / 3}s` }} />
      </m.div>
    </m.div>
  );
}

/** Intensité des halos selon l'identité : aucune pour les fonds pleins (Ardoise, Brut). */
const HALO_GAIN: Record<StyleId, number> = { lumen: 1, circuit: 0.55, ardoise: 0, argile: 1.25, brut: 0 };

export function Backdrop() {
  const width = useWindowWidth();
  const height = useWindowHeight();
  const current = useMood();
  const ambient = useAmbient();
  const style = useTheme().style;
  const gain = HALO_GAIN[style];
  return (
    // Découpé : les halos sont plus grands que l'écran. Sans ça, un navigateur mobile élargirait la page.
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" style={{ background: 'linear-gradient(180deg, var(--field-0), var(--field-1) 55%, var(--field-2))' }}>
      {gain > 0 && HALOS.map((h) => <Halo key={h.color} spec={h} width={width} height={height} current={current} gain={gain} />)}
      {/* Lumière d'état (budget) : monte et s'éteint en fondu. */}
      <m.div
        className="absolute inset-x-0 top-0"
        style={{ height: '70%', background: `radial-gradient(90% 70% at 50% 0%, color-mix(in srgb, var(--${ambient ?? 'accent'}) 30%, transparent), transparent 70%)` }}
        initial={false}
        animate={{ opacity: ambient && style !== 'brut' ? (style === 'ardoise' ? 0.45 : 1) : 0 }}
        transition={{ duration: 1.2, ease: 'easeOut' }}
      />
      {/* Vignette : bords calmes, texte lisible. */}
      <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, var(--veil-0) 35%, var(--veil-1) 100%)' }} />
      <Texture style={style} />
    </div>
  );
}

const FADE_TOP = 'radial-gradient(ellipse 140% 85% at 50% 0%, #000 0%, rgba(0,0,0,0.35) 55%, transparent 90%)';

/** Ce qui fait la matière du fond, propre à chaque identité. */
function Texture({ style }: { style: StyleId }) {
  switch (style) {
    // Trame de points, nette autour du verre et adoucie dessous : c'est elle qui fait lire le flou.
    case 'lumen':
      return <div className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(circle, var(--grid) 1.2px, transparent 1.7px)', backgroundSize: '22px 22px', WebkitMaskImage: FADE_TOP, maskImage: FADE_TOP }} />;
    // Grille de tracé néon qui s'efface vers le bas, horizon lumineux et lignes de balayage.
    case 'circuit':
      return (
        <>
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: 'linear-gradient(color-mix(in srgb, var(--accent) 13%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--accent) 13%, transparent) 1px, transparent 1px)',
              backgroundSize: '36px 36px',
              backgroundPosition: '-1px -1px',
              WebkitMaskImage: FADE_TOP,
              maskImage: FADE_TOP,
            }}
          />
          <div className="absolute inset-x-0 top-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, var(--accent), transparent)', boxShadow: '0 0 18px 2px var(--accent-glow)' }} />
          <div className="absolute inset-0" style={{ backgroundImage: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.22) 0 1px, transparent 1px 3px)' }} />
        </>
      );
    // Papier : une trame de points noirs nette, régulière jusqu'en bas.
    case 'brut':
      return <div className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(circle, rgba(10,10,10,0.2) 1.1px, transparent 1.5px)', backgroundSize: '20px 20px' }} />;
    default:
      return null;
  }
}
