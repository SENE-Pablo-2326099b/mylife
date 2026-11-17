import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { migrate } from '../app/src/modules/finances/core/migrate';
import { position } from '../app/src/modules/finances/core/budget';
import { changeTracker, FactsDB } from '../app/src/modules/finances/data/facts';
import { readOld } from '../app/src/modules/finances/data/importOld';
import { parseTrStatement } from '../app/src/modules/finances/data/tradeRepublic';
import { applyTrImport, existingWealth, planTrImport } from '../app/src/modules/finances/data/trImport';
import { addGoalMove, removePortfolio, saveGoal, saveHolding, saveOp, savePortfolio } from '../app/src/modules/finances/data/wealth';

/** La gestion des placements dans le module (portage de l'app d'avant) : base des faits simulée, données fictives. */
let n = 0;
const fresh = () => {
  const d = new FactsDB(`placements-${++n}`);
  d.use(changeTracker);
  return d;
};

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

describe('placements dans le module', () => {
  it('un placement, une ligne avec sa position de départ, des mouvements et un recalage', async () => {
    const db = fresh();
    const pf = await savePortfolio({ name: 'PEA', provider: 'Courtier', wrapper: 'PEA' }, db);
    const h = await saveHolding({ portfolioId: pf, name: 'ETF Monde', assetClass: 'etf', price: 10000 }, { quantity: 10, invested: 90000 }, db);
    await saveOp({ holdingId: h, type: 'buy', date: '2099-01-02', quantity: 2, amount: 19000 }, db);
    await saveOp({ holdingId: h, type: 'dividend', date: '2099-01-03', quantity: 5, amount: 300 }, db);
    const holding = { ...(await db.table('holdings').get(h)), accountId: `pf:${pf}` };
    const ops = await db.table('investmentOps').toArray();
    // Le dividende n'a pas de quantité ; 12 parts au cours de 100 € ; 1 090 € investis.
    expect(ops.find((o) => o.type === 'dividend').quantity).toBe(0);
    expect(position(holding, ops)).toMatchObject({ quantity: 12, invested: 109000, value: 120000, gain: 11000 });
    // Recalé sur l'app du courtier : 11 parts à 95 € de prix moyen.
    await saveOp({ holdingId: h, type: 'adjust', date: '2099-01-04', quantity: 11, amount: 104500 }, db);
    expect(position(holding, await db.table('investmentOps').toArray())).toMatchObject({ quantity: 11, invested: 104500, value: 110000 });
    // La photo du jour suit, et le module voit le placement comme un compte.
    const snaps = await db.table('snapshots').toArray();
    expect(snaps.at(-1)).toMatchObject({ investments: 110000, invested: 104500 });
    const data = migrate((await readOld(db))!);
    expect(data.accounts.find((a) => a.id === `pf:${pf}`)).toMatchObject({ family: 'placements', name: 'PEA' });
    // Supprimer le placement emporte ses lignes et leurs mouvements.
    await removePortfolio(pf, db);
    expect([await db.table('holdings').count(), await db.table('investmentOps').count()]).toEqual([0, 0]);
  });

  it('un objectif suivi à la main, ses versements, et atteint', async () => {
    const db = fresh();
    const g = await saveGoal({ name: 'Voyage', target: 200000, deadline: '2027-06-30', monthly: 10000 }, db);
    await addGoalMove(g, 50000, db);
    await addGoalMove(g, -10000, db);
    const data = migrate((await readOld(db))!);
    expect(data.goals[0]).toMatchObject({ name: 'Voyage', target: 200000, accountId: null });
    expect(data.goalMoves.reduce((s, m) => s + m.amount, 0)).toBe(40000);
    await saveGoal({ id: g, name: 'Voyage', target: 200000, achievedAt: 5 }, db);
    expect((await db.table('goals').get(g)).achievedAt).toBe(5);
  });

  it('relevé Trade Republic : import dans la base des faits, sans double au second passage, annulable', async () => {
    const db = fresh();
    const st = parseTrStatement(PAGES);
    expect(st.trades).toHaveLength(8);
    const undo = await applyTrImport(planTrImport(st, await existingWealth(db), { createPlans: true }), db);
    expect([await db.table('portfolios').count(), await db.table('holdings').count(), await db.table('investmentOps').count(), await db.table('plans').count()]).toEqual([2, 3, 8, 1]);
    const again = planTrImport(st, await existingWealth(db), { createPlans: true });
    expect([again.portfolios.length, again.holdings.length, again.ops.length]).toEqual([0, 0, 0]);
    const data = migrate((await readOld(db))!);
    expect(data.accounts.filter((a) => a.family === 'placements').map((a) => a.name).sort()).toEqual(['Trade Republic CTO', 'Trade Republic PEA']);
    await undo();
    expect([await db.table('portfolios').count(), await db.table('investmentOps').count()]).toEqual([0, 0]);
  });
});
