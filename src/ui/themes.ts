import type { ThemeId } from '@/db/repos/settings';
import { SEEDS, TEXT_ALPHA, THEMES, type LumenSeed, type ThemeInfo } from '@/vendor/lumen';

import type { Palette } from './theme';

/**
 * Colour themes. Every colour of the app comes from a Palette (src/ui/theme.ts): screens never
 * write a colour. Nuit and Perle are the original Lumen palettes; the others are built from a
 * small seed by the same rules, so glass, depth and meaning (done, record, alert, danger) read
 * the same way in every theme. Each theme has a counterpart of the other scheme, used when the
 * app follows the phone's light / dark mode.
 */

/** "#A88BFF" → "168,139,255" (for rgba()). */
function rgb(hex: string): string {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(',');
}
const a = (triplet: string, alpha: number) => `rgba(${triplet},${alpha})`;

// Thèmes, graines et niveaux de texte : partagés avec MyFinances (MyLife/packages/lumen).
export { THEMES, type ThemeInfo };
type Seed = LumenSeed;

function darkPalette(s: Seed): Palette {
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
    completedRow: a(rgb(s.accent), 0.1),
    focus: s.accent,
    setType: { warmup: a(ink, 0.55), top_set: s.gold, backoff: s.info, working: s.accent, drop: s.drop },
    overlay: a(sh, 0.5),
    veil: [a(rgb(s.field[2]), 0), a(rgb(s.field[2]), 0.6)],
    statusVeil: a(rgb(s.bg), 0.3),
    blurTint: 'dark',
    well: 'rgba(0,0,0,0.22)',
    wellShade: 'rgba(0,0,0,0.35)',
    highlight: 'rgba(255,255,255,0.25)',
    knob: '#FFFFFF',
    mapIdle: a(tint, 0.1),
    mapRim: a(tint, 0.25),
    mapZero: a(tint, 0.18),
    shine: 'rgba(255,255,255,0.08)',
  };
}

function lightPalette(s: Seed): Palette {
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
    completedRow: a(rgb(s.accent), 0.07),
    focus: s.accent,
    setType: { warmup: a(ink, 0.5), top_set: s.gold, backoff: s.info, working: s.accent, drop: s.drop },
    overlay: a(sh, 0.22),
    veil: [a(rgb(s.field[2]), 0), a(rgb(s.field[2]), 0.55)],
    statusVeil: a(rgb(s.bg), 0.35),
    blurTint: 'light',
    well: a(tint, 0.05),
    wellShade: a(tint, 0.08),
    highlight: 'rgba(255,255,255,0.6)',
    knob: '#FFFFFF',
    mapIdle: a(tint, 0.08),
    mapRim: a(tint, 0.22),
    mapZero: a(tint, 0.12),
    shine: 'rgba(255,255,255,0.7)',
  };
}



export function themeInfo(id: ThemeId): ThemeInfo {
  return THEMES.find((x) => x.id === id) ?? (THEMES[0] as ThemeInfo);
}

const built = new Map<ThemeId, Palette>();

/** The palette of a theme (built once). `base` gives the two original Lumen palettes. */
export function paletteFor(id: ThemeId, base: { nuit: Palette; perle: Palette }): Palette {
  if (id === 'nuit') return base.nuit;
  if (id === 'perle') return base.perle;
  const cached = built.get(id);
  if (cached !== undefined) return cached;
  const seed = SEEDS[id];
  const p = seed.scheme === 'dark' ? darkPalette(seed) : lightPalette(seed);
  built.set(id, p);
  return p;
}

/** Hue (0-360) and saturation (0-1) of "#RRGGBB". */
function hueSat(hex: string): { h: number; s: number } {
  const [r = 0, g = 0, b = 0] = rgb(hex).split(',').map((v) => Number(v) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return { h: 0, s: 0 };
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: d / (1 - Math.abs(max + min - 1)) };
}

const BLOCK_HUES = {
  dark: ['#2DD4BF', '#FBBF24', '#F472B6', '#60A5FA', '#A3E635', '#FB923C', '#C084FC', '#F87171'],
  light: ['#0D9488', '#D97706', '#DB2777', '#2563EB', '#65A30D', '#EA580C', '#9333EA', '#DC2626'],
} as const;

/**
 * Colours that tell blocks / cycles apart on the calendar: a qualitative set, minus the hues too
 * close to the theme's accent (selection, today) so a cycle never looks like a selected day.
 */
export function blockColors(p: Palette): string[] {
  const accent = hueSat(p.accent);
  const far = (hex: string) => {
    if (accent.s < 0.25) return true;
    const d = Math.abs(hueSat(hex).h - accent.h);
    return Math.min(d, 360 - d) > 40;
  };
  return BLOCK_HUES[p.scheme].filter(far);
}
