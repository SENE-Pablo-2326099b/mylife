/**
 * LUMEN — le langage visuel de l'app (repris de MyPerf).
 *
 * L'interface est faite de verre flottant au-dessus d'un champ de lumière :
 * 1. La lumière vit dans le fond : des halos (violet électrique, or, indigo, orchidée) dérivent
 *    derrière tous les écrans ; les surfaces sont du verre teinté qui la laisse passer.
 *    La lumière est une information : le violet éclaire ce qui est actif, validé ou principal ;
 *    l'or marque ce qui est précieux (objectifs atteints, records, top).
 * 2. L'épaisseur du verre est la hiérarchie (GlassLevel) : le contenu est sur des vitres fines (pane),
 *    ce sur quoi on agit est surélevé (raised), la navigation flotte (float), les feuilles sont des lentilles (lens).
 * 3. La matière bouge avec inertie : ressorts, jamais d'interpolation linéaire.
 *
 * Les écrans prennent toutes leurs couleurs dans la palette (jetons CSS `var(--…)` via Tailwind,
 * ou `useTheme()` pour le SVG), jamais une couleur littérale. Les couleurs qui reçoivent un suffixe
 * alpha (`${color}AA`) doivent rester en hexadécimal à 6 chiffres.
 */

export type GlassLevel = 'pane' | 'raised' | 'float' | 'lens';

export interface GlassSpec {
  /** Remplissage posé sur le flou (éventuel). */
  fill: string;
  /** Remplissage quand le flou réel n'est pas utilisé (Android) : plus dense pour rester lisible. */
  solidFill: string;
  /** Reflet du haut vers le bas : la lumière captée par le haut de la plaque. */
  sheen: [string, string];
  /** Bord fin (hairline). */
  rim: string;
  /** Liseré spéculaire du bord supérieur (ombre interne d'1 px). */
  specular: string;
  /** Ombre portée (syntaxe box-shadow). */
  shadow: string;
  blur: number;
}

export interface Palette {
  scheme: 'dark' | 'light';
  /** Champ de fond (haut → bas). */
  field: [string, string, string];
  halos: { violet: string; gold: string; indigo: string; orchid: string };
  glass: Record<GlassLevel, GlassSpec>;

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
  /** L'accent comme source de lumière : le remplissage liquide des actions principales. */
  accentGradient: [string, string];
  accentGlow: string;
  onAccent: string;
  accentSoft: string;
  /** Ce qui est précieux : objectifs atteints, records, meilleure catégorie. */
  gold: string;
  goldGradient: [string, string];
  goldSoft: string;
  /** Revenus, budget respecté, validé. */
  success: string;
  successSoft: string;
  onSuccess: string;
  /** Dépassement, dépense au-dessus du budget. */
  danger: string;
  dangerSoft: string;
  /** Budget presque atteint. */
  warning: string;
  warningSoft: string;
  info: string;
  infoSoft: string;
  focus: string;
  overlay: string;
  /** Voiles des bords : vignette basse du champ, voile de la barre d'état. */
  veil: [string, string];
  statusVeil: string;
  /** Puits de saisie gravé et son ombre interne. */
  well: string;
  wellShade: string;
  /** Lumière du bord supérieur des éléments allumés. */
  highlight: string;
  /** Bouton des interrupteurs. */
  knob: string;
  /** Balayage lumineux des squelettes de chargement. */
  shine: string;
}

const dark: Palette = {
  scheme: 'dark',
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
  text: '#F6F3FF',
  textSecondary: 'rgba(232,226,255,0.68)',
  textMuted: 'rgba(222,214,250,0.44)',
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
  infoSoft: 'rgba(126,166,255,0.14)',
  focus: '#A88BFF',
  overlay: 'rgba(5,3,12,0.5)',
  veil: ['rgba(7,5,15,0)', 'rgba(7,5,15,0.6)'],
  statusVeil: 'rgba(11,7,25,0.3)',
  well: 'rgba(0,0,0,0.22)',
  wellShade: 'rgba(0,0,0,0.35)',
  highlight: 'rgba(255,255,255,0.25)',
  knob: '#FFFFFF',
  shine: 'rgba(255,255,255,0.08)',
};

