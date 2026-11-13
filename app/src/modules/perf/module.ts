import type { ModuleManifest } from '../../contract';
import { SessionCard } from './SessionCard';

export const perf: ModuleManifest = {
  id: 'perf',
  name: 'MyPerf',
  tagline: 'Séances et progression',
  icon: 'barbell',
  tone: 'perf',
  status: 'active',
  entry: { href: '/perf/', legacy: true },
  cards: [{ id: 'perf.seance', title: 'Séance du jour', Component: SessionCard }],
  quickAdds: [{ id: 'perf.demarrer', label: 'Une séance', detail: 'MyPerf · la séance prévue, ou une séance libre', icon: 'barbell', href: '/perf/' }],
};
