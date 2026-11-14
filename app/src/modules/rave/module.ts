import type { ModuleManifest } from '../../contract';
import { GroupCard } from './GroupCard';

export const rave: ModuleManifest = {
  id: 'rave',
  name: 'MyRave',
  tagline: 'Sorties entre amis',
  icon: 'navigate',
  tone: 'rave',
  status: 'active',
  entry: { href: '/raveloc/', legacy: true },
  cards: [{ id: 'rave.groupe', title: 'Groupe en cours', Component: GroupCard }],
  quickAdds: [{ id: 'rave.sortie', label: 'Une sortie', detail: 'MyRave · proposer une date à tes amis', icon: 'flag', href: '/ancien/sorties' }],
};
