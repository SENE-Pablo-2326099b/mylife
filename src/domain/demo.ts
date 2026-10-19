import { db, getMeta, setMeta, type BudgetDB } from '../db/db';
import { getSettings, updateSettings } from '../db/seed';
import type { Account, Category, Goal, GoalMove, Holding, InvestmentOp, InvestmentPlan, ManualAsset, Portfolio, Settings, Snapshot } from '../db/types';
import { addDays, cycleFor, diffDays, parseISO, todayISO, weekday, type ISODate } from '../lib/dates';
import type { IncomingTransaction } from '../sync/source';
import { classifyTransactions } from './classifyDb';
import { CAT } from './defaults';
import { mergeTransactions } from './dedup';
import { syncHolderRules } from './learn';
import { occurrences } from './plans';
import { cashHistory } from './wealth';

/**
 * Données de démo : six mois de la vie de « Camille Martin » (personne fictive). Deux banques et un
 * livret, un PEA d'ETF alimenté chaque mois, du bitcoin acheté chaque semaine, des objectifs, une
 * voiture et un prêt étudiant. Générées de façon déterministe à partir de la date du jour.
 */

const MAIN_IBAN = 'FR7610000000000000000000001';
const NEO_IBAN = 'FR7620000000000000000000002';
const LIVRET_IBAN = 'FR7610000000000000000000003';
const HOLDER = 'CAMILLE MARTIN';
const DEMO_DAYS = 182;

type Box = 'main' | 'neo' | 'livret';

export const DEMO_ACCOUNT_IDS: Record<Box, string> = { main: 'demo:main', neo: 'demo:neo', livret: 'demo:livret' };

function demoAccount(box: Box, balance: number, now: number): Account {
  const spec = {
    main: { name: 'Compte courant (démo)', bank: 'Ma Banque', iban: MAIN_IBAN, kind: 'current' as const },
    neo: { name: 'Compte (démo)', bank: 'Néobanque', iban: NEO_IBAN, kind: 'current' as const },
    livret: { name: 'Livret A (démo)', bank: 'Ma Banque', iban: LIVRET_IBAN, kind: 'savings' as const },
  }[box];
  return {
    id: DEMO_ACCOUNT_IDS[box],
    name: spec.name,
    bank: spec.bank,
    iban: spec.iban,
    currency: 'EUR',
    source: 'demo',
    connectionId: null,
    remoteUid: null,
    balance,
    balanceDate: null,
    lastSyncAt: now,
    lastSyncError: null,
    hidden: false,
    kind: spec.kind,
    nickname: null,
  };
}

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Draft {
  box: Box;
  date: ISODate;
  amount: number;
  label: string;
  raw?: string;
  iban?: string;
  pending?: boolean;
}

export const DEMO_PAYDAY = 28;

