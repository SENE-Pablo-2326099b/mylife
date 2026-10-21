import type { EbAspsp, EbBalance, EbGetSessionResponse, EbSession, EbStartAuthResponse, EbTransactionsPage } from './ebTypes';
import { SourceError } from './source';

/** Le relais est servi sur la même origine que l'app (aucun autre domaine n'est contacté). */
export const BRIDGE_URL = '/api/eb';

export interface BridgeStatus {
  configured: boolean;
  authenticated: boolean;
  appIdSet?: boolean;
  privateKeySet?: boolean;
  reachable: boolean;
  error?: string;
}

const EXPIRED_CODES = /EXPIRED|REVOKED|CLOSED|CANCELLED|SESSION|ACCESS_DENIED|CONSENT|ACCOUNT_DOES_NOT_EXIST/i;

export class EbClient {
  constructor(private password: string, private fetchImpl: typeof fetch = (...a) => fetch(...a)) {}

  private async call<T>(op: string, payload: Record<string, unknown> = {}): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(BRIDGE_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-bridge-password': this.password },
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
      if (res.status === 404) throw new SourceError('Relais introuvable (/api/eb). Lance l’app avec `npm run dev` ou déploie-la sur Vercel / Netlify.', false, 404);
      throw new SourceError(`Réponse invalide du relais (${res.status}).`, false, res.status);
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
      const s = await this.call<Omit<BridgeStatus, 'reachable'>>('status');
      return { ...s, reachable: true };
    } catch (e) {
      const err = e as SourceError;
      if (err.status === 503) return { configured: false, authenticated: false, reachable: true, error: err.message };
      return { configured: false, authenticated: false, reachable: false, error: err.message };
    }
  }

  async aspsps(country = 'FR'): Promise<EbAspsp[]> {
    const r = await this.call<{ aspsps: EbAspsp[] }>('aspsps', { country });
    return r.aspsps ?? [];
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
    const r = await this.call<{ balances: EbBalance[] }>('balances', { accountUid });
    return r.balances ?? [];
  }

  transactionsPage(accountUid: string, dateFrom: string, dateTo: string, continuationKey?: string) {
    return this.call<EbTransactionsPage>('transactions', { accountUid, dateFrom, dateTo, continuationKey });
  }

  /** Cours en euros (Yahoo Finance / CoinGecko via le relais). Clé : "source:symbole". */
  async quotes(items: { source: 'yahoo' | 'coingecko'; symbol: string }[]): Promise<Record<string, { price: number; at: number } | { error: string }>> {
    const r = await this.call<{ quotes: Record<string, { price: number; at: number } | { error: string }> }>('quotes', { items });
    return r.quotes ?? {};
  }

  /** Cours de clôture quotidiens en euros (date ISO, prix en euros) sur les `days` derniers jours. */
  async priceHistory(source: 'yahoo' | 'coingecko', symbol: string, days: number): Promise<[string, number][]> {
    const r = await this.call<{ prices: [string, number][] }>('priceHistory', { source, symbol, days });
    return r.prices ?? [];
  }

  async searchAsset(query: string): Promise<AssetHit[]> {
    const r = await this.call<{ results: AssetHit[] }>('searchAsset', { query });
    return r.results ?? [];
  }
}

export interface AssetHit {
  source: 'yahoo' | 'coingecko';
  symbol: string;
  name: string;
  assetClass: 'etf' | 'stock' | 'crypto' | 'fund' | 'other';
  exchange: string | null;
}
