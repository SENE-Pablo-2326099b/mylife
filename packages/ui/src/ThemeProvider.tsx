import { LazyMotion, MotionConfig } from 'framer-motion';
import { useLayoutEffect, type ReactNode } from 'react';
import { useAppearance } from './appearance';
import { setHapticsEnabled } from './motion';
import { applyPalette, ThemeContext, useSystemScheme } from './themeRuntime';
import { resolveThemeId, themePalette } from './themes';

const loadFeatures = () => import('./motionFeatures').then((r) => r.default);

/** Fournit la palette du thème choisi dans MyLife (ou de son équivalent quand on suit le téléphone). */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { theme, followSystem, reduceMotion, haptics } = useAppearance();
  const system = useSystemScheme();
  const palette = themePalette(resolveThemeId(theme, followSystem, system));

  useLayoutEffect(() => {
    applyPalette(palette);
  }, [palette]);

  useLayoutEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', reduceMotion);
    setHapticsEnabled(haptics);
  }, [reduceMotion, haptics]);

  return (
    <ThemeContext.Provider value={palette}>
      <MotionConfig reducedMotion={reduceMotion ? 'always' : 'user'}>
        <LazyMotion features={loadFeatures} strict>
          {children}
        </LazyMotion>
      </MotionConfig>
    </ThemeContext.Provider>
  );
}
