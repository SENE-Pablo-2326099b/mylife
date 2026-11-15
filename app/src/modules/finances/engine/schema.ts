import type { ISODate } from '../core/dates';

/**
 * Le schéma du moteur financier de MyFinances V5 (docs/V5-MYFINANCES-MOTEUR.md, partie « Conception »).
 *
 * Deux règles portent tout :
 * - **le fait et son interprétation sont séparés** : une `Transaction` (ce que dit la banque) n'est jamais réécrite ;
 *   ce qu'on en dit vit dans ses `Allocation` (une ou plusieurs lignes) ;
 * - **tout est configurable, sauf le sens comptable d'un flux** (`Flow`, cinq valeurs) : c'est lui qui garantit les
 *   totaux. Aucune catégorie, aucun compte, aucune enveloppe n'a de comportement codé en dur.
 *
 * Montants en centimes entiers, dans la devise du compte ; dates « AAAA-MM-JJ ».
 */

/** Le rôle propose des valeurs par défaut ; ce sont les drapeaux du compte qui comptent dans les calculs. */
export type Role = 'CHECKING' | 'PROVISION' | 'SAVINGS' | 'INVESTMENT' | 'CASH' | 'ASSET' | 'LIABILITY';

export interface Account {
  id: string;
  name: string;
  provider: string;
  role: Role;
  /** Son solde fait partie de l'argent du quotidien. */
  includeInDailyCash: boolean;
  includeInNetWorth: boolean;
  currency: string;
  /** Part qui t'appartient (1 ; 0,5 pour un compte partagé à deux). */
  ownershipRatio: number;
  alertThreshold: number | null;
  /** Carte à débit différé : jour d'arrêté et jour de prélèvement. null : débit immédiat. */
  deferredDebit: { closingDay: number; debitDay: number } | null;
  source: 'bank' | 'manual';
  /** Solde connu, positif (une dette : ce qu'il reste à rembourser). null : inconnu. */
  balance: number | null;
  balanceAt: number | null;
  archivedAt: number | null;
}

/** Le fait bancaire. Jamais réécrit (sauf `pending`, quand la banque valide l'opération). */
export interface Transaction {
  id: string;
  accountId: string;
  date: ISODate;
  valueDate: ISODate | null;
  /** Signé : négatif = sorti du compte. */
  amount: number;
  rawLabel: string;
  pending: boolean;
  source: 'bank' | 'manual';
  merchantId: string | null;
  createdAt: number;
}

/** Le sens comptable d'un flux : la seule liste fermée du moteur. */
export type Flow = 'EXPENSE' | 'INCOME' | 'TRANSFER' | 'SAVING' | 'REFUND';

/** L'interprétation d'une transaction : une ou plusieurs lignes, dont la somme égale son montant. */
export interface Allocation {
  id: string;
  transactionId: string;
  /** Signé, comme la transaction. */
  amount: number;
  /** null : pas encore classée. */
  flow: Flow | null;
  categoryId: string | null;
  tagIds: string[];
  origin: 'rule' | 'merchant' | 'manual' | 'import';
  note: string;
  /** L'autre jambe d'un virement, ou la dépense qu'un remboursement rembourse. */
  linkedTransactionId?: string | null;
  /** L'échéance prévue que cette ligne règle (rapprochement fait à la main ; sinon le moteur le trouve). */
  occurrenceId?: string | null;
  /** L'achat d'un paiement fractionné : il pèse 0 dans le budget, ce sont ses échéances qui pèsent. */
  installmentPurchaseOf?: string | null;
  /** Part avancée pour quelqu'un (positive) : sortie du budget, suivie comme créance. */
  receivableAmount?: number;
  /** Ce remboursement solde une créance : il pèse 0. */
  settlesReceivableId?: string | null;
  fundedBySavings?: boolean;
  /** Dépense lissée sur le reste du cycle au lieu de peser sur la seule journée. */
  smoothed?: boolean;
  /** Revenu non prévu : compté dans le budget, fléché vers l'épargne, ou pas encore décidé (absent). */
  incomeUse?: 'BUDGET' | 'SAVINGS' | null;
}

export interface Category {
  id: string;
  /** Deux niveaux au plus. */
  parentId: string | null;
  scope: 'EXPENSE' | 'INCOME' | 'SAVING';
  name: string;
  color: string;
  order: number;
  archivedAt: number | null;
  /** Fusionnée dans une autre : son historique est lu comme celui de la cible. */
  mergedIntoId: string | null;
}

export interface Tag {
  id: string;
  name: string;
  archivedAt: number | null;
}

export type EndPolicy = 'RESET' | 'ROLLOVER' | 'AUTO_SAVE';

export interface Envelope {
  id: string;
  name: string;
  /** Plafond par cycle. null : pas de plafond. */
  cap: number | null;
  /** Compte dans le budget quotidien. Sinon son argent est mis à part (retiré du pot et du cash libre). */
  inDailyBudget: boolean;
  endPolicy: EndPolicy;
  overspendPolicy: 'DEDUCT_NEXT' | 'FORGIVE';
  /** Reçoit tout ce qui n'a pas d'enveloppe. Il y en a exactement une. */
  isDefault: boolean;
  order: number;
  /** Une catégorie appartient à une enveloppe au plus ; une sous-catégorie suit sa parente si elle n'en a pas. */
  categoryIds: string[];
}