/** Opérations bancaires de la démo (180 jours finissant aujourd'hui). */
export function generateDemo(today: ISODate = todayISO(), payday = DEMO_PAYDAY, days = DEMO_DAYS): Record<Box, IncomingTransaction[]> {
  const { y, m } = parseISO(today);
  const rand = rng(y * 1000 + m * 50 + 11);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
  const between = (min: number, max: number) => Math.round(min + rand() * (max - min));
  const drafts: Draft[] = [];
  const add = (d: Draft) => drafts.push(d);
  const start = addDays(today, -days + 1);
  const cycle = cycleFor(today, payday);
  let deliveries = 0;

  for (let date = start; date <= today; date = addDays(date, 1)) {
    const { d } = parseISO(date);
    const wd = weekday(date);
    const weekend = wd === 0 || wd === 6;
    const isToday = date === today;
    const inCycle = date >= cycle.start;
    const monthsAgo = Math.floor(diffDays(date, today) / 30);

    // Revenus et charges fixes (compte courant)
    if (d === payday) add({ box: 'main', date, amount: 210000, label: 'ACME SAS', raw: 'VIR SEPA RECU /DE ACME SAS /MOTIF SALAIRE' });
    if (d === 5) add({ box: 'main', date, amount: -72000, label: 'FONCIA', raw: 'PRLV SEPA FONCIA GESTION LOYER' });
    if (d === 8) add({ box: 'main', date, amount: -5490, label: 'EDF', raw: 'PRLV SEPA EDF CLIENTS PARTICULIERS' });
    if (d === 10) add({ box: 'main', date, amount: -1240, label: 'MAIF', raw: 'PRLV SEPA MAIF ASSURANCE HABITATION' });
    // Hausse du forfait il y a deux mois : détectée comme changement de prix.
    if (d === 12) add({ box: 'main', date, amount: monthsAgo >= 2 ? -1599 : -1999, label: 'FREE MOBILE', raw: 'PRLV SEPA FREE MOBILE' });
    if (d === 3) add({ box: 'main', date, amount: -2999, label: 'BASIC FIT', raw: 'PRLV SEPA BASIC FIT FRANCE' });
    if (d === 1) add({ box: 'main', date, amount: -10000, label: 'Livret A', raw: 'VIR SEPA EMIS /BEN LIVRET A CAMILLE MARTIN', iban: LIVRET_IBAN });
    if (d === 1) add({ box: 'livret', date, amount: 10000, label: 'Virement reçu', raw: 'VIR SEPA RECU /DE CAMILLE MARTIN /MOTIF EPARGNE', iban: MAIN_IBAN });
    if (d === 2) add({ box: 'main', date, amount: -15000, label: 'TRADE REPUBLIC BANK', raw: 'VIR SEPA EMIS /BEN TRADE REPUBLIC BANK GMBH /MOTIF PLAN EPARGNE' });
    if (d === 1) {
      add({ box: 'main', date, amount: -80000, label: 'M CAMILLE MARTIN', raw: 'VIR SEPA INST EMIS /BEN M CAMILLE MARTIN', iban: NEO_IBAN });
      add({ box: 'neo', date, amount: 80000, label: 'Payment from CAMILLE MARTIN', iban: MAIN_IBAN });
    }
    if (d === 1) add({ box: 'main', date, amount: -8640, label: 'NAVIGO', raw: 'PRLV SEPA COMUTITRES NAVIGO ANNUEL' });

    // Abonnements (néobanque)
    if (d === 15) add({ box: 'neo', date, amount: -1349, label: 'Netflix', raw: 'NETFLIX.COM' });
    if (d === 20) add({ box: 'neo', date, amount: -1199, label: 'Spotify', raw: 'SPOTIFY P2B3C' });
    if (wd === 1) add({ box: 'neo', date, amount: -1000, label: 'Bitstack', raw: 'BITSTACK SAS ACHAT RECURRENT' });

    // Vie courante
    if (rand() < 0.12 || (wd === 6 && !isToday)) add({ box: 'neo', date, amount: -between(1400, 4200), label: pick(['Carrefour City', 'Lidl', 'Monoprix', 'Franprix', 'Picard']) });
    if (rand() < 0.35) add({ box: 'neo', date, amount: -between(120, 480), label: pick(['Boulangerie Ange', 'Boulangerie Paul', 'Maison Kayser']), raw: 'BOULANGERIE' });
    if (!weekend && rand() < 0.3) add({ box: 'neo', date, amount: -between(890, 1450), label: pick(['Sodexo Campus', 'Cojean', 'Prêt à Manger', 'Pokawa', 'Subway']), raw: 'RESTAURANT', pending: isToday });
    if (rand() < (weekend ? 0.22 : 0.05)) add({ box: 'neo', date, amount: -between(1400, 3800), label: pick(['Le Petit Bistrot', 'Pizzeria Napoli', 'Sushi Shop', "McDonald's", 'Starbucks']), raw: 'RESTAURANT' });
    if ((wd === 5 || wd === 6) && rand() < 0.35) add({ box: 'neo', date, amount: -between(1200, 3500), label: pick(['Le Comptoir Bar', 'UGC Ciné Cité', 'Pathé', 'Fnac Spectacles']) });
    if (rand() < 0.06) add({ box: 'neo', date, amount: -between(1100, 3900), label: pick(['SNCF Connect', 'Uber', 'BlaBlaCar']) });
    if (rand() < 0.05) add({ box: 'neo', date, amount: -between(600, 2400), label: 'Pharmacie du Centre' });
    if (rand() < 0.04) add({ box: 'neo', date, amount: -between(1500, 6500), label: pick(['Zara', 'Decathlon', 'Fnac', 'Action', 'Uniqlo']) });
    if (rand() < 0.04) add({ box: 'neo', date, amount: -between(900, 3400), label: 'AMZN Mktp FR', raw: 'AMAZON EU SARL' });

    // Livraisons : 5 sur le cycle en cours (alerte), quelques-unes avant.
    if (inCycle && deliveries < 5 && (wd === 0 || wd === 3) && !isToday) {
      deliveries++;
      add({ box: 'neo', date, amount: -between(1700, 2900), label: pick(['Deliveroo', 'Uber Eats']) });
    } else if (!inCycle && rand() < 0.05) add({ box: 'neo', date, amount: -between(1700, 2900), label: 'Deliveroo' });

    // Entre amis
    if (rand() < 0.04) add({ box: 'neo', date, amount: pick([-1500, 1500, 2000, -2500, 1200]), label: pick(['Lydia Julie B', 'Wero Thomas R', 'Lydia Inès K']), raw: 'LYDIA' });
    // Commerces inconnus → file « à classer »
    if (rand() < 0.04) add({ box: 'neo', date, amount: -between(400, 2600), label: pick(['Fromagerie Lemoine', 'Atelier Terre & Feu', 'Kiosque Saint-Paul']) });
  }

  // Événements ponctuels du cycle en cours (alertes, file à classer)
  const at = (offset: number) => {
    const d = addDays(cycle.start, offset);
    return d <= today ? d : today;
  };
  add({ box: 'neo', date: at(2), amount: -6900, label: 'Zara' });
  add({ box: 'neo', date: at(6), amount: -2999, label: 'AMZN Mktp FR', raw: 'AMAZON EU SARL' });
  add({ box: 'neo', date: addDays(today, -1) >= cycle.start ? addDays(today, -1) : today, amount: -1650, label: 'Amazon', raw: 'AMZN Mktp FR', pending: true });
  add({ box: 'neo', date: at(5), amount: -1850, label: 'Fromagerie Lemoine' });
  add({ box: 'neo', date: at(9), amount: -2200, label: 'Atelier Terre & Feu' });

  const toIncoming = (x: Draft): IncomingTransaction => ({
    date: x.date,
    bookingDate: x.pending ? null : x.date,
    amount: x.amount,
    currency: 'EUR',
    label: x.label,
    rawText: x.raw ? `${x.label} | ${x.raw}` : x.label,
    counterparty: x.label,
    counterpartyIban: x.iban ?? null,
    pending: !!x.pending,
    balanceAfter: null,
    externalId: null,
    mcc: null,
  });
  return {
    main: drafts.filter((x) => x.box === 'main').map(toIncoming),
    neo: drafts.filter((x) => x.box === 'neo').map(toIncoming),
    livret: drafts.filter((x) => x.box === 'livret').map(toIncoming),
  };
}

