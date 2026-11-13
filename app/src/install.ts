import { useSyncExternalStore } from 'react';

/**
 * Installer MyLife (une seule icône pour tout). Chrome et Edge proposent une invitation qu'on garde pour la déclencher
 * d'un bouton ; Safari (iPhone) s'installe par Partager → « Sur l'écran d'accueil » ; Firefox sur ordinateur ne sait pas.
 */
interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
let deferred: InstallPrompt | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function listenForInstall(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPrompt;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    emit();
  });
}

export type InstallState = 'installed' | 'prompt' | 'ios' | 'android-menu' | 'desktop-menu' | 'unsupported';

function compute(): InstallState {
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (installed || standalone) return 'installed';
  if (deferred) return 'prompt';
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
  if (/Android/.test(ua)) return 'android-menu';
  if (/Chrome|Edg/.test(ua)) return 'desktop-menu';
  return 'unsupported';
}

export function useInstallState(): InstallState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    compute,
  );
}

export const promptInstall = () => deferred?.prompt();
