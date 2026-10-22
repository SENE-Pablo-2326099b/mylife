/**
 * Serveur local de myRaveLoc (développement, tests de bout en bout) — jamais déployé : c'est celui de
 * MyLife (accueil, apps construites, vraies API sur une base en mémoire), avec l'app de ce dépôt.
 */
import { startLocalServer as startMyLife, type LocalServer } from '../../../server/local';

export type { LocalServer };

export function startLocalServer(opts: { port: number }): Promise<LocalServer> {
  return startMyLife({ port: opts.port, builds: { raveloc: new URL('../dist', import.meta.url).pathname } });
}
