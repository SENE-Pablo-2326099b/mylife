import { forceWeeks } from '../rpg';

describe('compteurs Force du Personnage', () => {
  it('séances et records par semaine (lundi), rien avant la date de départ', () => {
    const weeks = forceWeeks(['2026-10-19', '2026-10-21', '2026-10-25', '2026-10-12', '2025-01-01'], ['2026-10-21', '2026-10-21'], '2026-01-01');
    expect(weeks).toEqual({ '2026-10-19': { sessions: 3, records: 2 }, '2026-10-12': { sessions: 1 } });
  });
  it('aucune séance : aucun compteur', () => {
    expect(forceWeeks([], [], '2026-01-01')).toEqual({});
  });
});
