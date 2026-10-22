import { useSyncExternalStore } from 'react';
import type { IconName } from './icons';

/** Entrées et recherche de la palette de commande (CommandPalette.tsx). */

export interface PaletteItem {
  id: string;
  /** Titre de la section (« Actions », « Aller à »…). */
  group: string;
  icon?: IconName;
  emoji?: string;
  title: string;
  hint?: string;
  right?: string;
  keywords?: string;
  run: () => void;
}

/** Minuscules, sans accents, ponctuation remplacée par des espaces. */
export function foldText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Pertinence d'un texte pour une saisie déjà repliée (0 = absent). */
export function paletteScore(text: string, q: string): number {
  if (!q) return 1;
  const t = foldText(text);
  if (t.startsWith(q)) return 3;
  if (t.includes(` ${q}`)) return 2;
  return t.includes(q) ? 1 : 0;
}

/** Trie des entrées par pertinence pour la saisie (titre d'abord, puis mots-clés). */
export function rankItems(items: PaletteItem[], q: string): PaletteItem[] {
  return items
    .map((i) => ({ i, s: Math.max(paletteScore(i.title, q), paletteScore(i.keywords ?? '', q) ? 1 : 0) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.i);
}

let query = '';
const listeners = new Set<() => void>();
/** Saisie de la palette (remise à vide à chaque ouverture). */
export function setPaletteQuery(q: string): void {
  query = q;
  listeners.forEach((l) => l());
}

/** La saisie de la palette (brute) : l'app s'en sert pour chercher dans ses données. */
export function usePaletteQuery(): string {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => query,
    () => '',
  );
}
