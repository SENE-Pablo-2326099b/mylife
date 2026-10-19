import plugin from 'tailwindcss/plugin';

/**
 * Tailwind ne connaît que des jetons Lumen : chaque couleur est une variable CSS posée par le thème
 * (src/ui/theme.ts → cssVars). Aucune couleur littérale dans les écrans.
 */
const v = (name) => `var(--${name})`;

/** Taille de police qui suit le réglage du système, plafonnée (texte ×1,3, contrôles ×1,2). */
const size = (px, cap = 1.3) => `min(${px / 16}rem, ${Math.round(px * cap * 10) / 10}px)`;

const TYPE = {
  // [famille, graisse, taille, interligne, approche, plafond]
  hero: ['display', 700, 40, 46, '-1.2px'],
  large: ['display', 700, 30, 36, '-0.8px'],
  title: ['display', 600, 20, 26, '-0.3px'],
  headline: ['sans', 600, 17, 22, '-0.2px'],
  body: ['sans', 400, 15, 21, '0'],
  'body-strong': ['sans', 600, 15, 21, '0'],
  small: ['sans', 400, 13, 18, '0'],
  caption: ['sans', 500, 12, 16, '0'],
  label: ['sans', 600, 11, 14, '1.3px', 1.2],
  number: ['display', 600, 18, 22, '-0.3px'],
};

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
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
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['Sora', 'Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: { xs: '8px', sm: '12px', md: '16px', lg: '22px', xl: '28px', pill: '999px' },
      spacing: { 0.5: '2px', 18: '72px' },
      maxWidth: { content: '680px', 'content-md': '760px', 'content-lg': '1180px' },
    },
  },
  plugins: [
    plugin(({ addComponents }) => {
      const out = {};
      for (const [name, [family, weight, px, lh, track, cap]] of Object.entries(TYPE)) {
        out[`.t-${name}`] = {
          fontFamily: family === 'display' ? 'Sora, Inter, system-ui, sans-serif' : 'Inter, system-ui, sans-serif',
          fontWeight: String(weight),
          fontSize: size(px, cap ?? 1.3),
          lineHeight: `${(lh / px).toFixed(3)}`,
          letterSpacing: track,
          ...(name === 'label' ? { textTransform: 'uppercase' } : {}),
          ...(family === 'display' ? { fontVariantNumeric: 'tabular-nums' } : {}),
        };
      }
      addComponents(out);
    }),
  ],
};
