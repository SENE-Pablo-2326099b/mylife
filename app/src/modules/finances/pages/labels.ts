import { decimalToCents } from '../bank/money';
import type { Category, EndPolicy } from '../engine/schema';

/** « 300 » ou « 300,50 » → centimes, lus comme du texte (sans passer par un nombre à virgule) ; null si ce n'est pas un montant positif. */
export const cents = (text: string): number | null => {
  try {
    const c = decimalToCents(text);
    return c >= 0 ? c : null;
  } catch {
    return null;
  }
};
export const KIND = { INCOME: 'Revenu', CHARGE: 'Charge', SAVING: 'Épargne', INSTALLMENT: 'Échéance' } as const;
export const END: readonly (readonly [EndPolicy, string])[] = [
  ['RESET', 'Remis à zéro, proposé à l’épargne'],
  ['ROLLOVER', 'Reporté sur le cycle suivant'],
  ['AUTO_SAVE', 'Envoyé vers l’épargne (suggestion)'],
];
export const RHYTHM = { MONTHLY: 'par mois', WEEKLY: 'par semaine', BIWEEKLY: 'toutes les 2 semaines', YEARLY: 'par an', ONCE: 'une fois' } as const;
export const day = (iso: string) => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(new Date(`${iso}T12:00:00`));
export const FLOW = { EXPENSE: 'Dépense', INCOME: 'Revenu', TRANSFER: 'Virement entre mes comptes', SAVING: 'Mise de côté', REFUND: 'Remboursement' } as const;
export const FLOWS = Object.entries(FLOW) as [keyof typeof FLOW, string][];
export const ROLE = { CHECKING: 'Courant', PROVISION: 'Provision', SAVINGS: 'Épargne', INVESTMENT: 'Placement', CASH: 'Espèces', ASSET: 'Bien', LIABILITY: 'Dette' } as const;
export const ROLES = Object.entries(ROLE) as [keyof typeof ROLE, string][];
export const SCOPES = [['EXPENSE', 'Des dépenses'], ['INCOME', 'Des revenus'], ['SAVING', 'Des mises de côté']] as const;

/** Les catégories utilisables, parentes puis leurs sous-catégories (« Parente › Enfant »), pour une liste déroulante. */
export function categoryOptions(categories: readonly Category[]): (readonly [string, string])[] {
  const live = categories.filter((c) => !c.archivedAt && !c.mergedIntoId);
  const top = live.filter((c) => !c.parentId || !live.some((p) => p.id === c.parentId)).sort((a, b) => a.order - b.order);
  return top.flatMap((p) => [[p.id, p.name] as const, ...live.filter((c) => c.parentId === p.id).sort((a, b) => a.order - b.order).map((c) => [c.id, `${p.name} › ${c.name}`] as const)]);
}
