import { SEEDS, SERIES_HUES, TEXT_ALPHA, THEMES, type LumenSeed, type ThemeId, type ThemeInfo } from '../vendor/lumen';
import { BASE_PALETTES, type Palette } from './theme';

// Thèmes, graines et niveaux de texte : partagés avec MyPerf (MyLife/packages/lumen).
export { isThemeId, SEEDS, THEME_IDS, THEMES, type ThemeId, type ThemeInfo } from '../vendor/lumen';

/**
 * Thèmes de couleur. Toutes les couleurs de l'app viennent d'une Palette (theme.ts) : les écrans
 * n'écrivent jamais de couleur. Nuit et Perle sont les palettes Lumen d'origine ; les autres sont
 * construites à partir d'une petite graine par les mêmes règles, si bien que le verre, la profondeur
 * et le sens (validé, précieux, alerte, danger) se lisent de la même façon dans tous les thèmes.
 * Chaque thème a un équivalent dans l'autre mode, utilisé quand l'app suit le téléphone.
 */

/** "#A88BFF" → "168,139,255" (pour rgba()). */
function rgb(hex: string): string {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(',');
}
const a = (triplet: string, alpha: number) => `rgba(${triplet},${alpha})`;

/** La graine d'un thème : tout le reste en découle. */
export type Seed = LumenSeed;

export function darkPalette(s: Seed): Palette {
  const tint = rgb(s.tint);
  const ink = rgb(s.text);
  const sh = rgb(s.shadow);
  const b = s.bodies ?? { pane: '#1C1534', raised: '#241B42', float: '#18112E', lens: '#100B20' };
  return {
    scheme: 'dark',
    field: s.field,
    halos: s.halos,
    glass: {
      pane: {
        fill: a(tint, 0.05),
        solidFill: a(rgb(b.pane), 0.88),
        sheen: ['rgba(255,255,255,0.07)', 'rgba(255,255,255,0)'],
        rim: a(tint, 0.1),
        specular: 'rgba(255,255,255,0.15)',
        shadow: `0px 10px 30px ${a(sh, 0.35)}`,
        blur: 0,
      },
      raised: {
        fill: a(tint, 0.085),
        solidFill: a(rgb(b.raised), 0.93),
        sheen: ['rgba(255,255,255,0.11)', 'rgba(255,255,255,0)'],
        rim: a(tint, 0.16),
        specular: 'rgba(255,255,255,0.26)',
        shadow: `0px 18px 44px ${a(sh, 0.5)}`,
        blur: 0,
      },
      float: {
        fill: a(rgb(b.float), 0.55),
        solidFill: a(rgb(b.float), 0.97),
        sheen: ['rgba(255,255,255,0.10)', 'rgba(255,255,255,0.01)'],
        rim: a(tint, 0.17),
        specular: 'rgba(255,255,255,0.30)',
        shadow: `0px 22px 50px ${a(sh, 0.6)}`,
        blur: 42,
      },
      lens: {
        fill: a(rgb(b.lens), 0.7),
        solidFill: a(rgb(b.lens), 0.98),
        sheen: ['rgba(255,255,255,0.08)', 'rgba(255,255,255,0)'],
        rim: a(tint, 0.14),
        specular: 'rgba(255,255,255,0.22)',
        shadow: `0px -10px 60px ${a(sh, 0.65)}`,
        blur: 60,
      },
    },
    bg: s.bg,
    surface: a(tint, 0.055),
    surfaceAlt: a(tint, 0.085),
    surfacePressed: a(tint, 0.14),
    border: a(tint, 0.11),
    text: s.text,
    textSecondary: a(ink, TEXT_ALPHA.dark.secondary),
    textMuted: a(ink, TEXT_ALPHA.dark.muted),
    ghost: a(ink, 0.38),
    accent: s.accent,
    accentGradient: s.accentGradient,
    accentGlow: a(rgb(s.accentGradient[1]), 0.55),
    onAccent: s.onAccent,
    accentSoft: a(rgb(s.accent), 0.16),
    gold: s.gold,
    goldGradient: s.goldGradient,
    goldSoft: a(rgb(s.gold), 0.14),
    success: s.success,
    successSoft: a(rgb(s.success), 0.14),
    onSuccess: s.onSuccess,
    danger: s.danger,
    dangerSoft: a(rgb(s.danger), 0.14),
    warning: s.warning,
    warningSoft: a(rgb(s.warning), 0.14),
    info: s.info,
    infoSoft: a(rgb(s.info), 0.14),
    focus: s.accent,
    overlay: a(sh, 0.5),
    veil: [a(rgb(s.field[2]), 0), a(rgb(s.field[2]), 0.6)],
    statusVeil: a(rgb(s.bg), 0.3),
    well: 'rgba(0,0,0,0.22)',
    wellShade: 'rgba(0,0,0,0.35)',
    highlight: 'rgba(255,255,255,0.25)',
    knob: '#FFFFFF',
    shine: 'rgba(255,255,255,0.08)',
  };
}

