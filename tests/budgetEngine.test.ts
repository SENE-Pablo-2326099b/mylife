import { describe, expect, it } from 'vitest';
import type { Settings, Transaction } from '../src/db/types';
import { computeBudget, daySeries, payDates, resolveCycle, splitIncomes, type BudgetInput } from '../src/domain/budgetEngine';
import { CAT, DEFAULT_CATEGORIES, DEFAULT_SETTINGS } from '../src/domain/defaults';
import { tx } from './helpers';

const cats = new Map(DEFAULT_CATEGORIES.map((c) => [c.id, c]));

// Paie de 1 500 € le 1er, APL de 200 € versée directement au CROUS, loyer CROUS débité net,
// forfait, 100 € d'épargne : enveloppe = 1 500 + 200 − (400 + 10) − 100 = 1 190 €.
const settings: Settings = {
  ...DEFAULT_SETTINGS,
  payday: 1,
  incomes: [
    { id: 'paie', label: 'Paie', amount: 150000, day: 1 },
    { id: 'apl', label: 'APL (versée au CROUS)', amount: 20000, day: 5, direct: true },
  ],
  fixedCharges: [
    { id: 'loyer', label: 'Loyer CROUS', amount: 40000, day: 5 },
    { id: 'forfait', label: 'Forfait Free Mobile', amount: 1000, day: 10 },
  ],
  savings: { mode: 'manual', manual: 10000 },
  envelopeOverride: null,
};
const ENVELOPE = 119000;

const salary = (date: string, amount = 150000) => tx({ id: `pay-${date}`, date, amount, label: 'VIR SALAIRE', categoryId: CAT.revenus });
const spend = (id: string, date: string, amount: number, categoryId: string | null = CAT.courses) => tx({ id, date, amount: -amount, categoryId });
const run = (txs: Transaction[], today: string, extra: Partial<BudgetInput> = {}) => computeBudget({ txs, cats, settings, today, ...extra });

describe('cycle de revenu à revenu', () => {
  it.each([
    ['2027-02-01', 28, '2027-02-28'],
    ['2026-04-01', 30, '2026-04-30'],
    ['2026-03-01', 31, '2026-03-31'],
  ])('cycle commençant le %s : %i jours', (today, length, end) => {
    const b = run([], today);
    expect(b.cycle).toMatchObject({ start: today, end, earlyBy: 0 });
    expect(b.length).toBe(length);
    expect(b.daysLeft).toBe(length);
    expect(b.dailyBudget).toBe(Math.floor(ENVELOPE / length));
  });

  it('jour de paie 31 : dernier jour des mois courts', () => {
    expect(resolveCycle('2027-02-28', 31, [])).toMatchObject({ start: '2027-02-28', end: '2027-03-30' });
    expect(resolveCycle('2027-02-27', 31, [])).toMatchObject({ start: '2027-01-31', end: '2027-02-27' });
  });

  it('paie arrivée un vendredi avant le dimanche 1er : le nouveau cycle commence ce jour-là', () => {
    const txs = [salary('2026-10-01'), salary('2026-10-30')];
    // La veille, l'ancien cycle se termine plus tôt que prévu… mais la paie n'est pas encore là.
    expect(run(txs.slice(0, 1), '2026-10-29').cycle).toMatchObject({ start: '2026-10-01', end: '2026-10-31' });
    const b = run(txs, '2026-10-30');
    expect(b.cycle).toMatchObject({ start: '2026-10-30', end: '2026-11-30', earlyBy: 2, payDate: '2026-10-30' });
    expect(b.daysLeft).toBe(32);
    // Et quelques jours plus tard, on est toujours dans ce cycle-là.
    expect(run(txs, '2026-11-03').cycle).toMatchObject({ start: '2026-10-30', end: '2026-11-30' });
    // L'ancien cycle, vu après coup, s'arrête la veille de la paie.
    expect(resolveCycle('2026-10-29', 1, payDates(txs, cats, settings))).toMatchObject({ start: '2026-10-01', end: '2026-10-29' });
  });

  it('paie en retard : le cycle commence quand même au jour prévu', () => {
    expect(run([salary('2026-11-03')], '2026-11-02').cycle).toMatchObject({ start: '2026-11-01', end: '2026-11-30', earlyBy: 0 });
  });

  it('changement d’année avec paie en avance', () => {
    const b = run([salary('2026-12-30')], '2026-12-31');
    expect(b.cycle).toMatchObject({ start: '2026-12-30', end: '2027-01-31', earlyBy: 2 });
  });

  it('un petit virement « revenu » n’ouvre pas de cycle', () => {
    expect(run([salary('2026-10-29', 3000)], '2026-10-30').cycle.start).toBe('2026-10-01');
  });
});