/** Cours simulé d'un actif : marche aléatoire déterministe qui finit à `end` aujourd'hui. */
function priceSeries(today: ISODate, days: number, end: number, vol: number, drift: number, seed: number): Map<ISODate, number> {
  const rand = rng(seed);
  const out = new Map<ISODate, number>();
  let p = end;
  for (let i = 0; i <= days; i++) {
    out.set(addDays(today, -i), Math.round(p * 100) / 100);
    p = p / (1 + drift + (rand() - 0.5) * vol);
  }
  return out;
}

interface DemoWealth {
  portfolios: Portfolio[];
  holdings: Holding[];
  ops: InvestmentOp[];
  plans: InvestmentPlan[];
  goals: Goal[];
  moves: GoalMove[];
  assets: ManualAsset[];
  prices: Map<string, Map<ISODate, number>>;
}

export function generateDemoWealth(today: ISODate = todayISO(), now = Date.now()): DemoWealth {
  const start = addDays(today, -DEMO_DAYS + 1);
  const etfPrices = priceSeries(today, DEMO_DAYS + 5, 562.3, 0.018, 0.0004, 7);
  const btcPrices = priceSeries(today, DEMO_DAYS + 5, 71250, 0.045, 0.0012, 13);
  const portfolios: Portfolio[] = [
    { id: 'demo-p-pea', name: 'PEA ETF', provider: 'Trade Republic', kind: 'broker', wrapper: 'PEA', order: 1, createdAt: now },
    { id: 'demo-p-btc', name: 'Bitcoin', provider: 'Bitstack', kind: 'crypto', wrapper: 'Crypto', order: 2, createdAt: now },
  ];
  const holdings: Holding[] = [
    { id: 'demo-h-cw8', portfolioId: 'demo-p-pea', name: 'Amundi MSCI World (CW8)', assetClass: 'etf', symbol: 'CW8.PA', quoteSource: 'yahoo', isin: 'LU1681043599', price: 56230, priceAt: now, order: 1, createdAt: now },
    { id: 'demo-h-btc', portfolioId: 'demo-p-btc', name: 'Bitcoin', assetClass: 'crypto', symbol: 'bitcoin', quoteSource: 'coingecko', isin: null, price: 7125000, priceAt: now, order: 1, createdAt: now },
  ];
  const plans: InvestmentPlan[] = [
    { id: 'demo-plan-cw8', holdingId: 'demo-h-cw8', amount: 15000, frequency: 'monthly', day: 2, startDate: start, active: true, lastRunDate: null, createdAt: now },
    { id: 'demo-plan-btc', holdingId: 'demo-h-btc', amount: 1000, frequency: 'weekly', day: 1, startDate: start, active: true, lastRunDate: null, createdAt: now },
  ];
  const ops: InvestmentOp[] = [];
  const op = (holdingId: string, date: ISODate, amount: number, price: number, planId: string | null, note: string) =>
    ops.push({ id: `demo-op-${holdingId}-${date}`, holdingId, date, type: 'buy', quantity: Math.round((amount / 100 / price) * 1e8) / 1e8, amount, planId, estimated: false, note, createdAt: now });
  op('demo-h-cw8', start, 180000, etfPrices.get(start) ?? 500, null, 'Position initiale');
  op('demo-h-btc', start, 40000, btcPrices.get(start) ?? 60000, null, 'Position initiale');
  for (const plan of plans) {
    const dates = occurrences(plan, addDays(start, 1), today);
    const prices = plan.holdingId === 'demo-h-cw8' ? etfPrices : btcPrices;
    for (const d of dates) op(plan.holdingId, d, plan.amount, prices.get(d) ?? 1, plan.id, 'Investissement programmé');
    plan.lastRunDate = dates[dates.length - 1] ?? null;
  }

  const goals: Goal[] = [
    { id: 'demo-g-urgence', name: 'Fonds d’urgence', emoji: '🛟', target: 500000, deadline: null, monthly: 10000, includeInBudget: true, linkKind: 'account', linkId: DEMO_ACCOUNT_IDS.livret, achievedAt: null, order: 1, createdAt: now },
    { id: 'demo-g-japon', name: 'Voyage au Japon', emoji: '✈️', target: 250000, deadline: addDays(today, 300), monthly: 12000, includeInBudget: false, linkKind: 'manual', linkId: null, achievedAt: null, order: 2, createdAt: now },
    { id: 'demo-g-ordi', name: 'Nouvel ordinateur', emoji: '💻', target: 120000, deadline: addDays(today, -20), monthly: 0, includeInBudget: false, linkKind: 'manual', linkId: null, achievedAt: now - 20 * 86400_000, order: 3, createdAt: now },
  ];
  const moves: GoalMove[] = [];
  for (let i = 0; i < 6; i++) moves.push({ id: `demo-gm-japon-${i}`, goalId: 'demo-g-japon', date: addDays(today, -i * 30 - 3), amount: 12000, note: '', createdAt: now });
  for (let i = 0; i < 4; i++) moves.push({ id: `demo-gm-ordi-${i}`, goalId: 'demo-g-ordi', date: addDays(today, -i * 30 - 25), amount: 30000, note: '', createdAt: now });
  const assets: ManualAsset[] = [
    { id: 'demo-a-car', name: 'Voiture', kind: 'asset', emoji: '🚗', value: 750000, updatedAt: now },
    { id: 'demo-a-loan', name: 'Prêt étudiant', kind: 'debt', emoji: '🎓', value: 380000, updatedAt: now },
  ];
  return { portfolios, holdings, ops, plans, goals, moves, assets, prices: new Map([['demo-h-cw8', etfPrices], ['demo-h-btc', btcPrices]]) };
}

