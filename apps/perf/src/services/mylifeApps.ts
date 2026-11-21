import { writeGlance, type MyLifeGlance } from '@/vendor/lumen';

/** Passer à MyFinances : même adresse (PWA MyLife), donc même compte et même connexion. */
export function openFinances(): void {
  window.location.assign('/finances/');
}

/** Ouvre une autre app MyLife par son chemin (« /raveloc/ ») : même adresse, même connexion. */
export function openMyLifeApp(path: string): void {
  window.location.assign(path);
}

/**
 * Aperçu de MyPerf pour l'accueil MyLife et les Espaces des autres apps (« Poussée + triceps · 6
 * exercices ») : même adresse, même stockage ; rien n'est envoyé. Valable jusqu'à minuit.
 */
export function publishGlance(glance: Omit<MyLifeGlance, 'at' | 'until'> | null): void {
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0);
  writeGlance('perf', glance && { ...glance, until: midnight.getTime() });
}
