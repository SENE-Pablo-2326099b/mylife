import { describe, expect, it } from 'vitest';
import type { Settings } from '../src/db/types';
import { computeBudget, dailySeries, isVariable, overrunStreaks, spent, statusFor } from '../src/domain/budget';
import type { Transaction } from '../src/db/types';
import { CAT, DEFAULT_SETTINGS, computeEnvelope } from '../src/domain/defaults';
import { PROFILE, PROFILE_CATEGORIES } from './profile';
import { tx } from './helpers';

const cats = new Map(PROFILE_CATEGORIES.map((c) => [c.id, c]));
const settings: Settings = { ...PROFILE };
const computeDailyBudget = (txs: Transaction[], c: typeof cats, st: Settings, today: string) => computeBudget({ txs, cats: c, settings: st, today });

describe('enveloppe', () => {
  it('par défaut = revenus − charges fixes − investissement', () => {
    expect(computeEnvelope(settings)).toBe(153700 + 17000 - 35900 - 45000);
    expect(computeEnvelope({ ...settings, incomes: [...settings.incomes, { id: 'b', label: 'Prime', amount: 10000, day: null }] })).toBe(99800);
    // Épargne calculée à partir des plans et objectifs
    expect(computeEnvelope({ ...settings, savings: { mode: 'auto', manual: 45000 }, plannedSavingsAuto: 20000 })).toBe(153700 + 17000 - 35900 - 20000);
    // Nouvel utilisateur : rien de saisi, enveloppe nulle
    expect(computeEnvelope(DEFAULT_SETTINGS)).toBe(0);
    expect(computeEnvelope({ ...settings, envelopeOverride: 70000 })).toBe(70000);
  });
});

describe('ce qui compte comme dépense', () => {
  it('courantes oui ; fixes, transferts, épargne, revenus, remboursements non', () => {
    expect(isVariable({ categoryId: CAT.restos, amount: -100 }, cats)).toBe(true);
    expect(isVariable({ categoryId: CAT.logement, amount: -100 }, cats)).toBe(false);
    expect(isVariable({ categoryId: CAT.transferts, amount: -100 }, cats)).toBe(false);
    expect(isVariable({ categoryId: CAT.epargne, amount: -100 }, cats)).toBe(false);
    expect(isVariable({ categoryId: CAT.remboursements, amount: -100 }, cats)).toBe(false);
    expect(isVariable({ categoryId: CAT.revenus, amount: 100 }, cats)).toBe(false);
  });
  it('non classé : débit compté, crédit ignoré', () => {
    expect(isVariable({ categoryId: null, amount: -100 }, cats)).toBe(true);
    expect(isVariable({ categoryId: null, amount: 100 }, cats)).toBe(false);
  });
  it('un remboursement commerçant vient en déduction', () => {
    expect(spent([tx({ id: '1', amount: -5000, date: 'x', categoryId: CAT.shopping }), tx({ id: '2', amount: 2000, date: 'x', categoryId: CAT.shopping })], cats)).toBe(3000);
  });
});

