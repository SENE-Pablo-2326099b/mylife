import type { ISODate } from '../lib/dates';

/** Comment une catégorie compte dans le budget. */
export type CategoryKind =
  /** Dépense courante : consomme l'enveloppe « vie courante » et le budget du jour. */
  | 'variable'
  /** Charge fixe (loyer, abonnements) : comptée dans les dépenses du cycle, déjà prévue hors enveloppe. */
  | 'fixed'
  /** Revenus (salaire, APL…) : jamais comptés en dépense. */
  | 'income'
  /** Exclue du budget : transferts internes, épargne, remboursements entre amis. */
  | 'excluded';

export interface Category {
  id: string;
  name: string;
  emoji: string;
  color: string;
  kind: CategoryKind;
  /** Objectif de dépense par cycle, en centimes (null = pas d'objectif). */
  target: number | null;
  /** Compte dans la « part de la nourriture ». */
  isFood: boolean;
  order: number;
  /** Catégorie système (non supprimable). */
  system?: boolean;
}

export type RuleDirection = 'any' | 'debit' | 'credit';

export interface Rule {
  id: string;
  categoryId: string;
  /** Mot-clé (comparé sans accents ni casse) ou expression régulière. */
  pattern: string;
  isRegex: boolean;
  direction: RuleDirection;
  /** Montant absolu minimal / maximal en centimes pour que la règle s'applique. */
  minAmount: number | null;
  maxAmount: number | null;
  /** Pour les remboursements entre amis : nom de la personne. */
  person: string | null;
  /** Plus grand = prioritaire. */
  priority: number;
  /** Libellé lisible du commerçant (affichage). */
  label: string;
  enabled: boolean;
  createdAt: number;
}

export type CategorySource = 'rule' | 'manual' | 'transfer' | null;

export interface Transaction {
  /** Clé de déduplication stable (voir domain/dedup.ts). */
  id: string;
  accountId: string;
  /** Date d'opération (date de transaction si connue, sinon date de comptabilisation). */
  date: ISODate;
  bookingDate: ISODate | null;
  /** Montant signé en centimes : négatif = débit. */
  amount: number;
  currency: string;
  /** Libellé affiché (commerçant ou contrepartie). */
  label: string;
  /** Texte complet utilisé par le moteur de règles. */
  rawText: string;
  counterparty: string | null;
  counterpartyIban: string | null;
  /** Opération pas encore définitive (Revolut « en attente », statut PDNG/HOLD). */
  pending: boolean;
  /** Solde après opération si fourni par la banque. */
  balanceAfter: number | null;
  categoryId: string | null;
  categorySource: CategorySource;
  ruleId: string | null;
  person: string | null;
  transferPairId: string | null;
  note: string;
  source: 'enablebanking' | 'demo';
  /** Identifiant fourni par la banque (entry_reference / transaction_id), si présent. */
  externalId: string | null;
  mcc: string | null;
  createdAt: number;
  /** Remboursement d'une dépense précise (id de l'opération) : il la réduit au lieu d'être neutre. */
  refundOf?: string | null;
}

export interface Account {
  /** Stable entre deux connexions : "eb:<identification_hash>" ou "demo:…". */
  id: string;
  name: string;
  bank: string;
  iban: string | null;
  currency: string;
  source: 'enablebanking' | 'demo';
  /** Connexion (session Enable Banking) active pour ce compte. */
  connectionId: string | null;
  /** uid Enable Banking valable pour la session courante. */
  remoteUid: string | null;
  balance: number | null;
  balanceDate: string | null;
  lastSyncAt: number | null;
  lastSyncError: string | null;
  /** Masquer le compte dans les statistiques. */
  hidden: boolean;
  /** Compte courant, épargne… (cash_account_type Enable Banking). */
  kind?: AccountKind;
  /** Nom donné par l'utilisateur. */
  nickname?: string | null;
}

export type AccountKind = 'current' | 'savings' | 'card' | 'other';

export type ConnectionStatus = 'active' | 'expired' | 'revoked' | 'error';

export interface Connection {
  /** session_id Enable Banking */
  id: string;
  aspspName: string;
  aspspCountry: string;
  validUntil: string;
  createdAt: number;
  status: ConnectionStatus;
  accountIds: string[];
}

