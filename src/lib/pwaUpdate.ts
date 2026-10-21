import { registerSW } from 'virtual:pwa-register';

let registration: ServiceWorkerRegistration | undefined;

/** Service worker : hors ligne + mise à jour automatique (rechargement quand une version arrive). */
export function startServiceWorker(): void {
  registerSW({
    immediate: true,
    onRegisteredSW(_url, reg) {
      registration = reg;
      // Une app installée peut rester ouverte longtemps : on vérifie toutes les heures.
      if (reg) setInterval(() => void reg.update().catch(() => undefined), 3600_000);
    },
  });
}

/**
 * Cherche une nouvelle version tout de suite. S'il y en a une, le service worker l'installe et la
 * page se recharge d'elle-même ; sinon on recharge quand même pour repartir des derniers fichiers.
 */
export async function checkForUpdate(): Promise<void> {
  try {
    await registration?.update();
  } catch {
    /* hors ligne : on recharge simplement */
  }
  setTimeout(() => window.location.reload(), 1500);
}