describe('budget du jour', () => {
  it('début de cycle : enveloppe ÷ durée du cycle', () => {
    const b = computeDailyBudget([], cats, settings, '2026-09-26');
    expect(b.cycle).toMatchObject({ start: '2026-09-26', end: '2026-10-25', earlyBy: 0 });
    expect(b.daysLeft).toBe(30);
    expect(b.dailyBudget).toBe(Math.floor(89800 / 30)); // 2993
    expect(b.status).toBe('good');
  });

  it('(enveloppe − dépenses du cycle) ÷ jours restants jusqu’au 25', () => {
    const txs = [
      tx({ id: '1', amount: -30000, date: '2026-10-01', categoryId: CAT.courses }),
      tx({ id: '2', amount: -25340, date: '2026-10-05', categoryId: CAT.logement }), // charge fixe : hors enveloppe
      tx({ id: '3', amount: -45000, date: '2026-09-27', categoryId: CAT.epargne }), // exclu
      tx({ id: '4', amount: -1000, date: '2026-10-17', categoryId: CAT.restos }), // aujourd'hui
      tx({ id: '5', amount: -9999, date: '2026-09-20', categoryId: CAT.restos }), // cycle précédent
    ];
    const b = computeDailyBudget(txs, cats, settings, '2026-10-17');
    expect(b.daysLeft).toBe(9);
    expect(b.spentBefore).toBe(30000);
    expect(b.spentToday).toBe(1000);
    expect(b.dailyBudget).toBe(Math.floor((89800 - 30000) / 9)); // 6644
    expect(b.remainingToday).toBe(6644 - 1000);
    expect(b.remainingCycle).toBe(89800 - 31000);
    expect(b.nextDailyBudget).toBe(Math.floor(58800 / 8));
  });

  it('dernier jour du cycle : tout le reste', () => {
    const b = computeDailyBudget([tx({ id: '1', amount: -80000, date: '2026-10-01', categoryId: CAT.courses })], cats, settings, '2026-10-25');
    expect(b.daysLeft).toBe(1);
    expect(b.dailyBudget).toBe(9800);
  });

  it('enveloppe épuisée → rouge, budget du jour à 0 et déficit affiché', () => {
    const b = computeDailyBudget([tx({ id: '1', amount: -95000, date: '2026-10-01', categoryId: CAT.courses })], cats, settings, '2026-10-17');
    expect(b.dailyBudget).toBe(0);
    expect(b.overrun).toEqual({ deficit: 95000 - 89800, maxPerDay: 0 });
    expect(b.status).toBe('bad');
  });

  it('février (28 jours) et changement d’année', () => {
    expect(computeDailyBudget([], cats, settings, '2027-02-26').daysLeft).toBe(28);
    const jan = computeDailyBudget([], cats, settings, '2027-01-01');
    expect(jan.cycle).toMatchObject({ start: '2026-12-26', end: '2027-01-25' });
    expect(jan.daysLeft).toBe(25);
  });

  it('les opérations en attente comptent', () => {
    const b = computeDailyBudget([tx({ id: '1', amount: -1500, date: '2026-10-17', categoryId: CAT.restos, pending: true })], cats, settings, '2026-10-17');
    expect(b.spentToday).toBe(1500);
  });
});

describe('jauge', () => {
  it('vert ≤ 75 %, orange ≤ 100 %, rouge au-delà', () => {
    expect(statusFor(0, 3000)).toBe('good');
    expect(statusFor(2250, 3000)).toBe('good');
    expect(statusFor(2251, 3000)).toBe('warn');
    expect(statusFor(3000, 3000)).toBe('warn');
    expect(statusFor(3001, 3000)).toBe('bad');
    expect(statusFor(0, 0)).toBe('warn');
    expect(statusFor(10, 0)).toBe('bad');
  });
});

describe('série quotidienne et dépassements', () => {
  it('cumul, trajectoire idéale et budget historique', () => {
    const cycle = { start: '2026-09-26', end: '2026-10-25' };
    const txs = [tx({ id: '1', amount: -6000, date: '2026-09-26', categoryId: CAT.courses }), tx({ id: '2', amount: -1000, date: '2026-09-27', categoryId: CAT.restos })];
    const s = dailySeries(txs, cats, cycle, 30000, '2026-09-28');
    expect(s.map((p) => p.cumulative)).toEqual([6000, 7000, 7000]);
    expect(s[0].budget).toBe(1000);
    expect(s[1].budget).toBe(Math.floor(24000 / 29));
    expect(s[29 - 27]?.ideal).toBe(3000);
    expect(dailySeries([], cats, cycle, 30000).at(-1)?.ideal).toBe(30000);
  });

  it('séries de dépassement', () => {
    const mk = (spent: number[]) => spent.map((s, i) => ({ date: `2026-10-${String(i + 1).padStart(2, '0')}`, spent: s, cumulative: 0, ideal: 0, budget: 100 }));
    expect(overrunStreaks(mk([200, 200, 200, 0, 200]))).toEqual({ current: 1, longest: 3, longestEnd: '2026-10-03' });
    expect(overrunStreaks(mk([0, 200, 200, 200, 200]))).toMatchObject({ current: 4, longest: 4 });
  });
});
