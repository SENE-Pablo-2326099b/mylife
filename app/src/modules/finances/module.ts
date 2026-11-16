import type { ModuleManifest } from '../../contract';
import { BudgetCard } from './BudgetCard';

export const finances: ModuleManifest = {
  id: 'finances',
  name: 'MyFinances',
  tagline: 'Budget et patrimoine',
  icon: 'card',
  tone: 'finances',
  status: 'active',
  entry: { href: '/argent' },
  cards: [{ id: 'finances.budget', title: 'Budget du jour', Component: BudgetCard }],
  // Le module vit à `/argent`. L'ancienne app reste servie à `/finances/` le temps de la bascule (étape M6) : les deux
  // partagent la même base de faits.
  nav: {
    base: '/argent',
    add: { to: '/argent/operations?ajouter=1', label: 'Une opération' },
    tabs: [
      { to: '/argent', label: 'Jour', icon: 'today', end: true },
      { to: '/argent/operations', label: 'Opérations', icon: 'list' },
      { to: '/argent/plan', label: 'Plan', icon: 'calendar', add: { to: '/argent/plan?ajouter=1', label: 'Un engagement' } },
      { to: '/argent/patrimoine', label: 'Patrimoine', icon: 'chart', add: { to: '/argent/patrimoine?ajouter=1', label: 'Un compte' } },
    ],
  },
  quickAdds: [{ id: 'finances.depense', label: 'Une dépense', detail: 'MyFinances · montant, catégorie', icon: 'card', href: '/argent/operations?ajouter=1' }],
};
