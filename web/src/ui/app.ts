// GÉNÉRÉ depuis MyLife/packages/ui — ne pas modifier ici (MyLife : npm run vendor).
import { MYLIFE_APPS, type MyLifeApp } from '../vendor/lumen';

/**
 * L'app qui utilise le kit (MyFinances, MyRave, l'accueil MyLife) : son nom dans les titres, la barre
 * latérale et le journal d'erreurs. Posée une fois au démarrage (`configureApp`), avant le premier rendu.
 */
export type KitAppId = MyLifeApp['id'] | 'home';

export interface KitApp {
  id: KitAppId;
  name: string;
  tagline: string;
  /** Chemin de l'app sous l'adresse MyLife, sans barre finale (« /finances » ; « » pour l'accueil). */
  base: string;
}

const HOME: KitApp = { id: 'home', name: 'MyLife', tagline: 'Tes apps, un seul compte', base: '' };

let current: KitApp = HOME;

export function configureApp(id: KitAppId): KitApp {
  const a = MYLIFE_APPS.find((x) => x.id === id);
  current = a ? { id: a.id, name: a.name, tagline: a.tagline, base: a.path.replace(/\/$/, '') } : HOME;
  return current;
}

export function kitApp(): KitApp {
  return current;
}

/** Ouvre une autre app MyLife, ou l'accueil (même adresse : la session et le thème suivent). */
export function openMyLifeApp(path: string): void {
  window.location.assign(path);
}
