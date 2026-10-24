/**
 * LUMEN — jetons partagés par toutes les apps MyLife (MyFinances, MyPerf, myRaveLoc).
 *
 * Une seule source pour ce qui doit être identique d'une app à l'autre : la liste des thèmes, leurs
 * graines de couleur, les niveaux de texte (lisibilité) et les couleurs des graphiques. Chaque app en
 * tire sa palette complète avec ses propres règles de rendu (CSS pour MyFinances, React Native pour MyPerf).
 * Données seulement : aucun import, aucune dépendance.
 */

export const THEME_IDS = ['nuit', 'ocean', 'braise', 'graphite', 'perle', 'glacier', 'sable', 'craie', 'circuit', 'ardoise', 'argile', 'brut'] as const;
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
  /**
   * Utilisé à la place quand le téléphone est dans l'autre mode (« Suivre le téléphone »). Les thèmes
   * à identité propre (Circuit, Ardoise, Argile, Brut) n'ont qu'un mode : ils sont leur propre paire.
   */
  pair: ThemeId;
  /** Identité visuelle : forme des cartes, typographie, fond, boutons, ombres (voir STYLES). */
  style: StyleId;
}

export const THEMES: readonly ThemeInfo[] = [
  { id: 'nuit', name: 'Nuit', description: 'Indigo, violet électrique, or', scheme: 'dark', pair: 'perle', style: 'lumen' },
  { id: 'ocean', name: 'Océan', description: 'Bleu profond, cyan', scheme: 'dark', pair: 'glacier', style: 'lumen' },
  { id: 'braise', name: 'Braise', description: 'Charbon, orange braise', scheme: 'dark', pair: 'sable', style: 'lumen' },
  { id: 'graphite', name: 'Graphite', description: 'Gris neutre, vert acide', scheme: 'dark', pair: 'craie', style: 'lumen' },
  { id: 'perle', name: 'Perle', description: 'Blanc nacré, violet, or', scheme: 'light', pair: 'nuit', style: 'lumen' },
  { id: 'glacier', name: 'Glacier', description: 'Blanc bleuté, bleu franc', scheme: 'light', pair: 'ocean', style: 'lumen' },
  { id: 'sable', name: 'Sable', description: 'Beige chaud, terre cuite', scheme: 'light', pair: 'braise', style: 'lumen' },
  { id: 'craie', name: 'Craie', description: 'Gris clair, encre', scheme: 'light', pair: 'graphite', style: 'lumen' },
  { id: 'circuit', name: 'Circuit', description: 'Interface tête haute : néon cyan, grille, chiffres en mono', scheme: 'dark', pair: 'circuit', style: 'circuit' },
  { id: 'ardoise', name: 'Ardoise', description: 'Outil pro mat : surfaces pleines, sobriété, Plex', scheme: 'dark', pair: 'ardoise', style: 'ardoise' },
  { id: 'argile', name: 'Argile', description: 'Douceur en relief : pastel, formes rondes, ombres douces', scheme: 'light', pair: 'argile', style: 'argile' },
  { id: 'brut', name: 'Brut', description: 'Néo-brutalisme : bordures noires, ombres franches, aplats', scheme: 'light', pair: 'brut', style: 'brut' },
];

/**
 * Identités visuelles. Un thème n'est pas qu'une palette : son style fixe la forme et la matière des
 * cartes, la typographie, le fond, les boutons, les ombres et la densité. Chaque app le traduit avec
 * ses moyens (CSS pour MyFinances, React Native pour MyPerf) à partir de ces mêmes valeurs : les deux
 * apps restent identiques d'un thème à l'autre.
 */
export type StyleId = 'lumen' | 'circuit' | 'ardoise' | 'argile' | 'brut';

export interface LumenStyle {
  id: StyleId;
  /** Familles de caractères (embarquées dans chaque app). */
  fonts: { display: string; body: string; number: string };
  /** Graisse des titres. */
  titleWeight: 600 | 700 | 800 | 900;
  /** Approche des titres (px pour 30 px). */
  titleTracking: number;
  /** Étiquettes (« Reste aujourd'hui », titres de colonnes) : casse normale ou capitales espacées. */
  labelCase: 'normal' | 'upper';
  /** Rayons : cartes, contrôles (boutons, champs), pastilles. */
  radius: { card: number; control: number; chip: number };
  /** Matière des cartes. */
  card: 'glass' | 'outline' | 'solid' | 'clay' | 'brutal';
  /** Épaisseur de la bordure des cartes (px). */
  border: number;
  /** Flou de ce qui est derrière les cartes (verre). */
  blur: boolean;
  /** Ombres : douces, lueur colorée, aucune, argile (doubles), franches décalées. */
  shadow: 'soft' | 'glow' | 'none' | 'clay' | 'hard';
  /** Texture de surface. */
  texture: 'grain' | 'scanline' | 'none';
  /** Fond de l'app. */
  backdrop: 'halos' | 'grid' | 'plain' | 'blobs';
  /** Bouton principal. */
  button: 'liquid' | 'outline' | 'solid' | 'clay' | 'brutal';
  /** Espacements (1 = référence Lumen). */
  density: number;
}