export function lightPalette(s: Seed): Palette {
  const tint = rgb(s.tint);
  const ink = rgb(s.text);
  const sh = rgb(s.shadow);
  return {
    scheme: 'light',
    field: s.field,
    halos: s.halos,
    glass: {
      pane: {
        fill: 'rgba(255,255,255,0.62)',
        solidFill: 'rgba(255,255,255,0.92)',
        sheen: ['rgba(255,255,255,0.7)', 'rgba(255,255,255,0)'],
        rim: 'rgba(255,255,255,0.9)',
        specular: 'rgba(255,255,255,1)',
        shadow: `0px 8px 24px ${a(sh, 0.07)}`,
        blur: 0,
      },
      raised: {
        fill: 'rgba(255,255,255,0.78)',
        solidFill: 'rgba(255,255,255,0.96)',
        sheen: ['rgba(255,255,255,0.85)', 'rgba(255,255,255,0)'],
        rim: 'rgba(255,255,255,1)',
        specular: 'rgba(255,255,255,1)',
        shadow: `0px 14px 34px ${a(sh, 0.11)}`,
        blur: 0,
      },
      float: {
        fill: 'rgba(255,255,255,0.62)',
        solidFill: 'rgba(253,253,253,0.97)',
        sheen: ['rgba(255,255,255,0.75)', 'rgba(255,255,255,0.1)'],
        rim: 'rgba(255,255,255,0.95)',
        specular: 'rgba(255,255,255,1)',
        shadow: `0px 18px 44px ${a(sh, 0.15)}`,
        blur: 40,
      },
      lens: {
        fill: a(rgb(s.bg), 0.8),
        solidFill: a(rgb(s.bg), 0.99),
        sheen: ['rgba(255,255,255,0.85)', 'rgba(255,255,255,0)'],
        rim: 'rgba(255,255,255,1)',
        specular: 'rgba(255,255,255,1)',
        shadow: `0px -10px 60px ${a(sh, 0.18)}`,
        blur: 60,
      },
    },
    bg: s.bg,
    surface: 'rgba(255,255,255,0.65)',
    surfaceAlt: a(tint, 0.05),
    surfacePressed: a(tint, 0.09),
    border: a(tint, 0.1),
    text: s.text,
    textSecondary: a(ink, TEXT_ALPHA.light.secondary),
    textMuted: a(ink, TEXT_ALPHA.light.muted),
    ghost: a(ink, 0.45),
    accent: s.accent,
    accentGradient: s.accentGradient,
    accentGlow: a(rgb(s.accent), 0.36),
    onAccent: s.onAccent,
    accentSoft: a(rgb(s.accent), 0.1),
    gold: s.gold,
    goldGradient: s.goldGradient,
    goldSoft: a(rgb(s.gold), 0.13),
    success: s.success,
    successSoft: a(rgb(s.success), 0.1),
    onSuccess: s.onSuccess,
    danger: s.danger,
    dangerSoft: a(rgb(s.danger), 0.1),
    warning: s.warning,
    warningSoft: a(rgb(s.warning), 0.1),
    info: s.info,
    infoSoft: a(rgb(s.info), 0.1),
    focus: s.accent,
    overlay: a(sh, 0.22),
    veil: [a(rgb(s.field[2]), 0), a(rgb(s.field[2]), 0.55)],
    statusVeil: a(rgb(s.bg), 0.35),
    well: a(tint, 0.05),
    wellShade: a(tint, 0.08),
    highlight: 'rgba(255,255,255,0.6)',
    knob: '#FFFFFF',
    shine: 'rgba(255,255,255,0.7)',
  };
}



export function themeInfo(id: ThemeId): ThemeInfo {
  return THEMES.find((x) => x.id === id) ?? (THEMES[0] as ThemeInfo);
}

const built = new Map<ThemeId, Palette>();

/** La palette d'un thème (construite une seule fois). */
export function themePalette(id: ThemeId): Palette {
  if (id === 'nuit') return BASE_PALETTES.nuit;
  if (id === 'perle') return BASE_PALETTES.perle;
  const cached = built.get(id);
  if (cached !== undefined) return cached;
  const seed = SEEDS[id];
  const p = seed.scheme === 'dark' ? darkPalette(seed) : lightPalette(seed);
  built.set(id, p);
  return p;
}

/** Le thème réellement affiché : l'équivalent de l'autre mode quand on suit le téléphone. */
export function resolveThemeId(id: ThemeId, followSystem: boolean, system: 'dark' | 'light' | null | undefined): ThemeId {
  const info = themeInfo(id);
  return followSystem && system != null && system !== info.scheme ? info.pair : id;
}

export function resolvePalette(id: ThemeId, followSystem: boolean, system: 'dark' | 'light' | null | undefined): Palette {
  return themePalette(resolveThemeId(id, followSystem, system));
}

/** Teinte (0-360) et saturation (0-1) de "#RRGGBB". */
function hueSat(hex: string): { h: number; s: number } {
  const [r = 0, g = 0, b = 0] = rgb(hex)
    .split(',')
    .map((v) => Number(v) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return { h: 0, s: 0 };
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: d / (1 - Math.abs(max + min - 1)) };
}

/**
 * Couleurs catégorielles des graphiques (répartition d'un portefeuille, d'un patrimoine) :
 * ordre fixe, validé pour les daltonismes (dataviz validate_palette), sans les teintes trop proches
 * de l'accent (sélection) pour qu'une part ne ressemble jamais à un élément sélectionné.
 */

export function seriesColors(p: Palette): string[] {
  const accent = hueSat(p.accent);
  const far = (hex: string) => {
    if (accent.s < 0.25) return true;
    const d = Math.abs(hueSat(hex).h - accent.h);
    return Math.min(d, 360 - d) > 40;
  };
  return SERIES_HUES[p.scheme].filter(far);
}
