import { currentSession } from '@mylife/core/web';
import type { EbAspsp, EbBalance, EbGetSessionResponse, EbSession, EbStartAuthResponse, EbTransactionsPage } from './ebTypes';

/**
 * Le relais bancaire (Enable Banking), servi sur la même origine que MyLife : aucun autre domaine n'est contacté.
 * Le compte MyLife connecté suffit à s'y présenter ; un mot de passe du relais gardé sur l'appareil marche aussi.
 */
export const BRIDGE_URL = '/api/eb';

/** Une opération telle que la banque la donne, normalisée. Montant en centimes, signé (négatif = débit). */
export interface IncomingTransaction {
  date: string;
  bookingDate: string | null;
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

export class SourceError extends Error {
  constructor(
    message: string,
    /** L'accès n'est plus valide (consentement expiré ou révoqué) : il faut reconnecter la banque. */
    public readonly sessionExpired = false,
    public readonly status?: number,
  ) {
    super(message);
  }
}

export interface BridgeStatus {
  configured: boolean;
  authenticated: boolean;
  reachable: boolean;
  error?: string;
}

const EXPIRED_CODES = /EXPIRED|REVOKED|CLOSED|CANCELLED|SESSION|ACCESS_DENIED|CONSENT|ACCOUNT_DOES_NOT_EXIST/i;

export interface RelayAccess {
  bridgePassword: string;
  ebOwnApp?: { sealed: string } | null;
}

/** Peut-on se présenter au relais : compte MyLife connecté, ou mot de passe gardé sur l'appareil. */
export const canUseRelay = (access: RelayAccess): boolean => !!access.bridgePassword || !!currentSession();

export class Relay {
  constructor(
    private access: RelayAccess,
    private fetchImpl: typeof fetch = (...a) => fetch(...a),
  ) {}

  private async call<T>(op: string, payload: Record<string, unknown> = {}): Promise<T> {
    let res: Response;
    const token = currentSession()?.token;
    try {
      res = await this.fetchImpl(BRIDGE_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-bridge-password': this.access.bridgePassword,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(this.access.ebOwnApp?.sealed ? { 'x-eb-credentials': this.access.ebOwnApp.sealed } : {}),
        },
        body: JSON.stringify({ op, ...payload }),
        cache: 'no-store',
      });
    } catch {
      throw new SourceError('Relais injoignable : vérifie ta connexion internet.');
    }
    let data: Record<string, unknown> = {};
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      throw new SourceError(res.status === 404 ? 'Relais bancaire introuvable.' : `Réponse invalide du relais (${res.status}).`, false, res.status);
    }
    if (!res.ok) {
      const message = typeof data.error === 'string' ? data.error : `Erreur ${res.status}`;
      const code = typeof data.code === 'string' ? data.code : '';
      const expired = [401, 403, 404, 422].includes(res.status) && !/relais/i.test(message) && EXPIRED_CODES.test(`${code} ${message}`);
      throw new SourceError(message, expired, res.status);
    }
    return data as T;
  }

  async status(): Promise<BridgeStatus> {
    try {
      return { ...(await this.call<Omit<BridgeStatus, 'reachable'>>('status')), reachable: true };
    } catch (e) {
      const err = e as SourceError;
      return { configured: false, authenticated: false, reachable: err.status === 503, error: err.message };
    }
  }

  async aspsps(country = 'FR'): Promise<EbAspsp[]> {
    return (await this.call<{ aspsps: EbAspsp[] }>('aspsps', { country })).aspsps ?? [];
  }

  startAuth(p: { aspsp: { name: string; country: string }; redirectUrl: string; state: string; validUntil: string }) {
    return this.call<EbStartAuthResponse>('startAuth', p);
  }

  createSession(code: string) {
    return this.call<EbSession>('createSession', { code });
  }

  getSession(sessionId: string) {
    return this.call<EbGetSessionResponse>('getSession', { sessionId });
  }

  deleteSession(sessionId: string) {
    return this.call<unknown>('deleteSession', { sessionId });
  }

  async balances(accountUid: string): Promise<EbBalance[]> {
    return (await this.call<{ balances: EbBalance[] }>('balances', { accountUid })).balances ?? [];
  }

  transactionsPage(accountUid: string, dateFrom: string, dateTo: string, continuationKey?: string) {
    return this.call<EbTransactionsPage>('transactions', { accountUid, dateFrom, dateTo, continuationKey });
  }

  /** Cours en euros (via le relais). Clé : « source:symbole ». */
  async quotes(items: { source: 'yahoo' | 'coingecko'; symbol: string }[]): Promise<Record<string, { price: number; at: number } | { error: string }>> {
    return (await this.call<{ quotes: Record<string, { price: number; at: number } | { error: string }> }>('quotes', { items })).quotes ?? {};
  }

  /** Titres et cryptos dont le nom ou le symbole ressemble à la recherche. */
  async searchAsset(query: string): Promise<{ source: 'yahoo' | 'coingecko'; symbol: string; name: string; assetClass: 'etf' | 'stock' | 'crypto' | 'fund' | 'other'; exchange: string | null }[]> {
    return (await this.call<{ results: { source: 'yahoo' | 'coingecko'; symbol: string; name: string; assetClass: 'etf' | 'stock' | 'crypto' | 'fund' | 'other'; exchange: string | null }[] }>('searchAsset', { query })).results ?? [];
  }

  /** Cours de clôture quotidiens en euros sur les `days` derniers jours. */
  async priceHistory(source: 'yahoo' | 'coingecko', symbol: string, days: number): Promise<[string, number][]> {
    return (await this.call<{ prices: [string, number][] }>('priceHistory', { source, symbol, days })).prices ?? [];
  }
}
