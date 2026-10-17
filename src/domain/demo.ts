import { db, type BudgetDB } from '../db/db';
import type { Account, Settings } from '../db/types';
import { addDays, cycleFor, parseISO, todayISO, weekday, type ISODate } from '../lib/dates';
import type { IncomingTransaction } from '../sync/source';
import { classifyTransactions } from './classifyDb';
import { mergeTransactions } from './dedup';

const BNP_IBAN = 'FR7630004000039999999999901';
const REV_IBAN = 'FR7628233000019999999999902';

export const DEMO_ACCOUNTS: Account[] = [
  {
    id: 'demo:bnp',
    name: 'Compte de chèques (démo)',
    bank: 'BNP',
    iban: BNP_IBAN,
    currency: 'EUR',
    source: 'demo',
    connectionId: null,
    remoteUid: null,
    balance: 81240,
    balanceDate: null,
    lastSyncAt: null,
    lastSyncError: null,
    hidden: false,
  },
  {
    id: 'demo:rev',
    name: 'Personal (démo)',
    bank: 'Revolut',
    iban: REV_IBAN,
    currency: 'EUR',
    source: 'demo',
    connectionId: null,
    remoteUid: null,
    balance: 14327,
    balanceDate: null,
    lastSyncAt: null,
    lastSyncError: null,
    hidden: false,
  },
];

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
  account: 'bnp' | 'rev';
  date: ISODate;
  amount: number;
  label: string;
  raw?: string;
  counterpartyIban?: string;
  pending?: boolean;
}