describe('enveloppe', () => {
  it('revenus (y compris versés directement) − charges fixes − épargne', () => {
    const b = run([], '2026-10-01');
    expect(b.envelope).toMatchObject({ income: 170000, incomeSource: 'settings', fixed: 41000, savings: 10000, exceptional: 0, coverage: 1, total: ENVELOPE });
  });

  it('premier cycle partiel : au prorata des jours couverts par les données', () => {
    const b = run([spend('a', '2026-10-16', 1000)], '2026-10-20', { dataStart: '2026-10-16' });
    expect(b.envelope.coverage).toBeCloseTo(16 / 31);
    expect(b.envelope.total).toBe(Math.round((ENVELOPE * 16) / 31));
    // Données antérieures au cycle : cycle complet.
    expect(run([], '2026-10-20', { dataStart: '2026-07-01' }).envelope.total).toBe(ENVELOPE);
  });

  it('revenu exceptionnel : neutre tant qu’il n’est pas affecté', () => {
    const caf = tx({ id: 'caf', date: '2026-10-12', amount: 45000, label: 'CAF RAPPEL APL', categoryId: CAT.revenus });
    const txs = [salary('2026-10-01'), caf];
    expect(splitIncomes(txs, cats, settings).exceptional.map((t) => t.id)).toEqual(['caf']);
    const b = run(txs, '2026-10-15');
    expect(b.envelope.total).toBe(ENVELOPE);
    expect(b.unallocated).toBe(45000);
    expect(b.exceptional).toEqual([{ tx: caf, allocation: null }]);

    const toBudget = run(txs, '2026-10-15', { allocations: { caf: 'envelope' } });
    expect(toBudget.envelope.total).toBe(ENVELOPE + 45000);
    expect(toBudget.unallocated).toBe(0);
    const aside = run(txs, '2026-10-15', { allocations: { caf: 'savings' } });
    expect(aside.envelope.total).toBe(ENVELOPE);
    expect(aside.unallocated).toBe(0);
  });

  it('sans revenus configurés : les revenus reçus dans le cycle servent de base', () => {
    const bare = { ...settings, incomes: [] };
    const b = computeBudget({ txs: [salary('2026-10-01', 120000)], cats, settings: bare, today: '2026-10-10' });
    expect(b.envelope).toMatchObject({ incomeSource: 'received', income: 120000, total: 120000 - 41000 - 10000 });
  });

  it('aucune donnée, rien de configuré : 0 €, pas de déficit, pas de plantage', () => {
    const b = computeBudget({ txs: [], cats, settings: DEFAULT_SETTINGS, today: '2026-10-21' });
    expect(b.envelope.total).toBe(0);
    expect(b.dailyBudget).toBe(0);
    expect(b.overrun).toBeNull();
    expect(b.status).toBe('warn');
    expect(b.projection.projectedEnd).toBe(0);
  });
});

describe('ce qui consomme l’enveloppe', () => {
  it('seules les dépenses variables', () => {
    const txs = [
      salary('2026-10-01'),
      spend('courses', '2026-10-02', 5000),
      spend('loyer', '2026-10-05', 20000, CAT.logement),
      spend('epargne', '2026-10-02', 10000, CAT.epargne),
      spend('inconnu', '2026-10-03', 700, null),
    ];
    expect(run(txs, '2026-10-10').spentBefore).toBe(5700);
  });

  it('transfert entre deux de mes comptes : neutre des deux côtés', () => {
    const out = tx({ id: 'out', accountId: 'banque', date: '2026-10-04', amount: -30000, categoryId: CAT.transferts, transferPairId: 'in' });
    const inn = tx({ id: 'in', accountId: 'neo', date: '2026-10-04', amount: 30000, categoryId: CAT.transferts, transferPairId: 'out' });
    const b = run([salary('2026-10-01'), out, inn], '2026-10-10');
    expect(b.spentBefore).toBe(0);
    expect(b.envelope.total).toBe(ENVELOPE);
    expect(b.unallocated).toBe(0);
  });

  it('remboursement entre particuliers : neutre, sauf rattaché à une dépense qu’il réduit', () => {
    const resto = spend('resto', '2026-10-03', 6000, CAT.restos);
    const free = tx({ id: 'lydia', date: '2026-10-06', amount: 2000, categoryId: CAT.remboursements });
    expect(run([resto, free], '2026-10-10').spentBefore).toBe(6000);
    const linked = { ...free, refundOf: 'resto' };
    expect(run([resto, linked], '2026-10-10').spentBefore).toBe(4000);
    // Le remboursement arrive aujourd'hui : la dépense (d'un jour passé) est réduite, pas aujourd'hui.
    const b = run([resto, { ...linked, date: '2026-10-10' }], '2026-10-10');
    expect(b.spentBefore).toBe(4000);
    expect(b.spentToday).toBe(0);
  });

  it('opération en attente comptée tout de suite, puis définitive : même total', () => {
    const pending = spend('p', '2026-10-10', 1500, CAT.restos);
    expect(run([{ ...pending, pending: true }], '2026-10-10').spentToday).toBe(1500);
    expect(run([{ ...pending, id: 'final', pending: false }], '2026-10-10').spentToday).toBe(1500);
  });
});

