import type { ModuleManifest } from '../contract';
import { finances } from './finances/module';
import { perf } from './perf/module';
import { rave } from './rave/module';

/**
 * Le registre des modules de MyLife : le seul endroit où la coquille les nomme. Ajouter un module, c'est ajouter son
 * dossier dans `modules/` et sa ligne ici ; rien d'autre ne change.
 */
const chef: ModuleManifest = {
  id: 'chef',
  name: 'MyChef',
  tagline: 'Courses et repas',
  icon: 'chef',
  tone: 'chef',
  status: 'soon',
  entry: { href: '/v5/modules' },
  cards: [],
  quickAdds: [],
};

export const MODULES: readonly ModuleManifest[] = [finances, perf, rave, chef];
