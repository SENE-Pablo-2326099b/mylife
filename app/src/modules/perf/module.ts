import type { ModuleManifest } from '../../contract';
import { SessionCard } from './SessionCard';

export const perf: ModuleManifest = {
  id: 'perf',
  name: 'MyPerf',
  tagline: 'Séances et progression',
  icon: 'barbell',
  tone: 'perf',
  status: 'active',
  entry: { href: '/sport' },
  // Refait page par page (phase 4) : Jour, la séance, Programme, Exercices, Progrès ; l'app d'avant reste à /perf/ pour ce qui n'est pas encore refait.
  nav: {
    base: '/sport',
    add: { to: '/sport?ajouter=1', label: 'Ajouter' },
    tabs: [
      { to: '/sport', label: 'Jour', icon: 'today', end: true },
      { to: '/sport/programme', label: 'Programme', icon: 'calendar' },
      { to: '/sport/exercices', label: 'Exercices', icon: 'barbell' },
      { to: '/sport/progres', label: 'Progrès', icon: 'chart' },
    ],
    focus: ['/sport/seance'],
    wide: ['/sport/seance'],
  },
  cards: [{ id: 'perf.seance', title: 'Séance du jour', Component: SessionCard }],
  quickAdds: [{ id: 'perf.demarrer', label: 'Une séance', detail: 'MyPerf · la séance prévue, ou une séance libre', icon: 'barbell', href: '/sport' }],
};
