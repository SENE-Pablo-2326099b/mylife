/**
 * Navigation minimale : une pile d'écrans dans l'historique du navigateur (le bouton retour d'Android
 * et le geste d'iOS fonctionnent), sans routeur. L'adresse reste `/raveloc/` : rien à résoudre côté
 * serveur, et un lien d'invitation (`#rejoindre=…`) est lu puis effacé de la barre d'adresse.
 */
import { observable } from '../lib/observable';

export type Route =
  | { name: 'home' }
  | { name: 'groups' }
  | { name: 'create' }
  | { name: 'manage' }
  | { name: 'navigate'; uid: string }
  | { name: 'join'; token: string; key: string };

export const route = observable<Route>({ name: 'home' });

export function go(r: Route): void {
  history.pushState({ raveloc: r }, '');
  route.set(() => r);
}

export function replace(r: Route): void {
  history.replaceState({ raveloc: r }, '');
  route.set(() => r);
}

export function back(): void {
  if ((history.state as { raveloc?: Route } | null)?.raveloc && history.length > 1 && route.get().name !== 'home') history.back();
  else replace({ name: 'home' });
}

export function initNav(): void {
  const initial = (history.state as { raveloc?: Route } | null)?.raveloc;
  history.replaceState({ raveloc: initial ?? { name: 'home' } }, '', window.location.pathname + window.location.search);
  route.set(() => initial ?? { name: 'home' });
  window.addEventListener('popstate', (e) => {
    const r = (e.state as { raveloc?: Route } | null)?.raveloc;
    route.set(() => r ?? { name: 'home' });
  });
}
