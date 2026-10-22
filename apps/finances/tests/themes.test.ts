import { describe, expect, it } from 'vitest';
import { cssVars } from '../src/ui/theme';
import { resolvePalette, seriesColors, THEME_IDS, themePalette, THEMES } from '../src/ui/themes';

/** Couleur [r, g, b, a] depuis "#RRGGBB" ou "rgba(r,g,b,a)". */
function parse(c: string): [number, number, number, number] {
  if (c.startsWith('#')) {
    const h = c.slice(1);
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1) as [number, number, number, number];
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  const [r = 0, g = 0, b = 0, a = 1] = (m?.[1] ?? '').split(',').map(Number);
  return [r, g, b, a];
}
/** `fg` posé sur le fond opaque `bg`. */
function over(fg: string, bg: string): [number, number, number] {
  const [r, g, b, a] = parse(fg);
  const [R, G, B] = parse(bg);
  return [r * a + R * (1 - a), g * a + G * (1 - a), b * a + B * (1 - a)];
}
function luminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(fg: string, bg: string): number {
  const l1 = luminance(over(fg, bg));
  const l2 = luminance(over(bg, bg));
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

describe('thèmes Lumen', () => {
  it('8 palettes Lumen, chacune avec un équivalent dans l’autre mode ; les identités sont leur propre paire', () => {
    expect(THEMES.map((t) => t.id).sort()).toEqual([...THEME_IDS].sort());
    for (const t of THEMES) {
      expect(themePalette(t.id).style).toBe(t.style);
      if (t.style !== 'lumen') {
        expect(t.pair).toBe(t.id);
        expect(resolvePalette(t.id, true, t.scheme === 'dark' ? 'light' : 'dark')).toBe(themePalette(t.id));
        continue;
      }
      const pair = THEMES.find((x) => x.id === t.pair);
      expect(pair?.scheme).not.toBe(t.scheme);
      expect(pair?.pair).toBe(t.id);
      expect(themePalette(t.id).scheme).toBe(t.scheme);
    }
  });

  it('Nuit et Perle reprennent exactement les jetons Lumen', () => {
    const nuit = themePalette('nuit');
    expect(nuit.field).toEqual(['#130C2A', '#0B0719', '#07050F']);
    expect(nuit.accentGradient).toEqual(['#B9A0FF', '#7340FF']);
    expect(nuit.glass.float.blur).toBe(42);
    expect(nuit.glass.lens.fill).toBe('rgba(16,11,32,0.7)');
    const perle = themePalette('perle');
    expect(perle.accent).toBe('#6C2BFF');
    expect(perle.text).toBe('#161032');
  });

  it.each([...THEME_IDS])('%s : texte ≥ 7:1, secondaire et discret ≥ 4,5:1 (petits textes), couleurs porteuses de sens ≥ 3:1', (id) => {
    const p = themePalette(id);
    expect(contrast(p.text, p.bg)).toBeGreaterThanOrEqual(7);
    expect(contrast(p.textSecondary, p.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.textMuted, p.bg)).toBeGreaterThanOrEqual(4.5);
    for (const c of [p.accent, p.success, p.gold, p.warning, p.danger, p.info]) expect(contrast(c, p.bg)).toBeGreaterThanOrEqual(3);
    expect(contrast(p.onAccent, p.accentGradient[1])).toBeGreaterThanOrEqual(3);
    expect(contrast(p.onSuccess, p.success)).toBeGreaterThanOrEqual(3);
  });

  it.each([...THEME_IDS])('%s : couleurs de graphique nombreuses, distinctes de l’accent et lisibles', (id) => {
    const p = themePalette(id);
    const colors = seriesColors(p);
    expect(colors.length).toBeGreaterThanOrEqual(5);
    expect(colors).not.toContain(p.accent);
    for (const c of colors) expect(contrast(c, p.bg)).toBeGreaterThanOrEqual(2.2);
  });

  it('suivre le téléphone : l’équivalent quand le mode diffère', () => {
    expect(resolvePalette('braise', true, 'light')).toBe(themePalette('sable'));
    expect(resolvePalette('braise', true, 'dark')).toBe(themePalette('braise'));
    expect(resolvePalette('braise', false, 'light')).toBe(themePalette('braise'));
    expect(resolvePalette('nuit', true, null)).toBe(themePalette('nuit'));
  });

  it('variables CSS complètes (verre, teintes dérivées en hexadécimal + alpha)', () => {
    const v = cssVars(themePalette('ocean'));
    for (const level of ['pane', 'raised', 'float', 'lens']) for (const k of ['fill', 'solid', 'sheen0', 'sheen1', 'rim', 'spec', 'shadow', 'blur']) expect(v[`--glass-${level}-${k}`]).toBeTruthy();
    expect(v['--accent-wash0']).toMatch(/^#[0-9A-F]{6}2E$/i);
    expect(Object.values(v).every((x) => typeof x === 'string' && x.length > 0)).toBe(true);
  });
});
