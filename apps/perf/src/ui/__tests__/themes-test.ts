import { THEME_IDS } from '@/db/repos/settings';

import { resolvePalette, themePalette } from '../theme';
import { blockColors, THEMES } from '../themes';

/** Colour as [r, g, b, a] from "#RRGGBB" or "rgba(r,g,b,a)". */
function parse(c: string): [number, number, number, number] {
  if (c.startsWith('#')) {
    const h = c.slice(1);
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1) as [number, number, number, number];
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  const [r = 0, g = 0, b = 0, a = 1] = (m?.[1] ?? '').split(',').map(Number);
  return [r, g, b, a];
}
/** `fg` drawn over the opaque `bg`. */
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

describe('colour themes', () => {
  it('offers Lumen palettes paired across schemes, and identities that are their own pair', () => {
    expect(THEMES.length).toBeGreaterThanOrEqual(12);
    expect(THEMES.map((t) => t.id).sort()).toEqual([...THEME_IDS].sort());
    for (const t of THEMES) {
      expect(themePalette(t.id).style).toBe(t.style);
      if (t.style !== 'lumen') {
        expect(t.pair).toBe(t.id);
        continue;
      }
      const pair = THEMES.find((x) => x.id === t.pair);
      expect(pair?.scheme).not.toBe(t.scheme);
      expect(themePalette(t.id).scheme).toBe(t.scheme);
    }
  });

  it.each([...THEME_IDS])('%s: text and meaningful colours stay readable on the background', (id) => {
    const p = themePalette(id);
    expect(contrast(p.text, p.bg)).toBeGreaterThanOrEqual(7);
    expect(contrast(p.textSecondary, p.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.textMuted, p.bg)).toBeGreaterThanOrEqual(3);
    // Done, record, alert, danger and the accent: legible as text and in charts.
    for (const c of [p.accent, p.success, p.gold, p.warning, p.danger, p.info]) expect(contrast(c, p.bg)).toBeGreaterThanOrEqual(3);
    // Labels on filled accent / success.
    expect(contrast(p.onAccent, p.accentGradient[1])).toBeGreaterThanOrEqual(3);
    expect(contrast(p.onSuccess, p.success)).toBeGreaterThanOrEqual(3);
  });

  it.each([...THEME_IDS])('%s: calendar cycle colours are several, distinct from the accent and readable', (id) => {
    const p = themePalette(id);
    const colors = blockColors(p);
    expect(colors.length).toBeGreaterThanOrEqual(5);
    expect(colors).not.toContain(p.accent);
    for (const c of colors) expect(contrast(c, p.bg)).toBeGreaterThanOrEqual(2.2);
  });

  it('follows the phone: the counterpart theme when the scheme differs', () => {
    expect(resolvePalette('braise', true, 'light')).toBe(themePalette('sable'));
    expect(resolvePalette('braise', true, 'dark')).toBe(themePalette('braise'));
    expect(resolvePalette('braise', false, 'light')).toBe(themePalette('braise'));
  });
});
