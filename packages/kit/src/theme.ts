/**
 * Le thème de MyLife V5 : sombre (verre fumé), clair (verre givré), ou comme le téléphone. Le choix est gardé sur
 * l'appareil ; la coquille le relie à l'apparence commune synchronisée entre appareils (`app/src/appearance.ts`). Sur un appareil lent ou qui demande moins de transparence, le flou est coupé (`.no-blur`).
 */
export type ThemeChoice = 'auto' | 'sombre' | 'clair';
export const THEME_CHOICES: readonly { id: ThemeChoice; label: string }[] = [
  { id: 'auto', label: 'Comme le téléphone' },
  { id: 'sombre', label: 'Sombre' },
  { id: 'clair', label: 'Clair' },
];

const KEY = 'mylife:v5:theme';
const isChoice = (v: unknown): v is ThemeChoice => v === 'auto' || v === 'sombre' || v === 'clair';

export function readThemeChoice(): ThemeChoice {
  try {
    const v = globalThis.localStorage?.getItem(KEY);
    return isChoice(v) ? v : 'auto';
  } catch {
    return 'auto';
  }
}

/** Le thème réellement affiché pour un choix, selon ce que demande le système. */
export function resolveTheme(choice: ThemeChoice, systemPrefersLight: boolean): 'sombre' | 'clair' {
  return choice === 'auto' ? (systemPrefersLight ? 'clair' : 'sombre') : choice;
}

const prefersLight = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches;

/** Un appareil pour lequel le flou coûte trop cher : peu de mémoire ou peu de cœurs. */
export function isSlowDevice(nav: { deviceMemory?: number; hardwareConcurrency?: number } = navigator): boolean {
  return (nav.deviceMemory !== undefined && nav.deviceMemory <= 2) || (nav.hardwareConcurrency !== undefined && nav.hardwareConcurrency <= 2);
}

export function applyTheme(choice: ThemeChoice = readThemeChoice()): void {
  const root = document.documentElement;
  const shown = resolveTheme(choice, prefersLight());
  root.dataset.theme = shown;
  root.classList.toggle('no-blur', isSlowDevice());
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', shown === 'clair' ? '#EEF0FA' : '#05060D');
}

export function setThemeChoice(choice: ThemeChoice): void {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    /* stockage indisponible : le choix vaut pour cette visite */
  }
  applyTheme(choice);
}

/** Au lancement : applique le thème, et suit le système tant que le choix est « comme le téléphone ». */
export function startTheme(): void {
  applyTheme();
  if (typeof matchMedia === 'function') matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => applyTheme());
}
