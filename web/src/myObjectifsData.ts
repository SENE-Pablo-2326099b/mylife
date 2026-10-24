import { parseObjective } from './vendor/lumen';
import { defineCollection } from './ui/collectionSync';

/** Les objectifs de MyObjectifs, chiffrés et synchronisés (app de synchro `objectifs`, une ligne par objectif). */
export const objectives = defineCollection({ app: 'objectifs', name: 'items', parse: parseObjective, max: 100 });
