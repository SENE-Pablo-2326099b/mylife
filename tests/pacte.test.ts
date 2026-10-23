import { describe, expect, it } from 'vitest';
import { evaluatePacte, myPacteValues, parsePacte, parsePacteValues, pacteWeeks } from '../packages/lumen/src/pacte';

const TODAY = '2026-10-22'; // jeudi, semaine du 19
const pacte = parsePacte('p1', { title: '', kind: 'sessions', target: 3, stakeCents: 500, start: '2026-10-07', weeks: 4 })!;

describe('Pacte', () => {
  it('lecture prudente : le début est ramené au lundi ; valeurs hors limites refusées ; titre par défaut', () => {
    expect(pacte).toMatchObject({ start: '2026-10-05', title: '3 séances par semaine', weeks: 4 });
    expect(pacteWeeks(pacte)).toEqual(['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
    expect(parsePacte('x', { kind: 'sessions', target: 9, stakeCents: 0, start: '2026-10-05', weeks: 4 })).toBeNull();
    expect(parsePacte('x', { kind: 'triche', target: 1, stakeCents: 0, start: '2026-10-05', weeks: 4 })).toBeNull();
    expect(parsePacteValues({ weeks: { '2026-10-05': 3, oups: 2, '2026-10-12': -1 } })).toEqual({ '2026-10-05': 3 });
  });

  it('mes valeurs viennent des compteurs des apps, semaine par semaine, jusqu’à la semaine en cours', () => {
    const stats = { perf: { v: 1 as const, at: 1, weeks: { '2026-10-05': { sessions: 3 }, '2026-10-19': { sessions: 1 } } } };
    expect(myPacteValues(pacte, stats, TODAY)).toEqual({ '2026-10-05': 3, '2026-10-12': 0, '2026-10-19': 1 });
    const budget = parsePacte('b', { kind: 'budget', target: 5, stakeCents: 200, start: '2026-10-12', weeks: 2 })!;
    expect(myPacteValues(budget, { finances: { v: 1, at: 1, weeks: { '2026-10-12': { under: 6, tracked: 7 } } } }, TODAY)).toEqual({ '2026-10-12': 6, '2026-10-19': 0 });
  });

  it('évaluation : semaines finies seulement, cagnotte, sans faute ; la semaine en cours ne coûte rien', () => {
    const values = new Map<string, Record<string, number>>([
      ['ana', { '2026-10-05': 3, '2026-10-12': 4, '2026-10-19': 1 }],
      ['bob', { '2026-10-05': 2, '2026-10-12': 3 }],
    ]);
    const r = evaluatePacte(pacte, ['ana', 'bob', 'cyd'], values, TODAY);
    expect(r.status).toBe('en_cours');
    expect(r.weeks.map((w) => [w.week, w.finished, w.current])).toEqual([
      ['2026-10-05', true, false],
      ['2026-10-12', true, false],
      ['2026-10-19', false, true],
    ]);
    expect(r.byPerson).toEqual({ ana: 0, bob: 500, cyd: 1000 });
    expect(r.pot).toBe(1500);
    expect(r.perfect).toEqual(['ana']);
    expect(evaluatePacte(pacte, ['ana'], values, '2026-10-01').status).toBe('avant');
    expect(evaluatePacte(pacte, ['ana'], values, '2026-11-10').status).toBe('termine');
  });
});
