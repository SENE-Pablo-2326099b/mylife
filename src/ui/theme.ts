import { Platform, useColorScheme } from 'react-native';
import { create } from 'zustand';

import type { SetType } from '@/domain/types';
import type { ThemeId } from '@/db/repos/settings';
import { useSettings } from '@/state/settingsStore';
import { BASE_TEXT, STYLES, type StyleId } from '@/vendor/lumen';

import { paletteFor, themeInfo } from './themes';

/**
 * LUMEN — the design language of MyPerf.
 *
 * The app is made of glass floating over a field of light. Three ideas:
 * 1. Light lives in the background: soft halos (electric violet, gold, orchid, indigo) drift behind
 *    every screen; surfaces are tinted glass that lets it through. Light is information: violet
 *    lights up what is active, done or primary; gold marks what is precious (records, top sets).
 * 2. Glass has thickness, and thickness is hierarchy (see GlassLevel): content sits on thin panes,
 *    what you act on now is raised, navigation floats, sheets are lenses.
 * 3. Matter moves with inertia: springs, never linear tweens; depth and light change with state.
 *
 * Nuit (default): indigo night, luminous violet, warm gold. Perle: pearl white, electric violet,
 * gold. Six more themes are built from the same rules (src/ui/themes.ts). Screens take every
 * colour from the palette (useTheme), never a literal. Colours that get an alpha suffix
 * (`${color}AA`) must stay 6-digit hex.
 */

export type GlassLevel = 'pane' | 'raised' | 'float' | 'lens';

export interface GlassSpec {
  /** Fill drawn on top of the (optional) blur. */
  fill: string;
  /** Fill used where live blur is unavailable (Android): denser so content stays legible. */
  solidFill: string;
  /** Top-down sheen: light caught by the upper part of the glass. */
  sheen: [string, string];
  /** Hairline rim. */
  rim: string;
  /** Specular top edge (inset highlight). */
  specular: string;
  /** Drop shadow (CSS box-shadow syntax, supported natively by RN's new architecture). */
  shadow: string;
  blur: number;
}

export interface Palette {
  scheme: 'dark' | 'light';
  /** Identité visuelle (forme, matière, typographie) : voir applyIdentity et Glass. */
  style: StyleId;
  /** Base field behind everything (top → bottom). */
  field: [string, string, string];
  halos: { violet: string; gold: string; indigo: string; orchid: string };
  glass: Record<GlassLevel, GlassSpec>;

  // Semantic tokens (used across screens).
  bg: string;
  surface: string;
  surfaceAlt: string;
  surfacePressed: string;
  border: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  ghost: string;
  accent: string;
  /** Accent as a light source: the liquid fill of primary actions. */
  accentGradient: [string, string];
  accentGlow: string;
  onAccent: string;
  accentSoft: string;
  /** Precious things: records, top sets, the reference 1RM. */
  gold: string;
  goldGradient: [string, string];
  goldSoft: string;
  /** Done / validated / on target. */
  success: string;
  successSoft: string;
  /** Text / icon on a success fill. */
  onSuccess: string;
  danger: string;
  dangerSoft: string;
  warning: string;
  warningSoft: string;
  info: string;
  completedRow: string;
  focus: string;
  setType: Record<SetType, string>;
  overlay: string;
  /** Edge veils: bottom vignette of the field, status-bar wash. */
  veil: [string, string];
  statusVeil: string;
  blurTint: 'dark' | 'light';
  /** Etched input well (set cells, check box) and its inner shade. */
  well: string;
  wellShade: string;
  /** Top highlight caught by lit, raised things. */
  highlight: string;
  /** Switch knob. */
  knob: string;
  /** Body map: untrained region, outline, "0 sets" legend swatch. */
  mapIdle: string;
  mapRim: string;
  mapZero: string;
  /** Loading skeleton sweep. */
  shine: string;
}

