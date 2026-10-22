// GÉNÉRÉ depuis MyLife/packages/ui — ne pas modifier ici (MyLife : npm run vendor).
import { useSyncExternalStore } from 'react';
import { glanceKey, readGlance, writeGlance, type MyLifeApp, type MyLifeGlance } from '../vendor/lumen';

/**
 * Aperçus des apps (« 23 € à dépenser aujourd'hui », « Push A », « Groupe Hellfest · 3 amis ») :
 * chaque app dépose le sien sur l'appareil, l'accueil et les Espaces les affichent. Rien n'est envoyé.
 */
const EVENT = 'mylife:glance';

function subscribe(fn: () => void): () => void {
  const onStorage = (e: StorageEvent) => (e.key === null || e.key.startsWith('mylife:glance:')) && fn();
  window.addEventListener('storage', onStorage);
  window.addEventListener(EVENT, fn);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(EVENT, fn);
  };
}

/** Dépose l'aperçu de cette app (null : rien à montrer). */
export function setGlance(app: MyLifeApp['id'], glance: Omit<MyLifeGlance, 'at'> | null): void {
  writeGlance(app, glance);
  window.dispatchEvent(new Event(EVENT));
}

export function useGlance(app: MyLifeApp['id']): MyLifeGlance | null {
  const raw = useSyncExternalStore(subscribe, () => localStorage.getItem(glanceKey(app)), () => null);
  // Relu depuis le texte (stable entre deux rendus tant qu'il ne change pas).
  return raw ? readGlance(app) : null;
}
