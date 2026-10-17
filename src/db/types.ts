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
}

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

export interface Settings {
  id: 'main';
  payday: number;
  salary: number;
  apl: number;
  activityBonus: number;
  fixedCharges: number;
  investment: number;
  /** Enveloppe vie courante saisie à la main (null = calculée). */
  envelopeOverride: number | null;
  /** Nom du titulaire tel qu'il apparaît dans les virements (détection des transferts internes). */
  ownerName: string;
  alerts: AlertSettings;
  /** Mot de passe du relais Enable Banking (stocké uniquement sur l'appareil). */
  bridgePassword: string;
  /** Nombre de jours récupérés lors de la première synchro d'un compte. */
  initialSyncDays: number;
  /** Synchro automatique à l'ouverture si la dernière date de plus de N heures (0 = jamais). */
  autoSyncHours: number;
}

export interface MetaEntry {
  key: string;
  value: unknown;
}