const dark: Palette = {
  scheme: 'dark',
  style: 'lumen',
  field: ['#130C2A', '#0B0719', '#07050F'],
  halos: { violet: '#8B5CFF', gold: '#F2B84B', indigo: '#4C4DFF', orchid: '#D25BFF' },
  glass: {
    pane: {
      fill: 'rgba(205,190,255,0.05)',
      solidFill: 'rgba(28,21,52,0.88)',
      sheen: ['rgba(255,255,255,0.07)', 'rgba(255,255,255,0)'],
      rim: 'rgba(214,200,255,0.10)',
      specular: 'rgba(255,255,255,0.15)',
      shadow: '0px 10px 30px rgba(4,2,12,0.35)',
      blur: 0,
    },
    raised: {
      fill: 'rgba(205,190,255,0.085)',
      solidFill: 'rgba(36,27,66,0.93)',
      sheen: ['rgba(255,255,255,0.11)', 'rgba(255,255,255,0)'],
      rim: 'rgba(214,200,255,0.16)',
      specular: 'rgba(255,255,255,0.26)',
      shadow: '0px 18px 44px rgba(4,2,12,0.5)',
      blur: 0,
    },
    float: {
      fill: 'rgba(24,17,46,0.55)',
      solidFill: 'rgba(24,17,46,0.97)',
      sheen: ['rgba(255,255,255,0.10)', 'rgba(255,255,255,0.01)'],
      rim: 'rgba(214,200,255,0.17)',
      specular: 'rgba(255,255,255,0.30)',
      shadow: '0px 22px 50px rgba(4,2,12,0.6)',
      blur: 42,
    },
    lens: {
      fill: 'rgba(16,11,32,0.7)',
      solidFill: 'rgba(16,11,32,0.98)',
      sheen: ['rgba(255,255,255,0.08)', 'rgba(255,255,255,0)'],
      rim: 'rgba(214,200,255,0.14)',
      specular: 'rgba(255,255,255,0.22)',
      shadow: '0px -10px 60px rgba(4,2,12,0.65)',
      blur: 60,
    },
  },
  bg: '#0B0719',
  surface: 'rgba(205,190,255,0.055)',
  surfaceAlt: 'rgba(205,190,255,0.085)',
  surfacePressed: 'rgba(205,190,255,0.14)',
  border: 'rgba(214,200,255,0.11)',
  text: BASE_TEXT.nuit.text,
  textSecondary: BASE_TEXT.nuit.secondary,
  textMuted: BASE_TEXT.nuit.muted,
  ghost: 'rgba(222,214,250,0.36)',
  accent: '#A88BFF',
  accentGradient: ['#B9A0FF', '#7340FF'],
  accentGlow: 'rgba(139,92,255,0.55)',
  onAccent: '#FFFFFF',
  accentSoft: 'rgba(150,115,255,0.16)',
  gold: '#F5C451',
  goldGradient: ['#FFE39A', '#E6A82E'],
  goldSoft: 'rgba(245,196,81,0.14)',
  success: '#4FDB9A',
  successSoft: 'rgba(79,219,154,0.14)',
  onSuccess: '#05261A',
  danger: '#FF6B86',
  dangerSoft: 'rgba(255,107,134,0.14)',
  warning: '#FF9F4A',
  warningSoft: 'rgba(255,159,74,0.14)',
  info: '#7EA6FF',
  completedRow: 'rgba(150,115,255,0.10)',
  focus: '#A88BFF',
  setType: { warmup: '#9C95B8', top_set: '#F5C451', backoff: '#7EA6FF', working: '#A88BFF', drop: '#E07BFF' },
  overlay: 'rgba(5,3,12,0.5)',
  veil: ['rgba(7,5,15,0)', 'rgba(7,5,15,0.6)'],
  statusVeil: 'rgba(11,7,25,0.3)',
  blurTint: 'dark',
  well: 'rgba(0,0,0,0.22)',
  wellShade: 'rgba(0,0,0,0.35)',
  highlight: 'rgba(255,255,255,0.25)',
  knob: '#FFFFFF',
  mapIdle: 'rgba(214,200,255,0.10)',
  mapRim: 'rgba(214,200,255,0.25)',
  mapZero: 'rgba(214,200,255,0.18)',
  shine: 'rgba(255,255,255,0.08)',
};