/** ~6 semaines d'opérations réalistes, BNP + Revolut, finissant aujourd'hui. */
export function generateDemo(settings: Pick<Settings, 'payday'>, today: ISODate = todayISO(), days = 42): { bnp: IncomingTransaction[]; rev: IncomingTransaction[] } {
  const rand = rng(parseISO(today).y * 1000 + parseISO(today).m * 50 + 7);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
  const between = (min: number, max: number) => Math.round(min + rand() * (max - min));
  const drafts: Draft[] = [];
  const add = (d: Draft) => drafts.push(d);
  const start = addDays(today, -days + 1);
  const currentCycle = cycleFor(today, settings.payday);
  let deliveriesThisCycle = 0;

  for (let date = start; date <= today; date = addDays(date, 1)) {
    const { d } = parseISO(date);
    const wd = weekday(date);
    const weekend = wd === 0 || wd === 6;
    const isToday = date === today;
    const inCurrent = date >= currentCycle.start;

    // Revenus et prélèvements
    if (d === settings.payday) {
      add({ account: 'bnp', date, amount: 153700, label: 'CEA CADARACHE', raw: 'VIR SEPA RECU /DE CEA CADARACHE /MOTIF SALAIRE' });
    }
    if (d === settings.payday + 1 || (settings.payday >= 28 && d === 1)) {
      add({ account: 'bnp', date, amount: -45000, label: 'TRADE REPUBLIC BANK GMBH', raw: 'VIR SEPA EMIS /BEN TRADE REPUBLIC /MOTIF INVESTISSEMENT' });
    }
    if (d === settings.payday + 2 || (settings.payday >= 27 && d === 2)) {
      add({ account: 'bnp', date, amount: -20000, label: 'M PABLO SENE', raw: 'VIR SEPA INST EMIS /MOTIF Paiement envoyé par M PABLO SENE', counterpartyIban: REV_IBAN });
      add({ account: 'rev', date, amount: 20000, label: 'Payment from M PABLO SENE', counterpartyIban: BNP_IBAN });
    }
    if (d === 12) {
      add({ account: 'bnp', date, amount: -15000, label: 'Revolut', raw: 'VIR SEPA INST EMIS /BEN Revolut Bank UAB /REF Top up' });
      add({ account: 'rev', date: addDays(date, 1) <= today ? addDays(date, 1) : date, amount: 15000, label: 'Top-Up by *1234' });
    }
    if (d === 5) {
      add({ account: 'bnp', date, amount: 17000, label: 'CAF DES BOUCHES DU RHONE', raw: 'VIR SEPA RECU /DE CAF DES BOUCHES DU RHONE /MOTIF APL' });
      add({ account: 'bnp', date, amount: -25340, label: 'CROUS AIX MARSEILLE AVIGNON', raw: 'PRLV SEPA CROUS AIX MARSEILLE AVIGNON LOYER' });
    }
    if (d === 1) add({ account: 'bnp', date, amount: -2995, label: 'FITNESS PARK AIX', raw: 'PRLV SEPA FITNESS PARK' });
    if (d === 3) add({ account: 'rev', date, amount: -299, label: 'Google', raw: 'Google One' });
    if (d === 8) add({ account: 'bnp', date, amount: -1599, label: 'FREE MOBILE', raw: 'PRLV SEPA FREE MOBILE' });
    if (d === 10) add({ account: 'bnp', date, amount: -950, label: 'CARDIF ASSURANCE', raw: 'PRLV SEPA CARDIF IARD' });
    if (d === 14) add({ account: 'rev', date, amount: -2160, label: 'Anthropic', raw: 'CLAUDE.AI SUBSCRIPTION' });
    if (d === 20) add({ account: 'rev', date, amount: -1099, label: 'SoundCloud' });

    // Cantine en semaine
    if (!weekend && (rand() < 0.75 || isToday)) {
      add({ account: 'rev', date, amount: -between(330, 480), label: pick(['Eurest', 'Eurest', 'Eurest', 'Crous Aix', 'Cafeteria IUT']), raw: 'Eurest CEA Cadarache' });
    }
    if (!weekend && rand() < 0.35) add({ account: 'rev', date, amount: -between(120, 220), label: 'Le Campus', pending: isToday });

    // Courses
    if (rand() < 0.22 || (d % 6 === 0 && !isToday)) {
      add({ account: 'rev', date, amount: -between(1400, 4800), label: pick(['Intermarché', 'Intermarché', 'Intermarché', 'Albert Heijn', 'Huile Provençale']) });
    }
    // Transport
    if (!weekend && rand() < 0.45) add({ account: 'rev', date, amount: -150, label: 'Métropole Aix-Marseille-Provence' });
    if (rand() < 0.04) add({ account: 'rev', date, amount: -between(600, 1400), label: 'Sud Mobilités' });

    // Restos & sorties
    if (rand() < (weekend ? 0.45 : 0.18)) {
      add({ account: 'rev', date, amount: -between(700, 1500), label: pick(['Machou', "O'Tacos", 'Crouzzeria', 'Matefio', 'Porzione Fabrot', "L'Estello", 'Gazelle', 'Sb Aix']), pending: isToday });
    }
    if ((wd === 5 || wd === 6) && rand() < 0.6) add({ account: 'rev', date, amount: -between(900, 2600), label: pick(['Bar des PTT', 'Les Chansons Du', "Bel'Rencontre"]) });
    if (rand() < 0.12) add({ account: 'rev', date, amount: -between(700, 1200), label: 'Tabac Presse' });

    // Livraisons : 5 sur le cycle en cours pour déclencher l'alerte
    if (inCurrent && deliveriesThisCycle < 5 && (wd === 0 || wd === 3) && !isToday) {
      deliveriesThisCycle++;
      add({ account: 'rev', date, amount: -between(1700, 2700), label: pick(['Deliveroo', 'Uber Eats']) });
    } else if (!inCurrent && rand() < 0.07) {
      add({ account: 'rev', date, amount: -between(1700, 2700), label: 'Deliveroo' });
    }

    // Commerces non reconnus → file « à classer »
    if (rand() < 0.08) add({ account: 'rev', date, amount: -between(250, 900), label: pick(['Boulangerie du Cours', 'Kiosque Rotonde', 'Pharmacie Mirabeau']) });
  }

  // Événements ponctuels du cycle en cours
  const inCycle = (offset: number) => {
    const d = addDays(currentCycle.start, offset);
    return d <= today ? d : today;
  };
  add({ account: 'rev', date: inCycle(3), amount: -4499, label: 'Superdry' });
  add({ account: 'rev', date: inCycle(9), amount: -2999, label: 'AMZN Mktp FR', raw: 'Amazon.fr Marketplace' });
  add({ account: 'rev', date: inCycle(6), amount: -5900, label: 'GetLeveraged' });
  add({ account: 'rev', date: inCycle(4), amount: -3490, label: 'DistriProt' });
  add({ account: 'bnp', date: inCycle(11), amount: 2000, label: 'M LANCELOT SIMON', raw: 'VIR SEPA INST RECU /DE M LANCELOT SIMON /MOTIF resto' });
  add({ account: 'rev', date: inCycle(2), amount: -1500, label: 'Lancelot Simon', raw: 'Transfer to Lancelot Simon' });
  add({ account: 'rev', date: today, amount: -1650, label: 'Amazon', raw: 'AMZN Mktp FR', pending: true });

  const toIncoming = (x: Draft): IncomingTransaction => ({
    date: x.date,
    bookingDate: x.pending ? null : x.date,
    amount: x.amount,
    currency: 'EUR',
    label: x.label,
    rawText: x.raw ? `${x.label} | ${x.raw}` : x.label,
    counterparty: x.label,
    counterpartyIban: x.counterpartyIban ?? null,
    pending: !!x.pending,
    balanceAfter: null,
    externalId: null,
    mcc: null,
  });
  return {
    bnp: drafts.filter((x) => x.account === 'bnp').map(toIncoming),
    rev: drafts.filter((x) => x.account === 'rev').map(toIncoming),
  };
}

/** Charge (ou recharge) les données de démo et les classe avec les règles. */
export async function loadDemo(settings: Pick<Settings, 'payday'>, database: BudgetDB = db, today = todayISO()): Promise<number> {
  await clearDemo(database);
  const { bnp, rev } = generateDemo(settings, today);
  const now = Date.now();
  const rows = [...mergeTransactions('demo:bnp', [], bnp, 'demo', now).toAdd, ...mergeTransactions('demo:rev', [], rev, 'demo', now).toAdd];
  await database.transaction('rw', [database.accounts, database.transactions], async () => {
    await database.accounts.bulkPut(DEMO_ACCOUNTS.map((a) => ({ ...a, lastSyncAt: now })));
    await database.transactions.bulkPut(rows);
  });
  await classifyTransactions(database);
  return rows.length;
}

export async function clearDemo(database: BudgetDB = db): Promise<void> {
  await database.transaction('rw', [database.accounts, database.transactions], async () => {
    await database.transactions.where('source').equals('demo').delete();
    await database.accounts.where('source').equals('demo').delete();
  });
}

export async function hasDemo(database: BudgetDB = db): Promise<boolean> {
  return (await database.accounts.where('source').equals('demo').count()) > 0;
}
