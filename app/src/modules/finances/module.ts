import type { ModuleManifest } from '../../contract';
import { BudgetCard } from './BudgetCard';

export const finances: ModuleManifest = {
  id: 'finances',
  name: 'MyFinances',
  tagline: 'Budget du jour, opérations, patrimoine',
  icon: 'card',
  tone: 'finances',
  status: 'active',
  entry: { href: '/finances/', legacy: true },
  cards: [{ id: 'finances.budget', title: 'Budget du jour', Component: BudgetCard }],
  quickAdds: [{ id: 'finances.depense', label: 'Une dépense', detail: 'MyFinances · montant, catégorie', icon: 'card', href: '/finances/operations' }],
};