const light: Palette = {
  scheme: 'light',
  style: 'lumen',
  field: ['#FFFFFF', '#F8F6FF', '#F1ECFF'],
  halos: { violet: '#B49BFF', gold: '#FFD66E', indigo: '#A9B6FF', orchid: '#EBA8FF' },
  glass: {
    pane: {
      fill: 'rgba(255,255,255,0.62)',
      solidFill: 'rgba(255,255,255,0.92)',
      sheen: ['rgba(255,255,255,0.7)', 'rgba(255,255,255,0)'],
      rim: 'rgba(255,255,255,0.9)',
      specular: 'rgba(255,255,255,1)',
      shadow: '0px 8px 24px rgba(64,30,150,0.06)',
      blur: 0,
    },
    raised: {
      fill: 'rgba(255,255,255,0.78)',
      solidFill: 'rgba(255,255,255,0.96)',
      sheen: ['rgba(255,255,255,0.85)', 'rgba(255,255,255,0)'],
      rim: 'rgba(255,255,255,1)',
      specular: 'rgba(255,255,255,1)',
      shadow: '0px 14px 34px rgba(64,30,150,0.10)',
      blur: 0,
    },
    float: {
      fill: 'rgba(255,255,255,0.62)',
      solidFill: 'rgba(252,250,255,0.97)',
      sheen: ['rgba(255,255,255,0.75)', 'rgba(255,255,255,0.1)'],
      rim: 'rgba(255,255,255,0.95)',
      specular: 'rgba(255,255,255,1)',
      shadow: '0px 18px 44px rgba(64,30,150,0.14)',
      blur: 40,
    },
    lens: {
      fill: 'rgba(250,248,255,0.8)',
      solidFill: 'rgba(250,248,255,0.99)',
      sheen: ['rgba(255,255,255,0.85)', 'rgba(255,255,255,0)'],
      rim: 'rgba(255,255,255,1)',
      specular: 'rgba(255,255,255,1)',
      shadow: '0px -10px 60px rgba(64,30,150,0.17)',
      blur: 60,
    },
  },
  bg: '#F8F6FF',
  surface: 'rgba(255,255,255,0.65)',
  surfaceAlt: 'rgba(60,30,140,0.05)',
  surfacePressed: 'rgba(60,30,140,0.09)',
  border: 'rgba(60,30,140,0.09)',
  text: BASE_TEXT.perle.text,
  textSecondary: BASE_TEXT.perle.secondary,
  textMuted: BASE_TEXT.perle.muted,
  ghost: 'rgba(22,16,50,0.44)',
  accent: '#6C2BFF',
  accentGradient: ['#9466FF', '#6420FF'],
  accentGlow: 'rgba(108,43,255,0.38)',
  onAccent: '#FFFFFF',
  accentSoft: 'rgba(108,43,255,0.10)',
  gold: '#9E6E00',
  goldGradient: ['#FFE08A', '#E3A72F'],
  goldSoft: 'rgba(214,160,30,0.14)',
  success: '#0B8F5A',
  successSoft: 'rgba(11,143,90,0.1)',
  onSuccess: '#FFFFFF',
  danger: '#E0294F',
  dangerSoft: 'rgba(224,41,79,0.1)',
  warning: '#D2560C',
  warningSoft: 'rgba(210,86,12,0.1)',
  info: '#3F5BFF',
  completedRow: 'rgba(108,43,255,0.07)',
  focus: '#6C2BFF',
  setType: { warmup: '#8A84A6', top_set: '#9E6E00', backoff: '#3F5BFF', working: '#6C2BFF', drop: '#B62BD9' },
  overlay: 'rgba(30,16,70,0.22)',
  veil: ['rgba(241,236,255,0)', 'rgba(241,236,255,0.55)'],
  statusVeil: 'rgba(248,246,255,0.35)',
  blurTint: 'light',
  well: 'rgba(16,24,48,0.05)',
  wellShade: 'rgba(0,0,0,0.08)',
  highlight: 'rgba(255,255,255,0.6)',
  knob: '#FFFFFF',
  mapIdle: 'rgba(60,30,140,0.08)',
  mapRim: 'rgba(60,30,140,0.22)',
  mapZero: 'rgba(60,30,140,0.12)',
  shine: 'rgba(255,255,255,0.7)',
};

const BASE = { nuit: dark, perle: light };

/** The palette of a theme id, following the phone's scheme when asked (counterpart theme). */
export function resolvePalette(id: ThemeId, followSystem: boolean, system: 'dark' | 'light' | null | undefined): Palette {
  const info = themeInfo(id);
  const chosen = followSystem && system != null && system !== info.scheme ? info.pair : id;
  return paletteFor(chosen, BASE);
}

/**
 * Thème réellement affiché. Il suit le réglage, mais ne bascule qu'une fois les polices de la nouvelle
 * identité chargées (RootLayout) : jamais un écran à moitié dans l'ancien style.
 */
export const useShownTheme = create<{ id: ThemeId | null }>(() => ({ id: null }));

export function useTheme(): Palette {
  const chosen = useSettings((s) => s.settings.theme);
  const shown = useShownTheme((s) => s.id);
  const followSystem = useSettings((s) => s.settings.followSystem);
  const system = useColorScheme();
  return resolvePalette(shown ?? chosen, followSystem, system === 'unspecified' ? null : system);
}

/** The palette of a theme as such (theme picker previews). */
export function themePalette(id: ThemeId): Palette {
  return paletteFor(id, BASE);
}

/** Background of the default theme, for the very first frame (before settings load). */
export const BOOT_BG = dark.bg;

/** Live blur is used where it is cheap and reliable (iOS, web); Android gets denser tinted glass. */
export const LIVE_BLUR = Platform.OS === 'ios' || Platform.OS === 'web';

/**
 * Box shadows, Android-aware. Android draws every blurred and inset shadow per view on each frame
 * (nothing is cached), which made scrolling and navigation stutter: there, inset shadows (a hairline
 * of light, barely visible) are dropped, and so are glows on repeated items (rows, chips, bars).
 */
