import { describe, expect, it } from 'vitest';
import { choreDay, choreDoneId, choresByWeek, nextBill, parseBill, parseChore, todayForHome, turnOf, type Chore } from '../packages/lumen/src/foyer';
import { balances, settle } from '../packages/lumen/src/sortie';

/** MyFoyer (V4, 3.3) : corvées tournantes, échéances, dépenses communes. */
const poubelles: Chore = { v: 1, name: 'Poubelles', weekday: 1, order: ['ana', 'bob', 'cleo'], start: '2026-10-19' };

describe('corvées tournantes', () => {
  it('le tour change chaque semaine ; un membre parti est sauté ; le jour de la semaine', () => {
    expect(['2026-10-20', '2026-10-27', '2026-11-03', '2026-11-10'].map((d) => turnOf(poubelles, d, ['ana', 'bob', 'cleo']))).toEqual(['ana', 'bob', 'cleo', 'ana']);
    expect(turnOf(poubelles, '2026-11-03', ['ana', 'bob'])).toBe('ana');
    expect(turnOf(poubelles, '2026-10-20', [])).toBeNull();
    expect(choreDay(poubelles, '2026-10-24')).toBe('2026-10-20');
    expect(choreDoneId('c1', '2026-10-24')).toBe('c1.2026-10-19');
  });

  it('le tableau du jour : mes corvées pas faites, celles des autres, les factures de la semaine', () => {
    const t = todayForHome({
      chores: [{ id: 'c1', value: poubelles }, { id: 'c2', value: { ...poubelles, name: 'Courses', order: ['bob', 'ana'] } }, { id: 'c3', value: { ...poubelles, name: 'Salle de bain' } }],
      done: new Set(['c3.2026-10-19']),
      bills: [{ id: 'b1', value: { v: 1, label: 'Loyer', day: 28, cents: 80000 } }, { id: 'b2', value: { v: 1, label: 'Internet', day: 15 } }],
      members: ['ana', 'bob'],
      today: '2026-10-24',
      uid: 'ana',
    });
    expect(t.mine.map((m) => m.chore.name)).toEqual(['Poubelles']);
    expect(t.others.map((o) => [o.chore.name, o.who])).toEqual([['Courses', 'bob']]);
    expect(t.billsSoon.map((b) => [b.bill.label, b.date])).toEqual([['Loyer', '2026-10-28']]);
  });

  it('les compteurs du Personnage (stat Foyer) : seulement mes corvées, par semaine', () => {
    expect(choresByWeek([{ rid: 'c1.2026-10-19', value: { by: 'ana', at: 1 } }, { rid: 'c3.2026-10-19', value: { by: 'ana', at: 2 } }, { rid: 'c2.2026-10-19', value: { by: 'bob', at: 3 } }], 'ana')).toEqual({ '2026-10-19': { chores: 2 } });
  });
});

describe('échéances et dépenses communes', () => {
  it('prochaine échéance (fin de mois courte comprise) ; lecture prudente', () => {
    expect(nextBill({ v: 1, label: 'Loyer', day: 31 }, '2026-11-02')).toBe('2026-11-30');
    expect(nextBill({ v: 1, label: 'Loyer', day: 5 }, '2026-12-20')).toBe('2027-01-05');
    expect(parseBill({ v: 1, label: 'x', day: 32 })).toBeNull();
    expect(parseChore({ v: 1, name: 'x', weekday: 2, order: [], start: '2026-10-21' })).toBeNull();
    expect(parseChore({ v: 1, name: 'x', weekday: 2, order: ['a'], start: '2026-10-21' })?.start).toBe('2026-10-19');
  });

  it('le moteur des Sorties répartit les dépenses du foyer au centime et dit qui doit quoi', () => {
    const exp = [
      { id: 'e1', label: 'Courses', cents: 9000, paidBy: 'ana', forUids: [], at: 1 },
      { id: 'e2', label: 'Électricité', cents: 6000, paidBy: 'bob', forUids: [], at: 2 },
    ];
    const bal = balances(exp, ['ana', 'bob']);
    expect(settle(bal)).toEqual([{ from: 'bob', to: 'ana', cents: 1500 }]);
  });
});