export const STYLES: Record<StyleId, LumenStyle> = {
  lumen: { id: 'lumen', fonts: { display: 'Sora', body: 'Inter', number: 'Sora' }, titleWeight: 700, titleTracking: -0.8, labelCase: 'normal', radius: { card: 22, control: 16, chip: 999 }, card: 'glass', border: 1, blur: true, shadow: 'soft', texture: 'grain', backdrop: 'halos', button: 'liquid', density: 1 },
  circuit: { id: 'circuit', fonts: { display: 'Space Grotesk', body: 'Inter', number: 'JetBrains Mono' }, titleWeight: 700, titleTracking: -0.6, labelCase: 'upper', radius: { card: 6, control: 4, chip: 4 }, card: 'outline', border: 1, blur: false, shadow: 'glow', texture: 'scanline', backdrop: 'grid', button: 'outline', density: 0.94 },
  ardoise: { id: 'ardoise', fonts: { display: 'IBM Plex Sans', body: 'IBM Plex Sans', number: 'IBM Plex Mono' }, titleWeight: 600, titleTracking: -0.5, labelCase: 'normal', radius: { card: 10, control: 8, chip: 8 }, card: 'solid', border: 1, blur: false, shadow: 'none', texture: 'none', backdrop: 'plain', button: 'solid', density: 0.92 },
  argile: { id: 'argile', fonts: { display: 'Nunito', body: 'Nunito', number: 'Nunito' }, titleWeight: 800, titleTracking: -0.4, labelCase: 'normal', radius: { card: 30, control: 22, chip: 999 }, card: 'clay', border: 0, blur: false, shadow: 'clay', texture: 'none', backdrop: 'blobs', button: 'clay', density: 1.12 },
  brut: { id: 'brut', fonts: { display: 'Archivo', body: 'Space Grotesk', number: 'Space Grotesk' }, titleWeight: 900, titleTracking: -1.2, labelCase: 'upper', radius: { card: 10, control: 8, chip: 8 }, card: 'brutal', border: 2.5, blur: false, shadow: 'hard', texture: 'none', backdrop: 'plain', button: 'brutal', density: 1.04 },
};