describe('budget du jour', () => {
  it('(enveloppe − dépenses d’avant aujourd’hui) ÷ jours restants, fixe pendant la journée', () => {
    const before = [salary('2026-10-01'), spend('a', '2026-10-05', 19000)];
    const morning = run(before, '2026-10-11');
    expect(morning.daysLeft).toBe(21);
    expect(morning.dailyBudget).toBe(Math.floor((ENVELOPE - 19000) / 21));
    const evening = run([...before, spend('b', '2026-10-11', 3000)], '2026-10-11');
    expect(evening.dailyBudget).toBe(morning.dailyBudget);
    expect(evening.remainingToday).toBe(morning.dailyBudget - 3000);
  });

  it('une journée économe fait remonter le budget des suivantes, un excès le fait baisser', () => {
    const base = [salary('2026-10-01')];
    const d1 = run(base, '2026-10-11').dailyBudget;
    const thrifty = run(base, '2026-10-12').dailyBudget;
    const lavish = run([...base, spend('x', '2026-10-11', 20000)], '2026-10-12').dailyBudget;
    expect(thrifty).toBeGreaterThan(d1);
    expect(lavish).toBeLessThan(d1);
  });

  it('dernier jour du cycle : tout le reste', () => {
    const b = run([salary('2026-10-01'), spend('a', '2026-10-05', 100000)], '2026-10-31');
    expect(b.daysLeft).toBe(1);
    expect(b.dailyBudget).toBe(ENVELOPE - 100000);
    expect(b.nextDailyBudget).toBe(0);
  });

  it('enveloppe dépassée : jamais de budget négatif, le déficit et 0 € par jour', () => {
    const b = run([salary('2026-10-01'), spend('a', '2026-10-05', ENVELOPE + 4100)], '2026-10-21');
    expect(b.dailyBudget).toBe(0);
    expect(b.overrun).toEqual({ deficit: 4100, maxPerDay: 0 });
    expect(b.status).toBe('bad');
    expect(b.nextDailyBudget).toBe(0);
    const worse = run([salary('2026-10-01'), spend('a', '2026-10-05', ENVELOPE + 4100), spend('b', '2026-10-21', 900)], '2026-10-21');
    expect(worse.overrun?.deficit).toBe(5000);
  });
});

describe('projection et charges réservées', () => {
  it('position de fin de cycle au rythme actuel et écart à la trajectoire', () => {
    // 10 jours écoulés, 50 € par jour.
    const txs = [salary('2026-10-01'), ...Array.from({ length: 10 }, (_, i) => spend(`d${i}`, `2026-10-${String(i + 1).padStart(2, '0')}`, 5000))];
    const b = run(txs, '2026-10-11');
    expect(b.projection.pace).toBe(5000);
    expect(b.projection.projectedSpend).toBe(5000 * 31);
    expect(b.projection.projectedEnd).toBe(ENVELOPE - 155000);
    expect(b.projection.ideal).toBe(Math.round((ENVELOPE * 11) / 31));
    expect(b.projection.gap).toBe(b.projection.ideal - 50000);
  });

  it('une charge prévue mais pas encore débitée reste réservée', () => {
    // Loyer CROUS débité net de l'APL : reconnu par son libellé, pas par son montant.
    const rent = tx({ id: 'crous', date: '2026-10-05', amount: -20000, label: 'PRLV CROUS AIX', categoryId: CAT.logement });
    const b = run([salary('2026-10-01'), rent], '2026-10-06', { balance: 130000 });
    expect(b.charges.map((c) => [c.line.id, c.paidBy?.id ?? null])).toEqual([
      ['loyer', 'crous'],
      ['forfait', null],
    ]);
    expect(b.reservedCharges).toBe(1000);
    expect(b.reservedSavings).toBe(10000);
    expect(b.realFree).toBe(130000 - 1000 - 10000);
  });
});

describe('série quotidienne', () => {
  it('même règle que le budget du jour (remboursements rattachés, budget jamais négatif)', () => {
    const cycle = { start: '2026-10-01', end: '2026-10-31' };
    const txs = [spend('a', '2026-10-01', 40000, CAT.restos), tx({ id: 'r', date: '2026-10-02', amount: 10000, categoryId: CAT.remboursements, refundOf: 'a' })];
    const s = daySeries(txs, cats, cycle, 31000, '2026-10-03');
    expect(s.map((p) => p.spent)).toEqual([30000, 0, 0]);
    expect(s[1].budget).toBe(33);
    expect(daySeries([spend('b', '2026-10-01', 99999)], cats, cycle, 31000, '2026-10-02')[1].budget).toBe(0);
  });
});

describe('réglages', () => {
  it('« versé directement » survit à la normalisation des réglages', async () => {
    const { normalizeSettings } = await import('../src/domain/settingsModel');
    const n = normalizeSettings({ ...settings });
    expect(n.incomes.find((l) => l.id === 'apl')?.direct).toBe(true);
    expect(n.incomes.find((l) => l.id === 'paie')).not.toHaveProperty('direct');
  });
});
