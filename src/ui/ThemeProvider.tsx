import { MotionConfig } from 'framer-motion';
import { useLiveQuery } from 'dexie-react-hooks';
import { useLayoutEffect, useMemo, type ReactNode } from 'react';
import { db } from '../db/db';
import { setHapticsEnabled } from './motion';
import { applyPalette, readMirror, ThemeContext, useSystemScheme, writeMirror } from './themeRuntime';
import { isThemeId, resolveThemeId, themePalette, type ThemeId } from './themes';

/** Fournit la palette du thème choisi (ou de son équivalent quand l'app suit le téléphone). */
export function ThemeProvider({ children }: { children: ReactNode }) {
  // Tant que les réglages ne sont pas lus, on garde le choix recopié au dernier lancement.
  const stored = useLiveQuery(() => db.settings.get('main'), []);
  const mirror = useMemo(readMirror, []);
  const system = useSystemScheme();
  const theme: ThemeId = stored ? (isThemeId(stored.theme) ? stored.theme : 'nuit') : mirror.theme;
  const followSystem = stored ? !!stored.followSystem : mirror.followSystem;
  const reduceMotion = stored ? !!stored.reduceMotion : mirror.reduceMotion;
  const haptics = stored ? stored.haptics !== false : true;
  const palette = themePalette(resolveThemeId(theme, followSystem, system));

  useLayoutEffect(() => {
    applyPalette(palette);
  }, [palette]);

  useLayoutEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', reduceMotion);
    setHapticsEnabled(haptics);
    if (stored) writeMirror({ theme, followSystem, reduceMotion });
  }, [stored, theme, followSystem, reduceMotion, haptics]);

  return (
    <ThemeContext.Provider value={palette}>
      <MotionConfig reducedMotion={reduceMotion ? 'always' : 'user'}>{children}</MotionConfig>
    </ThemeContext.Provider>
  );
}