export function styleOf(id: ThemeId): LumenStyle {
  return STYLES[THEMES.find((t) => t.id === id)?.style ?? 'lumen'];
}

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
  circuit: {
    scheme: 'dark',
    field: ['#071021', '#05080F', '#020409'],
    halos: { violet: '#00E5FF', gold: '#FF2BD6', indigo: '#3D5AFE', orchid: '#00FFA3' },
    bg: '#05080F',
    tint: '#7FF6FF',
    bodies: { pane: '#08111F', raised: '#0B1628', float: '#071020', lens: '#050B16' },
    shadow: '#000000',
    text: '#E6FBFF',
    accent: '#22E6FF',
    accentGradient: ['#7CF3FF', '#00A8D6'],
    onAccent: '#001318',
    gold: '#FFD23F',
    goldGradient: ['#FFE48A', '#E0A800'],
    success: '#2BFF9A',
    onSuccess: '#00210F',
    danger: '#FF4D7D',
    warning: '#FFB020',
    info: '#7C9CFF',
    drop: '#FF2BD6',
  },
  ardoise: {
    scheme: 'dark',
    field: ['#1A1D23', '#15171C', '#111317'],
    halos: { violet: '#3B4252', gold: '#4C4637', indigo: '#2E3440', orchid: '#3A4A45' },
    bg: '#15171C',
    tint: '#C8D0DC',
    bodies: { pane: '#1D2027', raised: '#23272F', float: '#1A1D23', lens: '#16191E' },
    shadow: '#000000',
    text: '#ECEFF4',
    accent: '#8FB8FF',
    accentGradient: ['#A9C8FF', '#5B8DEF'],
    onAccent: '#0B1220',
    gold: '#E5C07B',
    goldGradient: ['#F0D9A8', '#C9A24E'],
    success: '#7BD88F',
    onSuccess: '#0E2A15',
    danger: '#FF7A85',
    warning: '#F0A35E',
    info: '#7AB8FF',
    drop: '#C792EA',
  },
  argile: {
    scheme: 'light',
    field: ['#F6F2FD', '#EEE9F7', '#E6E0F3'],
    halos: { violet: '#CDB8FF', gold: '#FFD9A8', indigo: '#B9D3FF', orchid: '#BFF0DA' },
    bg: '#EEE9F7',
    tint: '#4A3B7A',
    shadow: '#5A4A9A',
    text: '#2A2245',
    accent: '#6D4BD8',
    accentGradient: ['#9C82F5', '#6141D1'],
    onAccent: '#FFFFFF',
    gold: '#9A6100',
    goldGradient: ['#FFD9A0', '#E8A84A'],
    success: '#147A4F',
    onSuccess: '#FFFFFF',
    danger: '#C5284A',
    warning: '#B45309',
    info: '#2F5FD0',
    drop: '#B04ACB',
  },
  brut: {
    scheme: 'light',
    field: ['#FAFAF5', '#FAFAF5', '#F2F2EA'],
    halos: { violet: '#FFE45C', gold: '#FF9EC7', indigo: '#9FD3FF', orchid: '#B8F2C9' },
    bg: '#FAFAF5',
    tint: '#0A0A0A',
    shadow: '#0A0A0A',
    text: '#0A0A0A',
    accent: '#2F3CF4',
    accentGradient: ['#4B57FF', '#2F3CF4'],
    onAccent: '#FFFFFF',
    gold: '#9A6700',
    goldGradient: ['#FFE45C', '#F5B800'],
    success: '#0F7B3F',
    onSuccess: '#FFFFFF',
    danger: '#D61F45',
    warning: '#B45309',
    info: '#2F3CF4',
    drop: '#C026D3',
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

/**
 * Les apps de l'écosystème MyLife, dans l'ordre où elles apparaissent partout (Espaces MyLife,
 * palettes). Chacune a une couleur d'identité fixe, la même quel que soit le thème choisi.
 * Ajouter une app ici l'ajoute à toutes les autres.
 */
export interface MyLifeApp {
  id: 'finances' | 'perf' | 'raveloc';
  name: string;
  tagline: string;
  /** Glyphe Ionicons. */
  icon: 'diamond' | 'barbell' | 'navigate';
  colors: [string, string];
  /** Chemin sous l'adresse MyLife. */
  path: string;
}

export const MYLIFE_APPS: readonly MyLifeApp[] = [
  { id: 'finances', name: 'MyFinances', tagline: 'Budget, patrimoine, placements', icon: 'diamond', colors: ['#B9A0FF', '#7340FF'], path: '/finances/' },
  { id: 'perf', name: 'MyPerf', tagline: 'Séances, progression, coach', icon: 'barbell', colors: ['#FFB86B', '#F0566B'], path: '/perf/' },
  { id: 'raveloc', name: 'myRaveLoc', tagline: 'Retrouver ses amis en festival', icon: 'navigate', colors: ['#5DFFC4', '#1FA3FF'], path: '/raveloc/' },
];

/** L'accueil de MyLife (point d'entrée de l'app installée), avec les mêmes champs qu'une app. */
export const MYLIFE_HOME = { id: 'home', name: 'MyLife', tagline: 'Tes apps, un seul compte', colors: ['#F5C451', '#8B5CFF'] as [string, string], path: '/' } as const;

/**
 * Où l'on peut aller dans chaque app : la palette de commande de n'importe quelle app les propose
 * (« séance » depuis MyFinances ouvre MyPerf au bon endroit). Chemins complets sous l'adresse MyLife.
 */
export interface MyLifeDestination {
  app: MyLifeApp['id'] | 'home';
  title: string;
  path: string;
  /** Mots qui mènent ici (sans accents, en minuscules). */
  keywords: string;
}

export const MYLIFE_DESTINATIONS: readonly MyLifeDestination[] = [
  { app: 'home', title: 'Accueil MyLife', path: '/', keywords: 'accueil apps toutes maison' },
  { app: 'home', title: 'Compte MyLife', path: '/compte', keywords: 'compte connexion mot de passe cle secours synchro deconnexion supprimer' },
  { app: 'home', title: 'Apparence', path: '/apparence', keywords: 'theme couleurs sombre clair identite circuit ardoise argile brut' },
  { app: 'home', title: 'Installer MyLife', path: '/installer', keywords: 'installer telephone ecran accueil application pwa' },
  { app: 'home', title: 'Ton personnage', path: '/personnage', keywords: 'personnage niveau rpg stats quetes xp serie force discipline social constance' },
  { app: 'home', title: 'Ta semaine', path: '/bilan', keywords: 'bilan semaine resume recap progres' },
  { app: 'home', title: 'Ton Wrapped', path: '/wrapped', keywords: 'wrapped mois annee resume partager image story' },
  { app: 'home', title: 'Ton Crew', path: '/crew', keywords: 'crew amis classement groupe inviter defi bande' },
  { app: 'home', title: 'Copilot', path: '/copilot', keywords: 'copilot ia assistant question claude conseil budget entrainement' },
  { app: 'home', title: 'MyGames', path: '/jeux', keywords: 'jeux jeu video steam heures console' },
  { app: 'home', title: 'Mes apps', path: '/mes-apps', keywords: 'mes apps creer app sans code suivi habitude lecture sommeil eau humeur tracker' },
  // new-app: destinations (repère du générateur, ne pas retirer)
  { app: 'home', title: 'Où va ton temps ?', path: '/temps', keywords: 'temps heures sport musique jeu ecran repartition' },
  { app: 'home', title: 'MyMusique', path: '/musique', keywords: 'musique spotify ecoute artistes morceaux stats wrapped culture' },
  { app: 'home', title: 'Sorties', path: '/sorties', keywords: 'sortie festival soiree week end chaud planning sets budget partage depenses liste id' },
  { app: 'finances', title: 'Budget du jour', path: '/finances/', keywords: 'argent depenser reste aujourd hui budget finances' },
  { app: 'finances', title: 'Budget du cycle', path: '/finances/budget', keywords: 'cycle paie calendrier depenses' },
  { app: 'finances', title: 'Opérations', path: '/finances/operations', keywords: 'transactions depenses banque achats' },
  { app: 'finances', title: 'Patrimoine', path: '/finances/patrimoine', keywords: 'patrimoine placements epargne bourse crypto' },
  { app: 'finances', title: 'Indépendance financière', path: '/finances/independance', keywords: 'fire retraite rente interets composes' },
  { app: 'finances', title: 'Assistant financier', path: '/finances/assistant', keywords: 'ia claude question argent' },
  { app: 'perf', title: 'Séance du jour', path: '/perf/', keywords: 'seance entrainement sport muscu aujourd hui demarrer' },
  { app: 'perf', title: 'Planning d’entraînement', path: '/perf/planning', keywords: 'planning cycle programme semaine' },
  { app: 'perf', title: 'Exercices', path: '/perf/exercises', keywords: 'exercices bibliotheque 1rm record mouvement' },
  { app: 'perf', title: 'Statistiques sportives', path: '/perf/stats', keywords: 'stats progression volume force' },
  { app: 'perf', title: 'Coach', path: '/perf/coach', keywords: 'coach ia conseil entrainement' },
  { app: 'perf', title: 'Importer un programme', path: '/perf/program-import', keywords: 'importer programme seances ia chatgpt json exporter partager modele' },
  { app: 'raveloc', title: 'Retrouver mes amis', path: '/raveloc/', keywords: 'amis festival position fleche retrouver raveloc' },
  { app: 'raveloc', title: 'Mes groupes', path: '/raveloc/groupes', keywords: 'groupes soiree concert' },
  { app: 'raveloc', title: 'Créer un groupe', path: '/raveloc/groupes/nouveau', keywords: 'nouveau groupe inviter festival' },
];

/**
 * Aperçu d'une app, déposé par l'app elle-même sur l'appareil (jamais envoyé) et affiché par l'accueil
 * et les Espaces : « 23 € à dépenser aujourd'hui », « Push A · 6 exercices », « Groupe Hellfest · 3 amis ».
 */
export interface MyLifeGlance {
  /** La ligne principale, courte. */
  title: string;
  detail?: string;
  tone?: 'accent' | 'success' | 'warning' | 'danger';
  /** Après cette date, l'aperçu n'est plus vrai (« reste aujourd'hui » à minuit) : il n'est plus montré. */
  until?: number;
  at: number;
}
export const glanceKey = (app: MyLifeApp['id']) => `mylife:glance:${app}`;

export function readGlance(app: MyLifeApp['id']): MyLifeGlance | null {
  try {
    const g = JSON.parse(globalThis.localStorage?.getItem(glanceKey(app)) ?? 'null') as MyLifeGlance | null;
    return g && typeof g.title === 'string' && typeof g.at === 'number' && !(typeof g.until === 'number' && g.until < Date.now()) ? g : null;
  } catch {
    return null;
  }
}

/** Dépose (ou retire, avec null) l'aperçu de l'app ; ne réécrit pas un aperçu identique. */
export function writeGlance(app: MyLifeApp['id'], glance: Omit<MyLifeGlance, 'at'> | null): void {
  try {
    if (!glance) return void globalThis.localStorage?.removeItem(glanceKey(app));
    const prev = readGlance(app);
    if (prev && prev.title === glance.title && prev.detail === glance.detail && prev.tone === glance.tone && prev.until === glance.until) return;
    globalThis.localStorage?.setItem(glanceKey(app), JSON.stringify({ ...glance, at: Date.now() }));
  } catch {
    /* stockage indisponible : pas d'aperçu */
  }
}

/**
 * Apparence de MyLife : un seul réglage pour toutes les apps. Sur le web, les apps partagent l'adresse,
 * donc ce stockage ; un changement dans une app s'applique tout de suite aux autres onglets ouverts.
 * `at` date le choix : entre deux appareils (synchro), le plus récent gagne.
 */
export interface SharedAppearance {
  theme: ThemeId;
  followSystem: boolean;
  /** Réduire les animations (en plus du réglage du système). */
  reduceMotion: boolean;
  /** Légère vibration au toucher (Android). */
  haptics: boolean;
  at: number;
}
export const SHARED_APPEARANCE_KEY = 'mylife:appearance';

export const DEFAULT_APPEARANCE: SharedAppearance = { theme: 'nuit', followSystem: false, reduceMotion: false, haptics: true, at: 0 };

/** Valide une apparence lue (stockage, synchro) ; les champs ajoutés depuis prennent leur valeur par défaut. */
export function parseAppearance(raw: unknown): SharedAppearance | null {
  const r = raw as Partial<SharedAppearance> | null;
  if (!r || !isThemeId(r.theme) || typeof r.followSystem !== 'boolean' || typeof r.at !== 'number') return null;
  return { theme: r.theme, followSystem: r.followSystem, reduceMotion: r.reduceMotion === true, haptics: r.haptics !== false, at: r.at };
}

export function readSharedAppearance(): SharedAppearance | null {
  try {
    return parseAppearance(JSON.parse(globalThis.localStorage?.getItem(SHARED_APPEARANCE_KEY) ?? 'null'));
  } catch {
    return null;
  }
}

/** Enregistre un choix de l'utilisateur (daté maintenant, sauf `at` fourni : apparence venue d'un autre appareil). */
export function writeSharedAppearance(a: Partial<SharedAppearance> & { theme: ThemeId; followSystem: boolean }): SharedAppearance {
  const next: SharedAppearance = { ...DEFAULT_APPEARANCE, ...(readSharedAppearance() ?? {}), ...a, at: a.at ?? Date.now() };
  try {
    globalThis.localStorage?.setItem(SHARED_APPEARANCE_KEY, JSON.stringify(next));
  } catch {
    /* stockage indisponible : le choix vaut pour cette session */
  }
  return next;
}
export * from './character';
export * from './crew';
export * from './sortie';
export * from './music';
export * from './games';

// ---------------------------------------------------------------- Copilot : fiches de contexte

/**
 * Fiche de contexte d'une app pour Copilot (l'IA de l'accueil) : ce que l'app sait de « maintenant »
 * (budget du jour, séances prévues…), déposé sur l'appareil, jamais synchronisé ni envoyé ailleurs qu'à
 * l'API Claude quand l'utilisateur pose une question. Effacé si un autre compte se connecte.
 */
export const copilotKey = (app: MyLifeApp['id']) => `mylife:copilot:${app}`;

export function writeCopilotCard(app: MyLifeApp['id'], card: Record<string, unknown>): void {
  try {
    globalThis.localStorage?.setItem(copilotKey(app), JSON.stringify({ ...card, at: Date.now() }));
  } catch {
    /* stockage indisponible */
  }
}

export function readCopilotCard(app: MyLifeApp['id']): Record<string, unknown> | null {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(copilotKey(app)) ?? 'null') as unknown;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
export * from './pacte';
export * from './miniapp';
export * from './homeApps';
// new-app: moteurs (repère du générateur, ne pas retirer)
