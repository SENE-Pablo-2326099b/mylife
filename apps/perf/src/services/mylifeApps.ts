import { Linking, Platform } from 'react-native';

import { MYLIFE_URL } from '@/services/cloud/platform';
import { writeGlance, type MyLifeGlance } from '@/vendor/lumen';

/**
 * Passer à MyFinances : sur le web (PWA MyLife), même adresse, donc même compte et même connexion ;
 * dans l'app Android, MyFinances s'ouvre dans le navigateur (ou dans sa PWA si elle est installée).
 */
export function openFinances(): void {
  if (Platform.OS === 'web') window.location.assign('/finances/');
  else void Linking.openURL(`${MYLIFE_URL}/finances/`);
}

/** Ouvre une autre app MyLife par son chemin (« /raveloc/ ») : même adresse sur le web, navigateur dans l'app. */
export function openMyLifeApp(path: string): void {
  if (Platform.OS === 'web') window.location.assign(path);
  else void Linking.openURL(`${MYLIFE_URL}${path}`);
}

/**
 * Aperçu de MyPerf pour l'accueil MyLife et les Espaces des autres apps (« Poussée + triceps · 6
 * exercices »). Sur le web seulement : même adresse, même stockage ; rien n'est envoyé. Valable
 * jusqu'à minuit.
 */
export function publishGlance(glance: Omit<MyLifeGlance, 'at' | 'until'> | null): void {
  if (Platform.OS !== 'web') return;
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0);
  writeGlance('perf', glance && { ...glance, until: midnight.getTime() });
}