const light: Palette = {
  scheme: 'light',
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
  text: '#161032',
  textSecondary: 'rgba(22,16,50,0.64)',
  textMuted: 'rgba(22,16,50,0.52)',
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
  infoSoft: 'rgba(63,91,255,0.1)',
  focus: '#6C2BFF',
  overlay: 'rgba(30,16,70,0.22)',
  veil: ['rgba(241,236,255,0)', 'rgba(241,236,255,0.55)'],
  statusVeil: 'rgba(248,246,255,0.35)',
  well: 'rgba(16,24,48,0.05)',
  wellShade: 'rgba(0,0,0,0.08)',
  highlight: 'rgba(255,255,255,0.6)',
  knob: '#FFFFFF',
  shine: 'rgba(255,255,255,0.7)',
};

/** Les deux palettes Lumen d'origine ; les autres thèmes en sont dérivés (themes.ts). */
export const BASE_PALETTES = { nuit: dark, perle: light };

/** Fond du thème par défaut, pour la toute première image (avant le chargement des réglages). */
export const BOOT_BG = dark.bg;

export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;
export const radius = { xs: 8, sm: 12, md: 16, lg: 22, xl: 28, pill: 999 } as const;

/** Échelle typographique (px). Sora : titres et chiffres ; Inter : interface. */
export const font = { caption: 12, small: 13, body: 15, input: 18, title: 20, large: 30, hero: 40 } as const;

/** Zone tactile minimale. */
export const HIT = 44;

const TONES = ['accent', 'gold', 'success', 'danger', 'warning', 'info'] as const;
export type Tone = (typeof TONES)[number];

/** La palette en variables CSS (appliquées sur <html>) : Tailwind et les classes de verre les lisent. */
export function cssVars(p: Palette): Record<string, string> {
  const v: Record<string, string> = {
    '--bg': p.bg,
    '--field-0': p.field[0],
    '--field-1': p.field[1],
    '--field-2': p.field[2],
    '--surface': p.surface,
    '--surface-alt': p.surfaceAlt,
    '--surface-pressed': p.surfacePressed,
    '--border': p.border,
    '--text': p.text,
    '--text-secondary': p.textSecondary,
    '--text-muted': p.textMuted,
    '--ghost': p.ghost,
    '--accent': p.accent,
    '--accent-g0': p.accentGradient[0],
    '--accent-g1': p.accentGradient[1],
    '--accent-glow': p.accentGlow,
    '--on-accent': p.onAccent,
    '--accent-soft': p.accentSoft,
    '--gold': p.gold,
    '--gold-g0': p.goldGradient[0],
    '--gold-g1': p.goldGradient[1],
    '--gold-soft': p.goldSoft,
    '--success': p.success,
    '--success-soft': p.successSoft,
    '--on-success': p.onSuccess,
    '--danger': p.danger,
    '--danger-soft': p.dangerSoft,
    '--warning': p.warning,
    '--warning-soft': p.warningSoft,
    '--info': p.info,
    '--info-soft': p.infoSoft,
    '--focus': p.focus,
    '--overlay': p.overlay,
    '--veil-0': p.veil[0],
    '--veil-1': p.veil[1],
    '--status-veil': p.statusVeil,
    '--well': p.well,
    '--well-shade': p.wellShade,
    '--highlight': p.highlight,
    '--knob': p.knob,
    '--shine': p.shine,
  };
  for (const level of ['pane', 'raised', 'float', 'lens'] as const) {
    const g = p.glass[level];
    v[`--glass-${level}-fill`] = g.fill;
    v[`--glass-${level}-solid`] = g.solidFill;
    v[`--glass-${level}-sheen0`] = g.sheen[0];
    v[`--glass-${level}-sheen1`] = g.sheen[1];
    v[`--glass-${level}-rim`] = g.rim;
    v[`--glass-${level}-spec`] = g.specular;
    v[`--glass-${level}-shadow`] = g.shadow;
    v[`--glass-${level}-blur`] = `${g.blur}px`;
  }
  // Teintes dérivées de chaque couleur porteuse de sens : lavis du verre, bord, lueur.
  for (const tone of TONES) {
    const hex = p[tone];
    v[`--${tone}-wash0`] = `${hex}2E`;
    v[`--${tone}-wash1`] = `${hex}08`;
    v[`--${tone}-rim`] = `${hex}55`;
    v[`--${tone}-rim-strong`] = `${hex}88`;
    v[`--${tone}-tint`] = `${hex}24`;
    v[`--${tone}-halo`] = `${hex}40`;
  }
  return v;
}

/** "#A88BFF" + alpha → "rgba(168,139,255,a)". */
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `rgba(${r},${g},${b},${alpha})`;
}
