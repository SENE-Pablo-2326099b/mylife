import type { ModuleManifest } from '../../contract';
import { BudgetCard } from './BudgetCard';

export const finances: ModuleManifest = {
  id: 'finances',
  name: 'MyFinances',
  tagline: 'Budget et patrimoine',
  icon: 'card',
  tone: 'finances',
  status: 'active',
  entry: { href: '/finances/', legacy: true },
  cards: [{ id: 'finances.budget', title: 'Budget du jour', Component: BudgetCard }],
  // Le module repensé vit à `/argent` (adresse provisoire) tant que l'ancienne app garde `/finances/` et la synchro
  // bancaire (bascule à l'étape M6) : l'entrée du module y mène encore.
  nav: {
    base: '/argent',
    add: '/argent/operations?ajouter=1',
    tabs: [
      { to: '/argent', label: 'Jour', icon: 'today', end: true },
      { to: '/argent/operations', label: 'Opérations', icon: 'list' },
      { to: '/argent/plan', label: 'Plan', icon: 'calendar' },
      { to: '/argent/patrimoine', label: 'Patrimoine', icon: 'chart' },
    ],
  },
  quickAdds: [{ id: 'finances.depense', label: 'Une dépense', detail: 'MyFinances · montant, catégorie', icon: 'card', href: '/finances/operations' }],
};
