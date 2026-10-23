import { describe, expect, it } from 'vitest';
import type { Transaction } from '../src/db/types';
import { CAT } from '../src/domain/defaults';
import { disciplineWeeks } from '../src/domain/rpgStats';
import { PROFILE, PROFILE_CATEGORIES } from './profile';
import { tx } from './helpers';

const cats = new Map(PROFILE_CATEGORIES.map((c) => [c.id, c]));
const TODAY = '2026-10-22';

function run(txs: Transaction[]) {
  const dataStart = [...txs].sort((a, b) => (a.date < b.date ? -1 : 1))[0]?.date ?? null;
  return disciplineWeeks({ txs, cats, settings: PROFILE, allocations: {}, dataStart, today: TODAY });
}

describe('compteurs Discipline du Personnage', () => {
  it('jours sous le budget du jour, par semaine ; la journée en cours ne compte pas', () => {
    const txs = [
      tx({ id: 'a', date: '2026-10-12', amount: -1000, categoryId: CAT.courses }),
      // Une grosse dépense un mercredi : ce jour-là est au-dessus du budget.
      tx({ id: 'b', date: '2026-10-14', amount: -50000, categoryId: CAT.shopping }),
      tx({ id: 'c', date: '2026-10-22', amount: -90000, categoryId: CAT.shopping }),
    ];
    const weeks = run(txs);
    expect(weeks['2026-10-12']).toEqual({ tracked: 7, under: 6 });
    // Semaine en cours : lundi à mercredi (jeudi, aujourd'hui, n'est pas fini).
    expect(weeks['2026-10-19']).toEqual({ tracked: 3, under: 3 });
  });

  it('cycle terminé avec l’épargne prévue tenue : compté la semaine de sa fin', () => {
    const txs = [tx({ id: 'e', date: '2026-09-01', amount: -45000, categoryId: CAT.epargne }), tx({ id: 'f', date: '2026-10-01', amount: -1000, categoryId: CAT.courses })];
    const weeks = run(txs);
    // Cycle du 26 août au 25 septembre : 450 € mis de côté sur 450 € prévus.
    expect(weeks['2026-09-21']?.saved).toBe(1);
    // Le cycle en cours n'est pas fini : pas encore compté.
    expect(Object.values(weeks).reduce((n, w) => n + (w.saved ?? 0), 0)).toBe(1);
  });

  it('aucune opération : rien à compter ; jamais de montant dans les compteurs', () => {
    expect(run([])).toEqual({});
    const weeks = run([tx({ id: 'a', date: '2026-10-05', amount: -123456, categoryId: CAT.shopping })]);
    for (const w of Object.values(weeks)) for (const k of Object.keys(w)) expect(['tracked', 'under', 'saved']).toContain(k);
  });
});
