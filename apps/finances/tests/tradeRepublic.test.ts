import { describe, expect, it } from 'vitest';
import { getMeta, setMeta } from '../src/db/db';
import { ensureSeeded } from '../src/db/seed';
import type { InvestmentOp, InvestmentPlan } from '../src/db/types';
import { buildDefaultRules, CAT } from '../src/domain/defaults';
import { compileRules, findMatchingRule } from '../src/domain/rules';
import { parseTrStatement } from '../src/domain/tradeRepublic';
import { applyTrImport, pickQuote, planTrImport } from '../src/domain/trImport';
import { freshDb } from './helpers';

// Relevé fictif au format exact du texte extrait d'un PDF Trade Republic (dates sur plusieurs
// lignes, en-têtes de page répétés, montants « 1 234,56 € »). Aucune donnée réelle.
const HEADER = `TRADE REPUBLIC BANK GMBH, BRANCH FRANCE   75 BOULEVARD HAUSSMANN   75008 PARIS
Trade Republic Bank GmbH, Branch France
www.traderepublic.fr
Généré le 2026-10-21 10:34:31 Europe/Paris (UTC+02:00)   Page 1 de 2 `;
const TABLE = `DATE   TYPE   DESCRIPTION   ENTRÉE
D'ARGENT
SORTIE
D'ARGENT   SOLDE `;

const PEA_PAGE = `${HEADER}
DATE   01 janv. 2026 - 20 oct. 2026
CAMILLE MARTIN
SYNTHÈSE DU RELEVÉ DE COMPTE
PRODUIT   SOLDE DÉBUT DE PÉRIODE   ENTRÉE D'ARGENT   SORTIE D'ARGENT   SOLDE FIN DE PÉRIODE
Compte PEA   0,00 €   151,00 €   150,00 €   1,00 €
TRANSACTIONS
${TABLE}
19
févr.
2026
Contribution à
l'activation du PEA   Activation PEA   1,00 €   1,00 €
02 juil.
2026   Exécution d'ordre   Buy trade FR0011550185 BNP PARIBAS EASY FR - BNP PARIBAS EASY S&P 500
UCITS ETF EUR C CAPITALISATION, quantity: 2   50,00 € -49,00 €
02 juil.
2026   Virement   Versement PEA   50,00 €   1,00 €
02
août
2026
Exécution d'ordre   Savings plan execution FR0011550185 BNP PARIBAS EASY FR - BNP PARIBAS
EASY S&P 500 UCITS ETF EUR C CAPITALISATION, quantity: 2   50,00 € -49,00 €
02
sept.
2026
Exécution d'ordre   Savings plan execution FR0011550185 BNP PARIBAS EASY FR - BNP PARIBAS
EASY S&P 500 UCITS ETF EUR C CAPITALISATION, quantity: 1.9   50,00 € -49,00 €
02 oct.
2026   Exécution d'ordre   Savings plan execution FR0011550185 BNP PARIBAS EASY FR - BNP PARIBAS
EASY S&P 500 UCITS ETF EUR C CAPITALISATION, quantity: 1.8   50,00 € -49,00 €
REMARQUES SUR LE RELEVÉ DE COMPTE
Veuillez vérifier votre relevé de compte, car toute contestation doit être faite 12 mars 2026 reçue immédiatement.`;

const CTO_PAGE_1 = `${HEADER}
DATE   01 janv. 2026 - 20 oct. 2026
IBAN   FR7600000000000000000000000
SYNTHÈSE DU RELEVÉ DE COMPTE
PRODUIT   SOLDE DÉBUT DE PÉRIODE   ENTRÉE D'ARGENT   SORTIE D'ARGENT   SOLDE FIN DE PÉRIODE
Compte courant   10,00 €   2 400,00 €   1 300,00 €   1 110,00 €
TRANSACTIONS
${TABLE}
01 févr.
2026   Intérêts   Interest payment   0,01 €   10,01 €
05 juin
2026   Virement   Incoming transfer from Camille Martin (FR7600000000000000000000001)   2 400,00 €   2 410,01 €
16 juin
2026
Exécution
d'ordre
Buy trade FR0010342592 MULTI UNITS FRANCE - Amundi Nasdaq-100 Daily (2x)
Leveraged UCITS ETF Acc, quantity: 0.5   1 000,00 €   1 410,01 € `;

