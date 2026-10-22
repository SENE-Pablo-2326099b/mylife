import { createContext, useContext } from 'react';

/** Écran à onglet : gardé monté une fois visité (voir PageTransition.tsx → KeptTabs). */
export const TabActive = createContext(true);
/** L'écran est-il celui qu'on voit ? (false pour un onglet gardé en arrière-plan). */
export const useTabActive = () => useContext(TabActive);