export function shade(css: string | undefined, repeated = false): string | undefined {
  if (css === undefined || Platform.OS !== 'android') return css;
  if (repeated) return undefined;
  const outer = css
    .split(/,(?![^(]*\))/)
    .map((part) => part.trim())
    .filter((part) => !part.startsWith('inset'));
  return outer.length === 0 ? undefined : outer.join(', ');
}

export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;
/**
 * Rayons et familles de caractères de l'identité du thème. Ce sont des objets modifiés en place par
 * applyIdentity (racine de l'app) avant le rendu : les écrans les lisent au rendu, et useTheme rend
 * une nouvelle palette à chaque changement, donc tout ce qui en dépend se redessine.
 */
export const radius: { xs: number; sm: number; md: number; lg: number; xl: number; pill: number } = { xs: 8, sm: 12, md: 16, lg: 22, xl: 28, pill: 999 };

/** Type families (loaded in the root layout). Lumen : Sora (titres, chiffres) + Inter (interface). */
type Families = { display: string; displaySemi: string; number: string; regular: string; medium: string; semibold: string; bold: string; label: string };
export const family: Families = {
  display: 'Sora_700Bold',
  displaySemi: 'Sora_600SemiBold',
  number: 'Sora_600SemiBold',
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  label: 'Inter_500Medium',
};

const RADII: Record<StyleId, typeof radius> = {
  lumen: { xs: 8, sm: 12, md: 16, lg: 22, xl: 28, pill: 999 },
  circuit: { xs: 2, sm: 3, md: 4, lg: 6, xl: 8, pill: 4 },
  ardoise: { xs: 4, sm: 6, md: 8, lg: 10, xl: 12, pill: 6 },
  argile: { xs: 12, sm: 18, md: 22, lg: 30, xl: 36, pill: 999 },
  brut: { xs: 4, sm: 6, md: 8, lg: 10, xl: 12, pill: 999 },
};
const FAMILIES: Record<StyleId, Families> = {
  lumen: { ...family },
  circuit: { display: 'SpaceGrotesk_700Bold', displaySemi: 'SpaceGrotesk_600SemiBold', number: 'JetBrainsMono_600SemiBold', regular: 'Inter_400Regular', medium: 'Inter_500Medium', semibold: 'Inter_600SemiBold', bold: 'Inter_700Bold', label: 'JetBrainsMono_600SemiBold' },
  ardoise: { display: 'IBMPlexSans_600SemiBold', displaySemi: 'IBMPlexSans_600SemiBold', number: 'IBMPlexMono_600SemiBold', regular: 'IBMPlexSans_400Regular', medium: 'IBMPlexSans_500Medium', semibold: 'IBMPlexSans_600SemiBold', bold: 'IBMPlexSans_700Bold', label: 'IBMPlexSans_500Medium' },
  argile: { display: 'Nunito_800ExtraBold', displaySemi: 'Nunito_800ExtraBold', number: 'Nunito_700Bold', regular: 'Nunito_500Medium', medium: 'Nunito_600SemiBold', semibold: 'Nunito_700Bold', bold: 'Nunito_800ExtraBold', label: 'Nunito_700Bold' },
  brut: { display: 'Archivo_900Black', displaySemi: 'Archivo_800ExtraBold', number: 'SpaceGrotesk_700Bold', regular: 'SpaceGrotesk_400Regular', medium: 'SpaceGrotesk_500Medium', semibold: 'SpaceGrotesk_600SemiBold', bold: 'SpaceGrotesk_700Bold', label: 'SpaceGrotesk_700Bold' },
};

/** Ce que l'identité change dans la typographie : capitales des étiquettes et des grands titres, approche. */
export const identity = { style: 'lumen' as StyleId, upperLabels: false, upperTitles: false, tracking: 1 };

/** Pose l'identité d'un style (rayons, familles) ; `fonts` : ses polices sont chargées. */
export function applyIdentity(style: StyleId, fonts: boolean): void {
  Object.assign(radius, RADII[style]);
  Object.assign(family, fonts ? FAMILIES[style] : FAMILIES.lumen);
  const st = STYLES[style];
  identity.style = style;
  identity.upperLabels = st.labelCase === 'upper';
  identity.upperTitles = style === 'circuit' || style === 'brut';
  identity.tracking = style === 'lumen' ? 1 : style === 'brut' ? 1.1 : 0.55;
}

export const font = {
  caption: 12,
  small: 13,
  body: 15,
  input: 18,
  title: 20,
  large: 30,
  hero: 40,
} as const;

/** Minimum touch target — sweaty fingers. */
export const HIT = 44;
