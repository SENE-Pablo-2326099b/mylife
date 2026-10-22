import { useSyncExternalStore } from 'react';

/**
 * Installer MyLife (une seule app pour tout l'écosystème). Chrome et Edge proposent une invitation
 * qu'on garde pour la déclencher d'un bouton ; Safari (iPhone) s'installe par Partager → « Sur l'écran
 * d'accueil » ; Firefox sur ordinateur ne sait pas installer.
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

function standalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function compute(): InstallState {
  if (installed || standalone()) return 'installed';
  if (deferred) return 'prompt';
  const ua = navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/android/i.test(ua)) return 'android-menu';
  if (/firefox/i.test(ua)) return 'unsupported';
  return 'desktop-menu';
}

export function useInstallState(): InstallState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    compute,
    () => 'unsupported',
  );
}

/** Ouvre l'invitation du navigateur ; renvoie vrai si l'utilisateur a accepté. */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const p = deferred;
  deferred = null;
  await p.prompt();
  const { outcome } = await p.userChoice;
  emit();
  return outcome === 'accepted';
}
