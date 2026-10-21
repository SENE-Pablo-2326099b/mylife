import { barbellPlates, beltPlates, describePlates } from '../plates';

describe('plate calculator', () => {
  it('loads a barbell per side, heaviest first', () => {
    expect(barbellPlates(100, 20)).toEqual({ plates: [25, 15], loaded: 100, belowBar: false });
    expect(barbellPlates(87.5, 20)).toEqual({ plates: [25, 5, 2.5, 1.25], loaded: 87.5, belowBar: false });
    expect(barbellPlates(142.5, 20).plates).toEqual([25, 25, 10, 1.25]);
  });
  it('reports what is really loaded when the target cannot be matched', () => {
    const r = barbellPlates(101, 20);
    expect(r.loaded).toBe(100);
    expect(barbellPlates(101, 20, [20, 10, 5, 2.5, 1.25, 0.5]).loaded).toBe(101);
  });
  it('handles the empty bar and below', () => {
    expect(barbellPlates(20, 20)).toEqual({ plates: [], loaded: 20, belowBar: false });
    expect(barbellPlates(15, 20).belowBar).toBe(true);
  });
  it('respects the plates available in the gym', () => {
    expect(barbellPlates(100, 20, [20, 10, 5]).plates).toEqual([20, 20]);
    expect(barbellPlates(70, 15, [20, 10, 5, 2.5]).plates).toEqual([20, 5, 2.5]);
  });
  it('builds a dip belt without pairs', () => {
    expect(beltPlates(47.5)).toEqual({ plates: [25, 20, 2.5], loaded: 47.5, belowBar: false });
    expect(beltPlates(0).plates).toEqual([]);
  });
  it('formats with a decimal comma', () => {
    expect(describePlates([25, 2.5, 1.25])).toBe('25 + 2,5 + 1,25');
  });
});
