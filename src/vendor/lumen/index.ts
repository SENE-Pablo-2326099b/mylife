// GÉNÉRÉ depuis MyLife/packages/lumen — ne pas modifier ici (MyLife : npm run vendor).
/**
 * LUMEN — jetons partagés par toutes les apps MyLife (MyFinances, MyPerf).
 *
 * Une seule source pour ce qui doit être identique d'une app à l'autre : la liste des thèmes, leurs
 * graines de couleur, les niveaux de texte (lisibilité) et les couleurs des graphiques. Chaque app en
 * tire sa palette complète avec ses propres règles de rendu (CSS pour MyFinances, React Native pour MyPerf).
 * Données seulement : aucun import, aucune dépendance.
 */

export const THEME_IDS = ['nuit', 'ocean', 'braise', 'graphite', 'perle', 'glacier', 'sable', 'craie'] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export function isThemeId(v: unknown): v is ThemeId {
  return typeof v === 'string' && (THEME_IDS as readonly string[]).includes(v);
}

export interface ThemeInfo {
  id: ThemeId;
  name: string;
  /** Quelques mots : à quoi il ressemble. */
  description: string;
  scheme: 'dark' | 'light';
  /** Utilisé à la place quand le téléphone est dans l'autre mode (« Suivre le téléphone »). */
  pair: ThemeId;
}

export const THEMES: readonly ThemeInfo[] = [
  { id: 'nuit', name: 'Nuit', description: 'Indigo, violet électrique, or', scheme: 'dark', pair: 'perle' },
  { id: 'ocean', name: 'Océan', description: 'Bleu profond, cyan', scheme: 'dark', pair: 'glacier' },
  { id: 'braise', name: 'Braise', description: 'Charbon, orange braise', scheme: 'dark', pair: 'sable' },
  { id: 'graphite', name: 'Graphite', description: 'Gris neutre, vert acide', scheme: 'dark', pair: 'craie' },
  { id: 'perle', name: 'Perle', description: 'Blanc nacré, violet, or', scheme: 'light', pair: 'nuit' },
  { id: 'glacier', name: 'Glacier', description: 'Blanc bleuté, bleu franc', scheme: 'light', pair: 'ocean' },
  { id: 'sable', name: 'Sable', description: 'Beige chaud, terre cuite', scheme: 'light', pair: 'braise' },
  { id: 'craie', name: 'Craie', description: 'Gris clair, encre', scheme: 'light', pair: 'graphite' },
];

/**
 * Opacité de l'encre pour les textes secondaires et discrets. Réglée pour que les petits textes
 * (légendes, dates) restent à 4,5:1 au moins sur le fond, dans tous les thèmes (WCAG AA).
 */
export const TEXT_ALPHA = {
  dark: { secondary: 0.7, muted: 0.47 },
  light: { secondary: 0.72, muted: 0.62 },
} as const;

/** Textes de Nuit et Perle (palettes Lumen d'origine, écrites à la main). */
export const BASE_TEXT = {
  nuit: { text: '#F6F3FF', secondary: 'rgba(232,226,255,0.68)', muted: 'rgba(222,214,250,0.56)' },
  perle: { text: '#161032', secondary: 'rgba(22,16,50,0.72)', muted: 'rgba(22,16,50,0.62)' },
} as const;

/** La graine d'un thème : chaque app en tire toute la palette. */
export interface LumenSeed {
  scheme: 'dark' | 'light';
  field: [string, string, string];
  halos: { violet: string; gold: string; indigo: string; orchid: string };
  bg: string;
  /** Teinte du verre (sombre : teinte claire sur la nuit ; clair : encre des puits et des bords). */
  tint: string;
  /** Sombre uniquement : corps opaques du verre, pane → lens. */
  bodies?: { pane: string; raised: string; float: string; lens: string };
  shadow: string;
  text: string;
  accent: string;
  accentGradient: [string, string];
  onAccent: string;
  gold: string;
  goldGradient: [string, string];
  success: string;
  onSuccess: string;
  danger: string;
  warning: string;
  info: string;
  /** MyPerf : couleur des séries dégressives. */
  drop: string;
}

