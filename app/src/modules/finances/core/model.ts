import type { ISODate } from './dates';

/**
 * Le modèle de MyFinances V5 (docs/V5-MYFINANCES.md) : quatre notions, pas plus.
 * - **Compte** : tout endroit où il y a de l'argent, ou une dette. Le patrimoine est la somme des comptes.
 * - **Mouvement** : une opération, avec une **nature** décidée avant toute catégorie.
 * - **Marchand** : le libellé bancaire devenu un nom propre ; on classe le marchand une fois, ses mouvements suivent.
 * - **Prévu** : une seule liste de ce qui revient (revenus, charges, épargne) ; le reste à vivre en découle.
 * Montants en centimes entiers ; dates « AAAA-MM-JJ ».
 */

export type AccountFamily = 'quotidien' | 'epargne' | 'placements' | 'biens' | 'dettes';
export const FAMILIES: readonly { id: AccountFamily; name: string }[] = [
  { id: 'quotidien', name: 'Quotidien' },
  { id: 'epargne', name: 'Épargne' },
  { id: 'placements', name: 'Placements' },
  { id: 'biens', name: 'Biens' },
  { id: 'dettes', name: 'Dettes' },
];

export interface Account {
  id: string;
  family: AccountFamily;
  name: string;
  /** Banque, courtier, ou vide. */
  provider: string;
  /** `bank` : alimenté par la synchro bancaire ; `manual` : valeur ou mouvements saisis. */
  source: 'bank' | 'manual';
  /**
   * Ce que vaut le compte, en centimes, toujours positif (une dette vaut ce qu'il reste à rembourser). null : inconnu.
   * Pour un compte de placements, la valeur vient de ses lignes (`Holding`) : ce champ est alors ignoré.
   */
  balance: number | null;
  balanceAt: number | null;
  /** Enveloppe d'un compte de placements (PEA, CTO…), texte libre. */
  wrapper?: string;
  iban?: string | null;
  /** Hors des totaux. */
  hidden: boolean;
  order: number;
  createdAt: number;
}

export type Nature = 'depense' | 'revenu' | 'virement' | 'remboursement';
export const NATURES: readonly { id: Nature; name: string }[] = [
  { id: 'depense', name: 'Dépense' },
  { id: 'revenu', name: 'Revenu' },
  { id: 'virement', name: 'Virement' },
  { id: 'remboursement', name: 'Remboursement' },
];

/** Une part d'un mouvement ventilé (un ticket, deux catégories). Les parts somment au montant du mouvement. */
export interface Split {
  categoryId: string;
  /** Centimes, même signe que le mouvement. */
  amount: number;
}

export interface Movement {
  id: string;
  accountId: string;
  date: ISODate;
  /** Centimes signés : négatif = sorti du compte. */
  amount: number;
  /** Libellé d'origine (banque) ou saisi. */
  label: string;
  merchantId: string | null;
  /** null : à classer (on ne sait pas encore ce que c'est). */
  nature: Nature | null;
  /** Catégorie de dépense. Seulement pour une dépense (ou le remboursement d'une dépense). */
  categoryId: string | null;
  split?: Split[];
  /** Virement : l'autre compte, s'il est connu. */
  otherAccountId?: string | null;
  /** Les deux jambes d'un même virement portent le même identifiant. */
  pairId?: string | null;
  /** Virement vers l'épargne ou un placement : compte comme « mis de côté » dans le plan. */
  saving?: boolean;
  /** Remboursement : la dépense remboursée, ou la personne. */
  refundOf?: string | null;
  person?: string | null;
  note: string;
  pending: boolean;
  source: 'bank' | 'manual';
  /** Nature ou catégorie choisie à la main pour CE mouvement : ni le marchand ni une reprise ne l'écrasent. */
  edited: boolean;
  createdAt: number;
}

export interface Merchant {
  id: string;
  /** Nom affiché (« Carrefour City »). */
  name: string;
  /** Ce que sont ses mouvements, par défaut. null : à classer. */
  nature: Nature | null;
  categoryId: string | null;
  /** Classé par l'utilisateur (une reprise ne l'écrase pas). */
  edited: boolean;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  /** Charge fixe (loyer, abonnements) : payée par le plan, hors du budget du jour. */
  fixed: boolean;
  /** Budget par cycle en centimes ; null : pas de budget. */
  budget: number | null;
  order: number;
}