/** Soldes de départ (il y a 6 mois) : les soldes actuels en découlent, cohérents avec l'historique. */
const START_BALANCE: Record<Box, number> = { main: 120000, neo: 30000, livret: 240000 };

interface DemoBackup {
  settings: Pick<Settings, 'firstName' | 'holderNames' | 'payday' | 'incomes' | 'fixedCharges' | 'savings' | 'onboarded'>;
  targets: [string, number | null][];
}

const DEMO_TARGETS: [string, number][] = [
  [CAT.courses, 26000],
  [CAT.restos, 22000],
  [CAT.livraison, 5000],
  [CAT.sorties, 9000],
  [CAT.shopping, 8000],
  [CAT.transport, 12000],
];

/** Charge (ou recharge) la démo. Les réglages de la personne fictive ne s'appliquent que sur une app vierge. */
export async function loadDemo(database: BudgetDB = db, today: ISODate = todayISO()): Promise<number> {
  await clearDemo(database, { keepSettings: true });
  const now = Date.now();
  const settings = await getSettings(database);
  const fresh = settings.incomes.length === 0 && settings.fixedCharges.length === 0;
  if (fresh && !(await getMeta<DemoBackup>('demoBackup', database))) {
    const cats = await database.categories.toArray();
    const backup: DemoBackup = {
      settings: { firstName: settings.firstName, holderNames: settings.holderNames, payday: settings.payday, incomes: settings.incomes, fixedCharges: settings.fixedCharges, savings: settings.savings, onboarded: settings.onboarded },
      targets: cats.map((c) => [c.id, c.target]),
    };
    await setMeta('demoBackup', backup, database);
    await updateSettings(
      {
        firstName: settings.firstName || 'Camille',
        holderNames: [...new Set([...settings.holderNames, HOLDER])],
        payday: DEMO_PAYDAY,
        incomes: [{ id: 'demo-i-salaire', label: 'Salaire', amount: 210000, day: DEMO_PAYDAY }],
        fixedCharges: [
          { id: 'demo-f-loyer', label: 'Loyer', amount: 72000, day: 5 },
          { id: 'demo-f-edf', label: 'Électricité', amount: 5490, day: 8 },
          { id: 'demo-f-maif', label: 'Assurance habitation', amount: 1240, day: 10 },
          { id: 'demo-f-free', label: 'Forfait mobile', amount: 1999, day: 12 },
          { id: 'demo-f-sport', label: 'Salle de sport', amount: 2999, day: 3 },
          { id: 'demo-f-streaming', label: 'Netflix et Spotify', amount: 2548, day: 15 },
        ],
        savings: { mode: 'auto', manual: 0 },
        onboarded: true,
      },
      database,
    );
    await database.transaction('rw', database.categories, async () => {
      for (const [id, target] of DEMO_TARGETS) await database.categories.update(id, { target });
    });
    await syncHolderRules((await getSettings(database)).holderNames, database);
  }

  const payday = (await getSettings(database)).payday;
  const gen = generateDemo(today, payday);
  const rows = (Object.keys(gen) as Box[]).flatMap((box) => mergeTransactions(DEMO_ACCOUNT_IDS[box], [], gen[box], 'demo', now).toAdd);
  const sum = (box: Box) => gen[box].filter((t) => !t.pending).reduce((s, t) => s + t.amount, 0);
  const accounts = (Object.keys(gen) as Box[]).map((box) => demoAccount(box, START_BALANCE[box] + sum(box), now));
  const wealth = generateDemoWealth(today, now);

  await database.transaction('rw', [database.accounts, database.transactions, database.portfolios, database.holdings, database.investmentOps, database.plans, database.goals, database.goalMoves, database.manualAssets], async () => {
    await database.accounts.bulkPut(accounts);
    await database.transactions.bulkPut(rows);
    await database.portfolios.bulkPut(wealth.portfolios);
    await database.holdings.bulkPut(wealth.holdings);
    await database.investmentOps.bulkPut(wealth.ops);
    await database.plans.bulkPut(wealth.plans);
    await database.goals.bulkPut(wealth.goals);
    await database.goalMoves.bulkPut(wealth.moves);
    await database.manualAssets.bulkPut(wealth.assets);
  });
  await classifyTransactions(database);

  // Historique du patrimoine : une photo par jour, cours simulés.
  const txs = await database.transactions.toArray();
  const from = addDays(today, -DEMO_DAYS + 1);
  const cash = cashHistory(accounts, txs, from, today);
  const snapshots: Snapshot[] = cash.map(({ date, cash: c }) => {
    let investments = 0;
    let invested = 0;
    for (const h of wealth.holdings) {
      const ops = wealth.ops.filter((o) => o.holdingId === h.id && o.date <= date);
      const q = ops.reduce((s, o) => s + o.quantity, 0);
      invested += ops.reduce((s, o) => s + o.amount, 0);
      investments += Math.round(q * (wealth.prices.get(h.id)?.get(date) ?? 0) * 100);
    }
    return { date, cash: c, investments, invested, other: 750000, debts: 380000 };
  });
  await database.snapshots.bulkPut(snapshots);
  const { refreshPlannedSavings } = await import('./wealthDb');
  await refreshPlannedSavings(database);
  return rows.length;
}