const CTO_PAGE_2 = `${HEADER.replace('Page 1 de 2', 'Page 2 de 2')}
${TABLE}
03 août
2026
Exécution
d'ordre
Buy trade FR0010342592 MULTI UNITS FRANCE - Amundi Nasdaq-100 Daily (2x)
Leveraged UCITS ETF Acc, quantity: 10   100,00 €   1 310,01 €
20 août
2026   Dividende   Cash Dividend IE00B4L5Y983 iShares Core MSCI World, quantity: 3   1,23 €   1 311,24 €
25 sept.
2026
Exécution
d'ordre
Sell trade IE00B4L5Y983 iShares Core MSCI World UCITS ETF USD (Acc), quantity: 1   95,50 €   1 406,74 €
18 oct.
2026   Avoir   INTERMARCHE   7,55 €   1 399,19 €
APERÇU DU SOLDE
au 20 oct. 2026`;

const PAGES = [PEA_PAGE, 'Page de remarques sans tableau', CTO_PAGE_1, CTO_PAGE_2];

describe('relevé Trade Republic (PDF)', () => {
  const st = parseTrStatement(PAGES);

  it('lit la période et range chaque opération dans son compte', () => {
    expect(st.period).toEqual({ from: '2026-01-01', to: '2026-10-20' });
    expect(st.trades.map((t) => [t.account, t.date, t.kind, t.isin])).toEqual([
      ['CTO', '2026-06-16', 'buy', 'FR0010342592'],
      ['PEA', '2026-07-02', 'buy', 'FR0011550185'],
      ['PEA', '2026-08-02', 'buy', 'FR0011550185'],
      ['CTO', '2026-08-03', 'buy', 'FR0010342592'],
      ['CTO', '2026-08-20', 'dividend', 'IE00B4L5Y983'],
      ['PEA', '2026-09-02', 'buy', 'FR0011550185'],
      ['CTO', '2026-09-25', 'sell', 'IE00B4L5Y983'],
      ['PEA', '2026-10-02', 'buy', 'FR0011550185'],
    ]);
  });

  it('montants en centimes, noms sur plusieurs lignes, quantités décimales', () => {
    const first = st.trades.find((t) => t.date === '2026-07-02')!;
    expect(first.amount).toBe(5000);
    expect(first.name).toBe('BNP PARIBAS EASY FR - BNP PARIBAS EASY S&P 500 UCITS ETF EUR C CAPITALISATION');
    expect(first.savingsPlan).toBe(false);
    expect(st.trades.find((t) => t.date === '2026-09-02')?.quantity).toBe(1.9);
    expect(st.trades.find((t) => t.kind === 'dividend')?.amount).toBe(123);
    expect(st.trades.find((t) => t.kind === 'sell')).toMatchObject({ quantity: 1, amount: 9550 });
  });

  it('ignore activation, virements, intérêts, paiements par carte et texte hors tableau', () => {
    expect(st.trades).toHaveLength(8);
    expect(st.trades.some((t) => t.date === '2026-03-12' || t.date === '2026-10-18')).toBe(false);
  });

  it('détecte une division (le prix par part chute d’un coup) et remet les quantités à l’échelle', () => {
    expect(st.splits).toEqual([expect.objectContaining({ account: 'CTO', isin: 'FR0010342592', date: '2026-08-03', ratio: 200 })]);
    // 0,5 part à 2 000 € → 100 parts à 10 €.
    expect(st.trades.find((t) => t.date === '2026-06-16')?.quantity).toBe(100);
  });

  it('détecte les plans d’épargne et s’ils sont toujours en cours', () => {
    expect(st.plans).toEqual([
      expect.objectContaining({ account: 'PEA', isin: 'FR0011550185', amount: 5000, frequency: 'monthly', day: 2, first: '2026-08-02', last: '2026-10-02', active: true }),
    ]);
  });

  it('relevé sans tableau : rien', () => {
    expect(parseTrStatement(['Bonjour']).trades).toEqual([]);
  });
});

