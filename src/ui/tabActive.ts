import { createContext, useContext } from 'react';

/** Les onglets de l'app : gardés montés une fois visités (voir PageTransition.tsx). */
export const TAB_PATHS = ['/', '/budget', '/operations', '/patrimoine', '/reglages'] as const;
export type TabPath = (typeof TAB_PATHS)[number];

export const isTabPath = (p: string): p is TabPath => (TAB_PATHS as readonly string[]).includes(p);

export const TabActive = createContext(true);
/** L'écran est-il celui qu'on voit ? (false pour un onglet gardé en arrière-plan). */
export const useTabActive = () => useContext(TabActive);