export interface AlertSettings {
  deliveries: { enabled: boolean; maxCount: number };
  amazon: { enabled: boolean; minAmount: number };
  dailyOverrun: { enabled: boolean; days: number };
  transportPass: { enabled: boolean; passPrice: number; keyword: string };
  categoryTarget: { enabled: boolean; warnPercent: number };
}

/** Une ligne de budget mensuelle (revenu ou charge fixe), saisie par l'utilisateur. */
export interface BudgetLine {
  id: string;
  label: string;
  /** Montant mensuel positif, en centimes. */
  amount: number;
  /** Jour du mois où il tombe (1-31), null = inconnu. Sert aux prévisions de trésorerie. */
  day: number | null;
  /**
   * Revenu versé directement à un tiers (ex. APL versée au CROUS) : compte dans le budget mais
   * n'arrive jamais sur le compte (la charge correspondante est débitée nette). Facultatif.
   */
  direct?: boolean;
}

/** Hypothèses de la projection d'indépendance financière (en points de base : 500 = 5 %). */
export interface FireSettings {
  annualReturnBp: number;
  inflationBp: number;
  /** Taux de retrait soutenable (règle des 4 % = 400). */
  withdrawalBp: number;
  /** Dépenses annuelles visées (null = estimées à partir des dépenses réelles). */
  annualSpendingOverride: number | null;
  /** Année de naissance (âge à l'indépendance, Coast FI). */
  birthYear: number | null;
  /** Âge de la retraite légale (Coast FI, pension). */
  retirementAge: number;
  /** Pension nette mensuelle estimée à la retraite, en euros d'aujourd'hui (centimes). */
  pensionMonthly: number;
  /** Frais annuels moyens des placements (points de base : 20 = 0,2 %). */
  feesBp: number;
  /** Comptes et placements exclus du capital (épargne de précaution, projet…). */
  excludedIds: string[];
  /** Catégories « essentielles » (Lean FI) ; null = choix par défaut (charges fixes, courses, santé, transport). */
  essentialCategoryIds: string[] | null;
  /** Dernier palier fêté (10 %, 25 %…), pour ne fêter chaque palier qu'une fois. */
  lastMilestone: number;
}

export interface Settings {
  id: 'main';
  /** Prénom affiché (facultatif). */
  firstName: string;
  /** Noms des titulaires tels qu'ils apparaissent sur les virements (détection des transferts internes). */
  holderNames: string[];
  /** L'accueil (premier lancement) a été fait. */
  onboarded: boolean;
  /** Jour de paie : début du cycle budgétaire. */
  payday: number;
  incomes: BudgetLine[];
  fixedCharges: BudgetLine[];
  /** Épargne / investissement mensuel prévu : calculé (plans + objectifs) ou saisi. */
  savings: { mode: 'auto' | 'manual'; manual: number };
  /** Somme mensuelle des plans d'investissement actifs et des objectifs (tenue à jour par l'app). */
  plannedSavingsAuto: number;
  /** Enveloppe vie courante saisie à la main (null = calculée). */
  envelopeOverride: number | null;
  alerts: AlertSettings;
  /** Mot de passe du relais (stocké uniquement sur l'appareil). */
  bridgePassword: string;
  /** Nombre de jours récupérés lors de la première synchro d'un compte. */
  initialSyncDays: number;
  /** Synchro automatique à l'ouverture si la dernière date de plus de N heures (0 = jamais). */
  autoSyncHours: number;
  /** Pays des banques proposées (code ISO). */
  bankCountry: string;
  /** Apparence : thème Lumen (voir src/ui/themes.ts), suivi du mode clair / sombre du téléphone. */
  theme: string;
  followSystem: boolean;
  haptics: boolean;
  reduceMotion: boolean;
  fire: FireSettings;
}

// ---------------------------------------------------------------- patrimoine

export type PortfolioKind = 'broker' | 'crypto' | 'savings' | 'retirement' | 'other';

/** Un portefeuille / une enveloppe de placement (Trade Republic CTO, PEA, Bitstack, Livret A…). */
export interface Portfolio {
  id: string;
  name: string;
  /** Établissement (texte libre) : aussi utilisé pour reconnaître les virements vers ce placement. */
  provider: string;
  kind: PortfolioKind;
  /** Enveloppe fiscale (CTO, PEA, AV, PER, livret…), texte libre. */
  wrapper: string;
  order: number;
  createdAt: number;
}

