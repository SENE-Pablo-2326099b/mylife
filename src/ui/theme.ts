/**
 * Thème de myRaveLoc à partir de Lumen, sans dupliquer le moteur de thèmes des autres apps.
 *
 * - On suit le thème choisi dans MyLife (`mylife:appearance`, partagé par l'adresse commune).
 * - L'app est faite pour la nuit et la foule : toujours sombre. Un thème clair est remplacé par sa
 *   paire sombre (Perle → Nuit, Glacier → Océan…) ; les identités claires sans paire (Argile, Brut)
 *   retombent sur Nuit.
 * - Les couleurs viennent directement des graines Lumen (fond, texte, états) ; les niveaux de texte de
 *   TEXT_ALPHA ; les rayons et la casse des étiquettes de STYLES. L'identité propre de myRaveLoc (la
 *   balise et la flèche) est sa couleur d'app du registre MYLIFE_APPS, la même dans tous les thèmes.
 */
import { MYLIFE_APPS, readSharedAppearance, SEEDS, styleOf, TEXT_ALPHA, THEMES, BASE_TEXT, type ThemeId } from '../vendor/lumen';

interface Tokens {
  bg: string;
  field: [string, string, string];
  text: string;
  accent: string;
  onAccent: string;
  success: string;
  danger: string;
  warning: string;
  info: string;
  tint: string;
  card: string;
  raised: string;
}

/** Nuit est écrit à la main dans les apps (pas de graine) : on en reprend les valeurs de MyFinances. */
const NUIT: Tokens = {
  bg: '#0B0719',
  field: ['#130C2A', '#0B0719', '#07050F'],
  text: BASE_TEXT.nuit.text,
  accent: '#A88BFF',
  onAccent: '#FFFFFF',
  success: '#4FDB9A',
  danger: '#FF6B86',
  warning: '#FF9F4A',
  info: '#7EA6FF',
  tint: '#D6C8FF',
  card: '#1C1534',
  raised: '#241B42',
};

export function darkThemeFor(id: ThemeId | null | undefined): ThemeId {
  const info = THEMES.find((t) => t.id === id);
  if (!info) return 'nuit';
  if (info.scheme === 'dark') return info.id;
  const pair = THEMES.find((t) => t.id === info.pair);
  return pair && pair.scheme === 'dark' ? pair.id : 'nuit';
}

function tokensOf(id: ThemeId): Tokens {
  if (id === 'nuit' || id === 'perle') return NUIT;
  const s = SEEDS[id];
  if (s.scheme !== 'dark' || !s.bodies) return NUIT;
  return {
    bg: s.bg,
    field: s.field,
    text: s.text,
    accent: s.accent,
    onAccent: s.onAccent,
    success: s.success,
    danger: s.danger,
    warning: s.warning,
    info: s.info,
    tint: s.tint,
    card: s.bodies.pane,
    raised: s.bodies.raised,
  };
}

const alpha = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

export const BRAND = MYLIFE_APPS.find((a) => a.id === 'raveloc')!.colors;

export function applyTheme(): ThemeId {
  const id = darkThemeFor(readSharedAppearance()?.theme);
  const t = tokensOf(id);
  const style = styleOf(id);
  const root = document.documentElement;
  const vars: Record<string, string> = {
    '--bg': t.bg,
    '--field-0': t.field[0],
    '--field-1': t.field[1],
    '--field-2': t.field[2],
    '--text': t.text,
    '--text-2': alpha(t.text.length === 7 ? t.text : '#FFFFFF', TEXT_ALPHA.dark.secondary + 0.08),
    '--text-3': alpha(t.text.length === 7 ? t.text : '#FFFFFF', TEXT_ALPHA.dark.muted + 0.1),
    '--accent': t.accent,
    '--on-accent': t.onAccent,
    '--ok': t.success,
    '--danger': t.danger,
    '--warn': t.warning,
    '--info': t.info,
    '--card': t.card,
    '--raised': t.raised,
    '--line': alpha(t.tint, 0.16),
    '--line-strong': alpha(t.tint, 0.3),
    '--brand-a': BRAND[0],
    '--brand-b': BRAND[1],
    '--r-card': `${Math.min(style.radius.card, 24)}px`,
    '--r-control': `${Math.min(style.radius.control, 18)}px`,
    '--r-chip': `${Math.min(style.radius.chip, 999)}px`,
    '--label-case': style.labelCase === 'upper' ? 'uppercase' : 'none',
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.dataset.theme = id;
  root.dataset.style = style.id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t.bg);
  return id;
}
