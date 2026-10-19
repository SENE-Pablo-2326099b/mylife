import { describe, expect, it, vi } from 'vitest';
import { handleBridge } from '../server/bridge';

/** Faux Internet : répond selon l'URL demandée par le relais. */
function web(routes: Record<string, unknown>) {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (url: string) => {
    calls.push(url);
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return { status: 404, ok: false, text: async () => '{}' };
    return { status: 200, ok: true, text: async () => JSON.stringify(routes[key]) };
  });
  return { fetchImpl, calls };
}

const chart = (price: number, currency: string) => ({ chart: { result: [{ meta: { regularMarketPrice: price, currency, regularMarketTime: 1_790_000_000 } }] } });
// Mot de passe seul : les cours ne demandent pas la configuration Enable Banking.
const env = { password: 'pw' };
const req = (body: unknown, password = 'pw') => ({ method: 'POST', headers: { 'x-bridge-password': password }, body });

describe('cours via le relais', () => {
  it('crypto (CoinGecko), ETF en euros et action en dollars convertie (Yahoo)', async () => {
    const { fetchImpl, calls } = web({
      'simple/price?ids=bitcoin': { bitcoin: { eur: 73543.2, last_updated_at: 1_790_000_000 } },
      'chart/CW8.PA': chart(707.87, 'EUR'),
      'chart/AAPL': chart(200, 'USD'),
      'chart/USDEUR%3DX': chart(0.9, 'EUR'),
      'chart/VUSA.L': chart(9000, 'GBp'),
      'chart/GBPEUR%3DX': chart(1.2, 'EUR'),
    });
    const res = await handleBridge(
      req({
        op: 'quotes',
        items: [
          { source: 'coingecko', symbol: 'bitcoin' },
          { source: 'yahoo', symbol: 'CW8.PA' },
          { source: 'yahoo', symbol: 'AAPL' },
          { source: 'yahoo', symbol: 'VUSA.L' },
          { source: 'yahoo', symbol: 'NOPE' },
        ],
      }),
      env,
      fetchImpl,
    );
    expect(res.status).toBe(200);
    const q = (res.body as { quotes: Record<string, { price?: number; error?: string }> }).quotes;
    expect(q['coingecko:bitcoin']?.price).toBe(73543.2);
    expect(q['yahoo:CW8.PA']?.price).toBe(707.87);
    expect(q['yahoo:AAPL']?.price).toBeCloseTo(180, 6);
    expect(q['yahoo:VUSA.L']?.price).toBeCloseTo(108, 6); // 9 000 pence = 90 £ → 108 €
    expect(q['yahoo:NOPE']?.error).toMatch(/introuvable/);
    // Seuls des symboles partent vers les services de cours.
    expect(calls.every((u) => u.startsWith('https://query1.finance.yahoo.com/') || u.startsWith('https://api.coingecko.com/'))).toBe(true);
  });

  it('recherche par nom ou ISIN, fusion des deux sources', async () => {
    const { fetchImpl } = web({
      'finance/search': { quotes: [{ symbol: 'CW8.PA', longname: 'Amundi MSCI World', quoteType: 'ETF', exchDisp: 'Paris' }, { symbol: 'BTC-EUR', quoteType: 'CRYPTOCURRENCY' }] },
      '/search?query': { coins: [{ id: 'bitcoin', name: 'Bitcoin', symbol: 'btc' }] },
    });
    const res = await handleBridge(req({ op: 'searchAsset', query: 'world' }), env, fetchImpl);
    expect(res.body).toEqual({
      results: [
        { source: 'yahoo', symbol: 'CW8.PA', name: 'Amundi MSCI World', assetClass: 'etf', exchange: 'Paris' },
        { source: 'coingecko', symbol: 'bitcoin', name: 'Bitcoin (BTC)', assetClass: 'crypto', exchange: 'CoinGecko' },
      ],
    });
  });

  it('valide les entrées et exige le mot de passe', async () => {
    const { fetchImpl } = web({});
    expect((await handleBridge(req({ op: 'quotes', items: [{ source: 'yahoo', symbol: '../../etc' }] }), env, fetchImpl)).status).toBe(400);
    expect((await handleBridge(req({ op: 'quotes', items: [] }), env, fetchImpl)).status).toBe(400);
    expect((await handleBridge(req({ op: 'searchAsset', query: 'a\u0001b' }), env, fetchImpl)).status).toBe(400);
    expect((await handleBridge(req({ op: 'quotes', items: [{ source: 'coingecko', symbol: 'bitcoin' }] }, 'faux'), env, fetchImpl)).status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