export type AssetClass = 'etf' | 'stock' | 'crypto' | 'bond' | 'fund' | 'cash' | 'other';
export type QuoteSource = 'yahoo' | 'coingecko' | 'manual';

/** Une ligne d'un portefeuille. Quantité et coût viennent des mouvements (InvestmentOp). */
export interface Holding {
  id: string;
  portfolioId: string;
  name: string;
  assetClass: AssetClass;
  /** Symbole du cours : ticker Yahoo (CW8.PA) ou identifiant CoinGecko (bitcoin). */
  symbol: string | null;
  quoteSource: QuoteSource;
  isin: string | null;
  /** Dernier cours unitaire connu, en centimes (peut avoir des décimales pour les très petits prix). */
  price: number | null;
  priceAt: number | null;
  order: number;
  createdAt: number;
  /**
   * Achats automatiques : chaque prélèvement bancaire dont le libellé contient ce mot (ex. « bitstack »)
   * devient un achat, au cours du jour du prélèvement. null = désactivé.
   */
  bankKeyword?: string | null;
  /** Prélèvements pris en compte à partir de cette date (les plus anciens sont dans le recalage). */
  bankLinkFrom?: string | null;
}

/** « adjust » = recalage : quantité et prix de revient total tels que les affiche le courtier, à cette date. */
export type InvestmentOpType = 'buy' | 'sell' | 'dividend' | 'fee' | 'interest' | 'adjust';

export interface InvestmentOp {
  id: string;
  holdingId: string;
  date: string;
  type: InvestmentOpType;
  /** Quantité (parts, BTC…). 0 pour dividendes, frais, intérêts. */
  quantity: number;
  /** Montant en centimes, positif (achat = sorti de ta poche ; vente / dividende = reçu). */
  amount: number;
  /** Généré par un plan d'investissement programmé. */
  planId: string | null;
  /** Quantité estimée au dernier cours connu (plan exécuté sans cours exact) : à vérifier. */
  estimated: boolean;
  note: string;
  createdAt: number;
  /** Achat créé à partir d'un prélèvement bancaire (id de l'opération bancaire). */
  bankTxId?: string | null;
}

export type PlanFrequency = 'weekly' | 'biweekly' | 'monthly';

/** Investissement programmé (DCA) : Trade Republic « plan d'épargne », Bitstack récurrent… */
export interface InvestmentPlan {
  id: string;
  holdingId: string;
  amount: number;
  frequency: PlanFrequency;
  /** Mensuel : jour du mois (1-31) ; hebdo : jour de la semaine (0 = dimanche). */
  day: number;
  startDate: string;
  active: boolean;
  /** Dernière échéance enregistrée (les suivantes sont créées au lancement de l'app). */
  lastRunDate: string | null;
  createdAt: number;
}

/** Objectif d'épargne : un montant, une date, une contribution mensuelle. */
export interface Goal {
  id: string;
  name: string;
  emoji: string;
  target: number;
  deadline: string | null;
  /** Contribution mensuelle prévue (comptée dans l'épargne du budget si includeInBudget). */
  monthly: number;
  includeInBudget: boolean;
  /** Suivi : versements saisis, ou solde d'un compte / valeur d'un portefeuille. */
  linkKind: 'manual' | 'account' | 'portfolio';
  linkId: string | null;
  achievedAt: number | null;
  order: number;
  createdAt: number;
}

export interface GoalMove {
  id: string;
  goalId: string;
  date: string;
  /** Positif = versement, négatif = retrait. */
  amount: number;
  note: string;
  createdAt: number;
}

/** Autre actif (immobilier, véhicule…) ou dette (prêt étudiant, crédit…), valeur saisie. */
export interface ManualAsset {
  id: string;
  name: string;
  kind: 'asset' | 'debt';
  emoji: string;
  value: number;
  updatedAt: number;
}

/** Photo quotidienne du patrimoine (historique). */
export interface Snapshot {
  date: string;
  cash: number;
  investments: number;
  invested: number;
  other: number;
  debts: number;
}

/** Choix de l'utilisateur sur une récurrence détectée. */
export interface RecurringOverride {
  key: string;
  status: 'confirmed' | 'ignored';
  label: string | null;
}

export interface MetaEntry {
  key: string;
  value: unknown;
}