export type PlannedKind = 'revenu' | 'charge' | 'epargne';
export type Rhythm = 'weekly' | 'biweekly' | 'monthly';

/** Une ligne de ce qui revient. */
export interface Planned {
  id: string;
  kind: PlannedKind;
  label: string;
  /** Centimes, positif, par échéance. */
  amount: number;
  rhythm: Rhythm;
  /** Mensuel : jour du mois (1-31) ou null ; hebdo : jour de la semaine (0 = dimanche). */
  day: number | null;
  /** Compte concerné (épargne : le compte de destination). */
  accountId: string | null;
  /** Épargne : la ligne de placement ou l'objectif alimentés. */
  holdingId?: string | null;
  goalId?: string | null;
  /** Revenu versé à un tiers (aide versée au bailleur) : compte dans le plan, n'arrive pas sur le compte. */
  direct?: boolean;
  active: boolean;
  createdAt: number;
}

export interface FinanceSettings {
  /** Jour de paie : début du cycle. */
  payday: number;
}

// ---------------------------------------------------------------- placements et objectifs (repris tels quels)

export type AssetClass = 'etf' | 'stock' | 'crypto' | 'bond' | 'fund' | 'cash' | 'other';

export interface Holding {
  id: string;
  accountId: string;
  name: string;
  assetClass: AssetClass;
  symbol: string | null;
  quoteSource: 'yahoo' | 'coingecko' | 'manual';
  isin: string | null;
  price: number | null;
  priceAt: number | null;
  order: number;
  createdAt: number;
  bankKeyword?: string | null;
  bankLinkFrom?: string | null;
}

export type InvestmentOpType = 'buy' | 'sell' | 'dividend' | 'fee' | 'interest' | 'adjust';

export interface InvestmentOp {
  id: string;
  holdingId: string;
  date: string;
  type: InvestmentOpType;
  quantity: number;
  amount: number;
  estimated: boolean;
  note: string;
  createdAt: number;
  bankTxId?: string | null;
}

export interface Goal {
  id: string;
  name: string;
  target: number;
  deadline: string | null;
  /** Compte dont le solde fait l'avancement ; null : versements saisis. */
  accountId: string | null;
  achievedAt: number | null;
  order: number;
  createdAt: number;
}

export interface GoalMove {
  id: string;
  goalId: string;
  date: string;
  amount: number;
  note: string;
  createdAt: number;
}

/** Photo quotidienne du patrimoine. */
export interface Snapshot {
  date: string;
  cash: number;
  investments: number;
  invested: number;
  other: number;
  debts: number;
}

/** Tout MyFinances, en mémoire : ce que lisent les calculs et ce que produit la reprise. */
export interface FinanceData {
  accounts: Account[];
  movements: Movement[];
  merchants: Merchant[];
  categories: Category[];
  planned: Planned[];
  holdings: Holding[];
  investmentOps: InvestmentOp[];
  goals: Goal[];
  goalMoves: GoalMove[];
  snapshots: Snapshot[];
  settings: FinanceSettings;
}

export const EMPTY: FinanceData = { accounts: [], movements: [], merchants: [], categories: [], planned: [], holdings: [], investmentOps: [], goals: [], goalMoves: [], snapshots: [], settings: { payday: 1 } };

/** Catégories de départ d'un compte neuf : courantes, sans rien de personnel. */
export const DEFAULT_CATEGORIES: readonly Category[] = [
  ['courses', 'Courses', '#2dd4bf', false],
  ['restos', 'Restos et cafés', '#fbbf24', false],
  ['sorties', 'Sorties et loisirs', '#60a5fa', false],
  ['transport', 'Transport', '#a3e635', false],
  ['shopping', 'Shopping', '#fb923c', false],
  ['sante', 'Santé', '#c084fc', false],
  ['sport', 'Sport', '#6fe0a0', false],
  ['abonnements', 'Abonnements', '#5ccbe6', true],
  ['logement', 'Logement et énergie', '#f472b6', true],
  ['autres', 'Autres', '#94a3b8', false],
].map(([id, name, color, fixed], order) => ({ id: id as string, name: name as string, color: color as string, fixed: fixed as boolean, budget: null, order }));