export type CommitmentKind = 'INCOME' | 'CHARGE' | 'SAVING' | 'INSTALLMENT';
export type Rhythm = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'YEARLY' | 'ONCE';

/** Un engagement : ce qui est prévu, récurrent ou ponctuel. */
export interface Commitment {
  id: string;
  kind: CommitmentKind;
  label: string;
  /** Positif, par échéance. */
  amount: number;
  /** Écart toléré pour reconnaître son opération (0,2 = ±20 %). */
  tolerance: number;
  rhythm: Rhythm;
  /** MONTHLY : jour du mois (null : « d'ici la fin du cycle ») ; WEEKLY : jour de la semaine (0 = dimanche). */
  anchorDay: number | null;
  /** BIWEEKLY, YEARLY, ONCE : la date de référence. */
  anchorDate: ISODate | null;
  /** Compte débité ou crédité. null : n'importe quel compte du quotidien. */
  accountId: string | null;
  /** Mise de côté : le compte de destination. */
  counterAccountId: string | null;
  categoryId: string | null;
  startDate: ISODate | null;
  endDate: ISODate | null;
  /** Paiement fractionné : nombre d'échéances encore dues. null : sans fin. */
  remainingOccurrences: number | null;
  installmentPlanId: string | null;
  /** Revenu versé à un tiers (aide versée au bailleur) : compté dans le plan, jamais sur le compte. */
  direct: boolean;
  paused: boolean;
}

/** Une échéance décidée à la main (sautée, ou réglée par telle opération). Le reste est calculé. */
export interface OccurrenceOverride {
  /** `<engagement>@<date>`. */
  id: string;
  status: 'SKIPPED' | 'PAID';
  transactionId: string | null;
}

export interface InstallmentPlan {
  id: string;
  label: string;
  total: number;
  count: number;
  provider: string;
  purchaseTransactionId: string | null;
}

/** Une poche : de l'argent verrouillé sur un compte, ni libre ni épargné. */
export interface Provision {
  id: string;
  accountId: string;
  label: string;
  /** Verrouillé à ce jour, positif. */
  amount: number;
  /** Ce qu'elle couvre. Aucun lien : poche libre (réduit le cash libre, pas le budget théorique). */
  commitmentId: string | null;
  installmentPlanId: string | null;
  goalId: string | null;
  status: 'ACTIVE' | 'RELEASED' | 'CONSUMED';
}

export interface Receivable {
  id: string;
  person: string;
  amount: number;
  allocationId: string;
  status: 'OPEN' | 'SETTLED' | 'WRITTEN_OFF';
}

export interface EngineSettings {
  referenceCurrency: string;
  /** Jour de paie : début nominal du cycle. */
  payday: number;
  /** Une paie arrivée jusqu'à N jours avant ouvre le cycle ce jour-là. */
  earlyDays: number;
  /** L'engagement de revenu qui ouvre le cycle. null : le jour de paie seul. */
  openingCommitmentId: string | null;
  /** PRUDENT : le plus petit du budget et de la trésorerie ; CASH : la trésorerie seule. */
  mode: 'PRUDENT' | 'CASH';
  transferToleranceDays: number;
}

/** Tout ce que lit le moteur. */
export interface Db {
  accounts: Account[];
  transactions: Transaction[];
  allocations: Allocation[];
  categories: Category[];
  tags: Tag[];
  envelopes: Envelope[];
  commitments: Commitment[];
  occurrenceOverrides: OccurrenceOverride[];
  installmentPlans: InstallmentPlan[];
  provisions: Provision[];
  receivables: Receivable[];
  /** Reports du cycle précédent : global (pot du quotidien) et par enveloppe. Positif : excédent reporté. */
  carryIn: { global: number; envelopes: Record<string, number> };
  /** Cours vers la devise de référence (1 pour elle-même). */
  fx: Record<string, number>;
  settings: EngineSettings;
}

export const DEFAULT_SETTINGS: EngineSettings = { referenceCurrency: 'EUR', payday: 1, earlyDays: 7, openingCommitmentId: null, mode: 'PRUDENT', transferToleranceDays: 3 };

export const EMPTY_DB: Db = {
  accounts: [],
  transactions: [],
  allocations: [],
  categories: [],
  tags: [],
  envelopes: [{ id: 'env:default', name: 'Quotidien', cap: null, inDailyBudget: true, endPolicy: 'RESET', overspendPolicy: 'DEDUCT_NEXT', isDefault: true, order: 0, categoryIds: [] }],
  commitments: [],
  occurrenceOverrides: [],
  installmentPlans: [],
  provisions: [],
  receivables: [],
  carryIn: { global: 0, envelopes: {} },
  fx: {},
  settings: DEFAULT_SETTINGS,
};

/** Valeurs par défaut des drapeaux d'un compte selon son rôle (modifiables ensuite). */
export function roleDefaults(role: Role): Pick<Account, 'includeInDailyCash' | 'includeInNetWorth'> {
  return { includeInDailyCash: role === 'CHECKING' || role === 'CASH', includeInNetWorth: true };
}
