import { DEFAULT_DELOAD } from '@/domain/mesocycle';

import { parseDeloadWeek, parseScheme } from '../parse';

describe('scheme parsing', () => {
  it('converts a legacy week (intensity of the e1RM + inverse Epley) to the same top set load', () => {
    const [w] = parseScheme(JSON.stringify([{ topSets: 1, topRepsMin: 5, topRepsMax: 5, backoffSets: 3, backoffReps: 6, intensity: 0.9 }]));
    // 0.9 / (1 + 5/30) = 0.771
    expect(w).toEqual({ topSets: 1, topRepsMin: 5, topRepsMax: 5, topPercent: 0.77, backoffSets: 3, backoffReps: 6, backoffPercent: 0.67 });
  });
  it('reads the current shape as is', () => {
    const week = { topSets: 1, topRepsMin: 4, topRepsMax: 4, topPercent: 0.83, backoffSets: 4, backoffReps: 6, backoffPercent: 0.73 };
    expect(parseScheme(JSON.stringify([week]))).toEqual([week]);
    expect(parseScheme('nope')).toEqual([]);
  });
  it('falls back to the default deload shape', () => {
    expect(parseDeloadWeek(null, DEFAULT_DELOAD.main)).toEqual(DEFAULT_DELOAD.main);
    expect(parseDeloadWeek('{bad', DEFAULT_DELOAD.main)).toEqual(DEFAULT_DELOAD.main);
  });
});
