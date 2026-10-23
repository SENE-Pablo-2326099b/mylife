import { describe, expect, it } from 'vitest';
import { balances, decide, memoryOf, parseExpense, parseInfo, parseSet, phaseOf, setAt, settle, sortSets, type Expense, type SortieSet } from '../packages/lumen/src/sortie';

describe('Sortie', () => {
  it('lecture prudente : infos, sets, dépenses', () => {
    expect(parseInfo({ name: ' Festival ', start: '2026-07-10', end: '2026-07-09', threshold: 99 })).toMatchObject({ name: 'Festival', end: '2026-07-10', threshold: 3 });
    expect(parseInfo({ name: '', start: '2026-07-10' })).toBeNull();
    expect(parseSet('s1', { day: '2026-07-10', start: '23:00', end: '01:00', stage: 'Main', artist: 'DJ X' })).toMatchObject({ id: 's1', end: '01:00' });
    expect(parseSet('s2', { day: '2026-07-10', start: '25:00', artist: 'x' })).toBeNull();
    expect(parseExpense('e1', { cents: 12.5, paidBy: 'a' })).toBeNull();
  });

  it('« Chaud ? » : ça se fait au seuil (ou quand tout le monde est chaud dans une petite bande)', () => {
    const answers = new Map([
      ['a', 'chaud' as const],
      ['b', 'chaud' as const],
      ['c', 'peutetre' as const],
    ]);
    expect(decide(['a', 'b', 'c', 'd'], answers, 3)).toMatchObject({ chaud: ['a', 'b'], peutetre: ['c'], silent: ['d'], on: false });
    expect(decide(['a', 'b'], answers, 3).on).toBe(true);
  });

  it('budget : parts au centime près, somme nulle, remboursements minimaux', () => {
    const e = (id: string, cents: number, paidBy: string, forUids: string[] = []): Expense => ({ id, label: id, cents, paidBy, forUids, at: 0 });
    const members = ['a', 'b', 'c'];
    const bal = balances([e('billets', 30000, 'a'), e('essence', 10000, 'b'), e('pizza', 1000, 'c', ['b', 'c'])], members);
    expect([...bal.values()].reduce((x, y) => x + y, 0)).toBe(0);
    expect(Object.fromEntries(bal)).toEqual({ a: 16666, b: -3833, c: -12833 });
    const t = settle(bal);
    expect(t).toEqual([
      { from: 'c', to: 'a', cents: 12833 },
      { from: 'b', to: 'a', cents: 3833 },
    ]);
    // Une dépense d'un ancien membre (parti) ne fausse rien.
    expect([...balances([e('x', 900, 'zed')], members).values()]).toEqual([0, 0, 0]);
  });

  it('planning : set en cours (y compris après minuit), ordre de la nuit', () => {
    const sets: SortieSet[] = [
      { id: '1', day: '2026-07-10', start: '22:00', end: '23:30', stage: 'Main', artist: 'A' },
      { id: '2', day: '2026-07-10', start: '23:30', end: '01:30', stage: 'Main', artist: 'B' },
      { id: '3', day: '2026-07-10', start: '23:00', end: '00:30', stage: 'Tent', artist: 'C' },
    ];
    expect(setAt(sets, '2026-07-10', '22:45', 'Main')?.artist).toBe('A');
    expect(setAt(sets, '2026-07-11', '00:45', 'Main')?.artist).toBe('B');
    expect(setAt(sets, '2026-07-11', '00:15')?.artist).toBe('B');
    expect(setAt(sets, '2026-07-11', '03:00')).toBeNull();
    expect(sortSets([...sets, { id: '0', day: '2026-07-10', start: '01:00', end: '02:00', stage: 'Main', artist: 'Z' }]).map((s) => s.artist)).toEqual(['A', 'C', 'B', 'Z']);
  });

  it('phase et souvenir', () => {
    const info = parseInfo({ name: 'F', start: '2026-07-10', end: '2026-07-12' })!;
    expect([phaseOf(info, '2026-07-01'), phaseOf(info, '2026-07-11'), phaseOf(info, '2026-07-13')]).toEqual(['avant', 'pendant', 'apres']);
    const m = memoryOf({
      chaud: ['a', 'b'],
      going: new Map([
        ['a', ['1', '2']],
        ['b', ['2', '3']],
      ]),
      ids: [{ id: 'i', at: 1, setId: null, stage: '', artist: '', note: '', found: 'Track' }],
      expenses: [{ id: 'e', label: 'x', cents: 2000, paidBy: 'a', forUids: [], at: 0 }],
      members: ['a', 'b'],
      me: 'b',
    });
    expect(m).toEqual({ people: 2, sets: 3, ids: 1, found: 1, totalCents: 2000, myCents: 1000 });
  });
});