describe('import dans le patrimoine', () => {
  const st = parseTrStatement(PAGES);
  const empty = { portfolios: [], holdings: [], ops: [], plans: [] };

  it('crée un portefeuille par compte, une ligne par ISIN, un mouvement par exécution', () => {
    const plan = planTrImport(st, empty, { createPlans: true });
    expect(plan.portfolios.map((p) => [p.name, p.wrapper])).toEqual([
      ['Trade Republic PEA', 'PEA'],
      ['Trade Republic CTO', 'CTO'],
    ]);
    expect(plan.holdings).toHaveLength(3);
    expect(plan.holdings.find((h) => h.isin === 'FR0011550185')).toMatchObject({ assetClass: 'etf', name: 'BNP PARIBAS EASY S&P 500 UCITS ETF EUR C' });
    expect(plan.ops).toHaveLength(8);
    expect(plan.plans).toEqual([expect.objectContaining({ amount: 5000, frequency: 'monthly', day: 2, active: true, lastRunDate: '2026-10-20' })]);
  });

  it('réimporter ne crée aucun doublon et remplace les échéances estimées', async () => {
    const database = await freshDb();
    const first = planTrImport(st, empty, { createPlans: true });
    await applyTrImport(first, database);
    const pea = first.holdings.find((h) => h.isin === 'FR0011550185')!;
    const planId = first.plans[0].id;
    // Une échéance estimée créée par le plan, puis un relevé plus récent qui contient la vraie exécution.
    const estimated: InvestmentOp = { id: 'est', holdingId: pea.id, date: '2026-10-02', type: 'buy', quantity: 2, amount: 5000, planId, estimated: true, note: '', createdAt: 0 };
    await database.investmentOps.delete(first.ops.find((o) => o.date === '2026-10-02')!.id);
    await database.investmentOps.put(estimated);

    const load = async () => ({
      portfolios: await database.portfolios.toArray(),
      holdings: await database.holdings.toArray(),
      ops: await database.investmentOps.toArray(),
      plans: await database.plans.toArray(),
    });
    const second = planTrImport(st, await load(), { createPlans: true });
    expect(second.portfolios).toHaveLength(0);
    expect(second.holdings).toHaveLength(0);
    expect(second.ops.map((o) => o.date)).toEqual(['2026-10-02']);
    expect(second.ops[0].planId).toBe(planId);
    expect(second.removeOpIds).toEqual(['est']);
    expect(second.plans).toHaveLength(0);

    const undo = await applyTrImport(second, database);
    expect(await database.investmentOps.get('est')).toBeUndefined();
    expect(await database.investmentOps.count()).toBe(8);
    expect(planTrImport(st, await load(), { createPlans: true }).ops).toHaveLength(0);
    await undo();
    expect(await database.investmentOps.get('est')).toBeDefined();
  });

  it('rattache aux portefeuilles Trade Republic existants', () => {
    const portfolios = [
      { id: 'tr-pea', name: 'Mon PEA', provider: 'Trade Republic', kind: 'broker' as const, wrapper: 'PEA', order: 0, createdAt: 0 },
      { id: 'tr-cto', name: 'Trade Republic', provider: 'Trade Republic', kind: 'broker' as const, wrapper: 'CTO', order: 1, createdAt: 0 },
    ];
    const plans: InvestmentPlan[] = [];
    const plan = planTrImport(st, { portfolios, holdings: [], ops: [], plans }, { createPlans: false });
    expect(plan.portfolios).toHaveLength(0);
    expect(plan.portfolioOf).toEqual({ PEA: { id: 'tr-pea', name: 'Mon PEA', isNew: false }, CTO: { id: 'tr-cto', name: 'Trade Republic', isNew: false } });
    expect(plan.plans).toHaveLength(0);
  });

  it('choisit une cotation en euros, CoinGecko pour la crypto', () => {
    const hits = [
      { source: 'yahoo' as const, symbol: 'IUIT.L' },
      { source: 'yahoo' as const, symbol: 'QDVE.DE' },
      { source: 'coingecko' as const, symbol: 'bitcoin' },
    ];
    expect(pickQuote(hits, 'etf')?.symbol).toBe('QDVE.DE');
    expect(pickQuote(hits.slice(0, 1), 'etf')?.symbol).toBe('IUIT.L');
    expect(pickQuote(hits, 'crypto')?.symbol).toBe('bitcoin');
    expect(pickQuote([], 'etf')).toBeNull();
  });
});

describe('opérations de courtier synchronisées par la banque', () => {
  const rules = compileRules(buildDefaultRules([]));
  const cat = (label: string) => findMatchingRule(rules, { label, rawText: label, amount: -5000 })?.categoryId ?? null;

  it.each(['Buy trade FR0011550185 BNP PARIBAS EASY S&P 500', 'Savings plan execution IE00B4L5Y983', 'Versement PEA', 'Saveback execution', 'Exécution d’ordre'])('« %s » sort du budget', (label) => {
    expect(cat(label)).toBe(CAT.epargne);
  });

  it('la règle est ajoutée une fois aux installations existantes', async () => {
    const database = await freshDb();
    await database.rules.delete('default-broker-ops');
    await setMeta('addedRules', [], database);
    await ensureSeeded(database);
    expect(await database.rules.get('default-broker-ops')).toBeDefined();
    expect(await getMeta('addedRules', database)).toEqual(['default-broker-ops']);
    // Supprimée volontairement ensuite : elle ne revient pas.
    await database.rules.delete('default-broker-ops');
    await ensureSeeded(database);
    expect(await database.rules.get('default-broker-ops')).toBeUndefined();
  });
});
