import type { Account } from '../db/types';
import type { ISODate } from '../lib/dates';

/**
 * Couche « source de données » : tout ce qui alimente l'app en opérations passe par cette interface.
 * Aujourd'hui : Enable Banking (via le relais) et les données de démo.
 * Demain : un autre agrégateur (Bridge, GoCardless, Powens…) n'a qu'à implémenter `DataSource`.
 */
export interface IncomingTransaction {
  date: ISODate;
  bookingDate: ISODate | null;
  /** Centimes, signé (négatif = débit). */
  amount: number;
  currency: string;
  label: string;
  rawText: string;
  counterparty: string | null;
  counterpartyIban: string | null;
  pending: boolean;
  balanceAfter: number | null;
  externalId: string | null;
  mcc: string | null;
}

export interface FetchResult {
  transactions: IncomingTransaction[];
  balance: { amount: number; date: string } | null;
}

export interface DataSource {
  readonly id: Account['source'];
  /** Récupère les opérations d'un compte depuis `since` (inclus). */
  fetchAccount(account: Account, since: ISODate, until: ISODate): Promise<FetchResult>;
}

export class SourceError extends Error {
  constructor(
    message: string,
    /** La connexion n'est plus valide (consentement expiré / révoqué) : il faut se reconnecter. */
    public readonly sessionExpired = false,
    public readonly status?: number,
  ) {
    super(message);
  }
}
