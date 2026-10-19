import { createContext, useContext, useSyncExternalStore } from 'react';
import { cssVars, type Palette } from './theme';
import { isThemeId, resolvePalette, themePalette, type ThemeId } from './themes';

/**
 * Applique le thème : variables CSS sur <html> (lues par Tailwind et le verre), couleur de la barre
 * du navigateur, mode clair / sombre natif, préférences de mouvement et d'haptique.
 * Le choix est recopié dans localStorage pour peindre la bonne couleur dès la première image.
 */

const MIRROR_KEY = 'lumen-appearance';

interface Appearance {
  theme: ThemeId;
  followSystem: boolean;
  reduceMotion: boolean;
}

export function readMirror(): Appearance {
  try {
    const raw = JSON.parse(localStorage.getItem(MIRROR_KEY) ?? 'null') as Partial<Appearance> | null;
    if (raw && isThemeId(raw.theme)) return { theme: raw.theme, followSystem: !!raw.followSystem, reduceMotion: !!raw.reduceMotion };
  } catch {
    /* stockage indisponible (navigation privée) : thème par défaut */
  }
  return { theme: 'nuit', followSystem: false, reduceMotion: false };
}

export function writeMirror(a: Appearance): void {
  try {
    localStorage.setItem(MIRROR_KEY, JSON.stringify(a));
  } catch {
    /* ignore */
  }
}

const DARK_QUERY = '(prefers-color-scheme: dark)';

function subscribeScheme(cb: () => void) {
  const mq = window.matchMedia?.(DARK_QUERY);
  mq?.addEventListener?.('change', cb);
  return () => mq?.removeEventListener?.('change', cb);
}

export function useSystemScheme(): 'dark' | 'light' | null {
  return useSyncExternalStore(
    subscribeScheme,
    () => (window.matchMedia ? (window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light') : null),
    () => null,
  );
}

export function applyPalette(p: Palette): void {
  const root = document.documentElement;
  for (const [k, val] of Object.entries(cssVars(p))) root.style.setProperty(k, val);
  root.style.colorScheme = p.scheme;
  root.dataset.scheme = p.scheme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', p.bg);
}

/** Plateforme : Android simule le verre (pas de flou réel), et tout navigateur sans backdrop-filter. */
function applyPlatformClasses(): void {
  const root = document.documentElement;
  const android = /android/i.test(navigator.userAgent);
  const blur = typeof CSS !== 'undefined' && (CSS.supports?.('backdrop-filter', 'blur(2px)') || CSS.supports?.('-webkit-backdrop-filter', 'blur(2px)'));
  root.classList.toggle('android', android);
  root.classList.toggle('no-live-blur', android || !blur);
}

/** Avant le premier rendu React : bonnes couleurs dès la première image. */
export function bootTheme(): void {
  applyPlatformClasses();
  const m = readMirror();
  const system = window.matchMedia ? (window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light') : null;
  applyPalette(resolvePalette(m.theme, m.followSystem, system));
  document.documentElement.classList.toggle('reduce-motion', m.reduceMotion);
}

export const ThemeContext = createContext<Palette>(themePalette('nuit'));

export function useTheme(): Palette {
  return useContext(ThemeContext);
}

