import plugin from 'tailwindcss/plugin';

/**
 * Préréglage Tailwind commun aux apps web MyLife. Tailwind ne connaît que des jetons Lumen : chaque
 * couleur est une variable CSS posée par le thème (theme.ts → cssVars). Aucune couleur littérale dans
 * les écrans. Chaque app : `presets: [lumen]` et sa propre liste `content`.
 */
const v = (name) => `var(--${name})`;

/** Taille de police qui suit le réglage du système, plafonnée (texte ×1,3, contrôles ×1,2). */
const size = (px, cap = 1.3) => `min(${px / 16}rem, ${Math.round(px * cap * 10) / 10}px)`;

/*
 * Échelle typographique. Familles, graisse des titres, approche et casse des étiquettes viennent de
 * l'identité du thème (variables posées par index.css selon <html data-style>).
 */
const TYPE = {
  // [famille, graisse, taille, interligne, approche, plafond]
  hero: ['display', 'var(--w-title)', 40, 46, 'calc(var(--track-k) * -1.2px)'],
  large: ['display', 'var(--w-title)', 30, 36, 'calc(var(--track-k) * -0.8px)'],
  title: ['display', 'var(--w-title2)', 20, 26, 'calc(var(--track-k) * -0.3px)'],
  headline: ['sans', 600, 17, 22, '-0.2px'],
  body: ['sans', 400, 15, 21, '0'],
  'body-strong': ['sans', 600, 15, 21, '0'],
  small: ['sans', 400, 13, 18, '0'],
  caption: ['sans', 500, 12, 16, '0'],
  label: ['label', 'var(--w-label)', 12, 16, 'var(--label-track)', 1.2],
  number: ['num', 600, 18, 22, 'calc(var(--track-k) * -0.3px)'],
};
const FAMILY = { display: 'var(--font-display)', sans: 'var(--font-body)', num: 'var(--font-num)', label: 'var(--font-label)' };

export default {
  // Classes composées dynamiquement (Metric : `text-${tone}`).
  safelist: ['text-danger', 'text-success', 'text-gold', 'text-accent', 'text-warning', 'text-info'],
  theme: {
    extend: {
      colors: {
        bg: v('bg'),
        ink: v('text'),
        secondary: v('text-secondary'),
        muted: v('text-muted'),
        ghost: v('ghost'),
        line: v('border'),
        well: v('well'),
        surface: { DEFAULT: v('surface'), alt: v('surface-alt'), pressed: v('surface-pressed') },
        accent: { DEFAULT: v('accent'), soft: v('accent-soft'), tint: v('accent-tint'), rim: v('accent-rim') },
        'on-accent': v('on-accent'),
        gold: { DEFAULT: v('gold'), soft: v('gold-soft'), rim: v('gold-rim') },
        success: { DEFAULT: v('success'), soft: v('success-soft'), rim: v('success-rim') },
        'on-success': v('on-success'),
        danger: { DEFAULT: v('danger'), soft: v('danger-soft'), rim: v('danger-rim') },
        warning: { DEFAULT: v('warning'), soft: v('warning-soft'), rim: v('warning-rim') },
        info: { DEFAULT: v('info'), soft: v('info-soft'), rim: v('info-rim') },
      },
      fontFamily: {
        sans: ['var(--font-body)'],
        display: ['var(--font-display)'],
        num: ['var(--font-num)'],
      },
      // Rayons de l'identité du thème (Lumen par défaut : 8 · 12 · 16 · 22 · 28).
      borderRadius: { xs: 'var(--r-xs)', sm: 'var(--r-sm)', md: 'var(--r-md)', lg: 'var(--r-lg)', xl: 'var(--r-xl)', pill: 'var(--r-pill)' },
      spacing: { 0.5: '2px', 18: '72px' },
      maxWidth: { content: '680px', 'content-md': '760px', 'content-lg': '1180px' },
    },
  },
  plugins: [
    plugin(({ addComponents }) => {
      const out = {};
      for (const [name, [family, weight, px, lh, track, cap]] of Object.entries(TYPE)) {
        out[`.t-${name}`] = {
          fontFamily: FAMILY[family],
          fontWeight: String(weight),
          fontSize: size(px, cap ?? 1.3),
          lineHeight: `${(lh / px).toFixed(3)}`,
          letterSpacing: track,
          ...(family === 'display' || family === 'num' ? { fontVariantNumeric: 'tabular-nums' } : {}),
          ...(family === 'label' ? { textTransform: 'var(--label-case)' } : {}),
        };
      }
      addComponents(out);
    }),
  ],
};