export const SEEDS: Record<Exclude<ThemeId, 'nuit' | 'perle'>, LumenSeed> = {
  ocean: {
    scheme: 'dark',
    field: ['#06192A', '#04111D', '#020A12'],
    halos: { violet: '#1FA8FF', gold: '#FFC857', indigo: '#2E62FF', orchid: '#19D3C0' },
    bg: '#04111D',
    tint: '#AAD7FF',
    bodies: { pane: '#0E2032', raised: '#132A40', float: '#0C1C2C', lens: '#081420' },
    shadow: '#01060C',
    text: '#EEF7FF',
    accent: '#45C8FF',
    accentGradient: ['#8ADCFF', '#1592E6'],
    onAccent: '#FFFFFF',
    gold: '#FFC857',
    goldGradient: ['#FFE3A0', '#E9A830'],
    success: '#3DDC97',
    onSuccess: '#04291A',
    danger: '#FF6B7D',
    warning: '#FFA24C',
    info: '#8FB6FF',
    drop: '#C99BFF',
  },
  braise: {
    scheme: 'dark',
    field: ['#1F0F09', '#150A06', '#0B0503'],
    halos: { violet: '#FF6A3D', gold: '#FFB547', indigo: '#B4380A', orchid: '#FF3D6E' },
    bg: '#150A06',
    tint: '#FFD2BE',
    bodies: { pane: '#2A1610', raised: '#361D15', float: '#24130E', lens: '#180D0A' },
    shadow: '#0A0302',
    text: '#FFF4EE',
    accent: '#FF8352',
    accentGradient: ['#FFB085', '#EE5420'],
    onAccent: '#FFFFFF',
    gold: '#FFCB5C',
    goldGradient: ['#FFE6A6', '#F0A92A'],
    success: '#4FD68F',
    onSuccess: '#06281A',
    danger: '#FF5C82',
    warning: '#FFD23F',
    info: '#86B4FF',
    drop: '#FF8CC6',
  },
  graphite: {
    scheme: 'dark',
    field: ['#17181B', '#101113', '#09090B'],
    halos: { violet: '#A9E34B', gold: '#F5C451', indigo: '#4B5A6B', orchid: '#5FC9B2' },
    bg: '#101113',
    tint: '#DCE1EA',
    bodies: { pane: '#1E2024', raised: '#26282E', float: '#1A1C20', lens: '#121316' },
    shadow: '#000000',
    text: '#F3F5F7',
    accent: '#C6F25A',
    accentGradient: ['#DCFB8C', '#94D02A'],
    onAccent: '#121A00',
    gold: '#F5C451',
    goldGradient: ['#FFE39A', '#E6A82E'],
    success: '#5EE6D0',
    onSuccess: '#03241F',
    danger: '#FF6B6B',
    warning: '#FFA94D',
    info: '#7DB8FF',
    drop: '#D7A1FF',
  },
  glacier: {
    scheme: 'light',
    field: ['#FFFFFF', '#F2F8FE', '#E3EFFA'],
    halos: { violet: '#9CCBFF', gold: '#FFD98A', indigo: '#A8BEFF', orchid: '#9EE8E1' },
    bg: '#F2F8FE',
    tint: '#123A62',
    shadow: '#14406E',
    text: '#0C1E34',
    accent: '#0A72CC',
    accentGradient: ['#3BA4F5', '#0763BC'],
    onAccent: '#FFFFFF',
    gold: '#946300',
    goldGradient: ['#FFE08A', '#E3A72F'],
    success: '#0B8752',
    onSuccess: '#FFFFFF',
    danger: '#D12A47',
    warning: '#BF5208',
    info: '#4F46E5',
    drop: '#A21CAF',
  },
  sable: {
    scheme: 'light',
    field: ['#FFFDF9', '#FBF4EA', '#F3E7D6'],
    halos: { violet: '#FFC19A', gold: '#FFD66E', indigo: '#F0B49C', orchid: '#F6A6B6' },
    bg: '#FBF4EA',
    tint: '#5A3418',
    shadow: '#6E3C14',
    text: '#2B1C12',
    accent: '#C0410E',
    accentGradient: ['#E8763C', '#B0380A'],
    onAccent: '#FFFFFF',
    gold: '#8C5D00',
    goldGradient: ['#FFE08A', '#E3A72F'],
    success: '#23784C',
    onSuccess: '#FFFFFF',
    danger: '#B8123A',
    warning: '#9A5B00',
    info: '#2457D6',
    drop: '#8E2FD8',
  },
  craie: {
    scheme: 'light',
    field: ['#FFFFFF', '#F5F6F8', '#EAECEF'],
    halos: { violet: '#C9CFDA', gold: '#FFE08A', indigo: '#C7D2FE', orchid: '#BEE3D8' },
    bg: '#F5F6F8',
    tint: '#111827',
    shadow: '#1E2838',
    text: '#111827',
    accent: '#1F2937',
    accentGradient: ['#4A5568', '#111827'],
    onAccent: '#FFFFFF',
    gold: '#946200',
    goldGradient: ['#FFE08A', '#E3A72F'],
    success: '#0B8752',
    onSuccess: '#FFFFFF',
    danger: '#D0263F',
    warning: '#C2540A',
    info: '#2563EB',
    drop: '#9333EA',
  },
};

/**
 * Couleurs catégorielles des graphiques : ordre fixe, validé pour les daltonismes, filtré ensuite
 * par chaque app pour écarter les teintes trop proches de l'accent.
 */
export const SERIES_HUES = {
  dark: ['#2DD4BF', '#FBBF24', '#F472B6', '#60A5FA', '#A3E635', '#FB923C', '#C084FC', '#F87171'],
  light: ['#0D9488', '#D97706', '#DB2777', '#2563EB', '#65A30D', '#EA580C', '#9333EA', '#DC2626'],
} as const;