/** Retire la démo (et rétablit les réglages d'avant si elle les avait posés). */
export async function clearDemo(database: BudgetDB = db, opts: { keepSettings?: boolean } = {}): Promise<void> {
  const demoAccounts = await database.accounts.where('source').equals('demo').count();
  const isDemo = (id: string) => id.startsWith('demo-');
  await database.transaction(
    'rw',
    [database.accounts, database.transactions, database.portfolios, database.holdings, database.investmentOps, database.plans, database.goals, database.goalMoves, database.manualAssets, database.snapshots],
    async () => {
      await database.transactions.where('source').equals('demo').delete();
      await database.accounts.where('source').equals('demo').delete();
      await database.portfolios.filter((x) => isDemo(x.id)).delete();
      await database.holdings.filter((x) => isDemo(x.id)).delete();
      await database.investmentOps.filter((x) => isDemo(x.id) || x.holdingId.startsWith('demo-')).delete();
      await database.plans.filter((x) => isDemo(x.id)).delete();
      await database.goals.filter((x) => isDemo(x.id)).delete();
      await database.goalMoves.filter((x) => isDemo(x.id) || x.goalId.startsWith('demo-')).delete();
      await database.manualAssets.filter((x) => isDemo(x.id)).delete();
      // Les photos du patrimoine mêlaient la démo : on repart de zéro.
      if (demoAccounts > 0) await database.snapshots.clear();
    },
  );
  if (opts.keepSettings) return;
  const backup = await getMeta<DemoBackup>('demoBackup', database);
  if (backup) {
    await updateSettings(backup.settings, database);
    await database.transaction('rw', database.categories, async () => {
      for (const [id, target] of backup.targets) await database.categories.update(id, { target } as Partial<Category>);
    });
    await database.meta.delete('demoBackup');
    await syncHolderRules(backup.settings.holderNames, database);
  }
  const { refreshPlannedSavings } = await import('./wealthDb');
  await refreshPlannedSavings(database);
}

export async function hasDemo(database: BudgetDB = db): Promise<boolean> {
  return (await database.accounts.where('source').equals('demo').count()) > 0;
}
