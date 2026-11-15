import type { EndPolicy } from '../engine/schema';

/** « 300 » ou « 300,50 » → centimes ; null si ce n'est pas un montant. */
export const cents = (text: string): number | null => {
  const n = Number(text.replace(/\s/g, '').replace(',', '.'));
  return text.trim() && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
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
