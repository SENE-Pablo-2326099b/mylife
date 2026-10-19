/**
 * Cours de bourse et de crypto, via le relais (le navigateur ne contacte que son propre domaine).
 * Sources publiques sans clé : Yahoo Finance (ETF, actions, fonds ; conversion en euros) et CoinGecko
 * (crypto). Seuls des symboles partent vers ces services, jamais de montant ni d'information personnelle.
 */

export class MarketInputError extends Error {}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{
  status: number;
  ok: boolean;
  text(): Promise<string>;
}>;

const YAHOO = 'https://query1.finance.yahoo.com';
const COINGECKO = 'https://api.coingecko.com/api/v3';
const UA = { 'user-agent': 'Mozilla/5.0 (compatible; MyFinances relay)', accept: 'application/json' };

const YAHOO_SYMBOL = /^[A-Za-z0-9.\-=^]{1,24}$/;
const GECKO_ID = /^[a-z0-9-]{1,64}$/;

export interface QuoteItem {
  source: 'yahoo' | 'coingecko';
  symbol: string;
}

export interface Quote {
  /** Prix unitaire en euros. */
  price: number;
  currency: 'EUR';
  at: number;
}

async function getJson(fetchImpl: FetchLike, url: string): Promise<unknown> {
  const res = await fetchImpl(url, { method: 'GET', headers: UA });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return JSON.parse(await res.text()) as unknown;
}

function parseItems(body: Record<string, unknown>): QuoteItem[] {
  const raw = body.items;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 40) throw new MarketInputError('Paramètre invalide : items');
  return raw.map((i) => {
    const it = (i ?? {}) as Record<string, unknown>;
    const source = it.source;
    const symbol = typeof it.symbol === 'string' ? it.symbol.trim() : '';
    if (source === 'yahoo' && YAHOO_SYMBOL.test(symbol)) return { source, symbol };
    if (source === 'coingecko' && GECKO_ID.test(symbol)) return { source, symbol };
    throw new MarketInputError('Paramètre invalide : symbole');
  });
}

interface YahooMeta {
  regularMarketPrice?: number;
  currency?: string;
  regularMarketTime?: number;
}

async function yahooMeta(fetchImpl: FetchLike, symbol: string): Promise<YahooMeta> {
  const data = (await getJson(fetchImpl, `${YAHOO}/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`)) as {
    chart?: { result?: { meta?: YahooMeta }[] };
  };
  const meta = data.chart?.result?.[0]?.meta;
  if (!meta || typeof meta.regularMarketPrice !== 'number') throw new Error('cours introuvable');
  return meta;
}

/** Cours en euros. Les cotations hors euro sont converties au taux du jour (GBp = pence). */
export async function fetchQuotes(body: Record<string, unknown>, fetchImpl: FetchLike): Promise<{ quotes: Record<string, Quote | { error: string }> }> {
  const items = parseItems(body);
  const quotes: Record<string, Quote | { error: string }> = {};
  const gecko = items.filter((i) => i.source === 'coingecko').map((i) => i.symbol);
  if (gecko.length) {
    try {
      const data = (await getJson(fetchImpl, `${COINGECKO}/simple/price?ids=${gecko.join(',')}&vs_currencies=eur&include_last_updated_at=true`)) as Record<string, { eur?: number; last_updated_at?: number }>;
      for (const id of gecko) {
        const p = data[id];
        quotes[`coingecko:${id}`] = p && typeof p.eur === 'number' ? { price: p.eur, currency: 'EUR', at: (p.last_updated_at ?? Date.now() / 1000) * 1000 } : { error: 'Identifiant CoinGecko inconnu' };
      }
    } catch {
      for (const id of gecko) quotes[`coingecko:${id}`] = { error: 'CoinGecko injoignable' };
    }
  }
  const fx = new Map<string, number>();
  for (const { symbol } of items.filter((i) => i.source === 'yahoo')) {
    try {
      const meta = await yahooMeta(fetchImpl, symbol);
      let price = meta.regularMarketPrice as number;
      let cur = meta.currency ?? 'EUR';
      if (cur === 'GBp' || cur === 'GBX') {
        price /= 100;
        cur = 'GBP';
      }
      if (cur !== 'EUR') {
        let rate = fx.get(cur);
        if (rate === undefined) {
          rate = (await yahooMeta(fetchImpl, `${cur}EUR=X`)).regularMarketPrice as number;
          fx.set(cur, rate);
        }
        price *= rate;
      }
      quotes[`yahoo:${symbol}`] = { price, currency: 'EUR', at: (meta.regularMarketTime ?? Date.now() / 1000) * 1000 };
    } catch {
      quotes[`yahoo:${symbol}`] = { error: 'Symbole introuvable sur Yahoo Finance' };
    }
  }
  return { quotes };
}

export interface AssetHit {
  source: 'yahoo' | 'coingecko';
  symbol: string;
  name: string;
  assetClass: 'etf' | 'stock' | 'crypto' | 'fund' | 'other';
  exchange: string | null;
}

const YAHOO_CLASS: Record<string, AssetHit['assetClass']> = { ETF: 'etf', EQUITY: 'stock', MUTUALFUND: 'fund', CRYPTOCURRENCY: 'crypto' };

/** Recherche d'un actif par nom, ticker ou ISIN. */
export async function searchAssets(body: Record<string, unknown>, fetchImpl: FetchLike): Promise<{ results: AssetHit[] }> {
  const q = typeof body.query === 'string' ? body.query.trim() : '';
  if (q.length < 2 || q.length > 64 || [...q].some((c) => c.charCodeAt(0) < 32)) throw new MarketInputError('Paramètre invalide : query');
  const results: AssetHit[] = [];
  const [yahoo, gecko] = await Promise.allSettled([
    getJson(fetchImpl, `${YAHOO}/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0&listsCount=0`),
    getJson(fetchImpl, `${COINGECKO}/search?query=${encodeURIComponent(q)}`),
  ]);
  if (yahoo.status === 'fulfilled') {
    const quotes = ((yahoo.value as { quotes?: Record<string, unknown>[] }).quotes ?? []).slice(0, 8);
    for (const x of quotes) {
      const symbol = typeof x.symbol === 'string' ? x.symbol : '';
      const type = typeof x.quoteType === 'string' ? x.quoteType : '';
      if (!YAHOO_SYMBOL.test(symbol) || type === 'CRYPTOCURRENCY') continue;
      results.push({
        source: 'yahoo',
        symbol,
        name: String(x.longname ?? x.shortname ?? symbol),
        assetClass: YAHOO_CLASS[type] ?? 'other',
        exchange: typeof x.exchDisp === 'string' ? x.exchDisp : typeof x.exchange === 'string' ? x.exchange : null,
      });
    }
  }
  if (gecko.status === 'fulfilled') {
    const coins = ((gecko.value as { coins?: Record<string, unknown>[] }).coins ?? []).slice(0, 6);
    for (const c of coins) {
      const id = typeof c.id === 'string' ? c.id : '';
      if (!GECKO_ID.test(id)) continue;
      results.push({ source: 'coingecko', symbol: id, name: `${String(c.name ?? id)} (${String(c.symbol ?? '').toUpperCase()})`, assetClass: 'crypto', exchange: 'CoinGecko' });
    }
  }
  return { results };
}
