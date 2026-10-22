import { DEFAULT_SCHEME_4 } from '../mesocycle';
import { MESO_KINDS, parseMesoKind, schemeForKind } from '../mesoTypes';

describe('mesocycle types', () => {
  it('accumulation is the program’s cycle', () => {
    expect(schemeForKind('accumulation', 4)).toEqual(DEFAULT_SCHEME_4);
  });

  it('every block respects the program rules at any length', () => {
    for (const { kind } of MESO_KINDS) {
      for (const n of [1, 2, 3, 4, 5, 6, 8]) {
        const scheme = schemeForKind(kind, n);
        if (scheme === null) continue;
        expect(scheme).toHaveLength(n);
        for (const wk of scheme) {
          expect(wk.topRepsMin).toBeGreaterThanOrEqual(1);
          expect(wk.topRepsMax).toBeLessThanOrEqual(5);
          expect(wk.backoffReps).toBeGreaterThanOrEqual(3);
          expect(wk.backoffReps).toBeLessThanOrEqual(6);
          expect(wk.backoffPercent).toBeLessThan(wk.topPercent);
          expect(wk.topPercent).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('intensity rises within a block and from block to block; volume falls', () => {
    const top = (k: Parameters<typeof schemeForKind>[0]) => (schemeForKind(k, 4) ?? []).map((x) => x.topPercent);
    const volume = (k: Parameters<typeof schemeForKind>[0]) => (schemeForKind(k, 4) ?? []).reduce((s, x) => s + x.topSets * x.topRepsMin + x.backoffSets * x.backoffReps, 0);
    for (const k of ['accumulation', 'transmutation', 'realization'] as const) {
      const t = top(k);
      expect([...t].sort((a, b) => a - b)).toEqual(t);
    }
    // Accumulation ends on a heavy S4 (92.5 %), so blocks compare on their mean intensity.
    const mean = (k: Parameters<typeof schemeForKind>[0]) => top(k).reduce((a, b) => a + b, 0) / top(k).length;
    expect(mean('accumulation')).toBeLessThan(mean('transmutation'));
    expect(mean('transmutation')).toBeLessThan(mean('realization'));
    expect(volume('accumulation')).toBeGreaterThan(volume('transmutation'));
    expect(volume('transmutation')).toBeGreaterThan(volume('realization'));
  });

  it('realization ends on a test of the max; custom keeps the user’s weeks', () => {
    const r = schemeForKind('realization', 3);
    expect(r?.[2]).toMatchObject({ topRepsMin: 1, topPercent: 1 });
    expect(schemeForKind('custom', 4)).toBeNull();
  });

  it('parses unknown values as accumulation', () => {
    expect(parseMesoKind('transmutation')).toBe('transmutation');
    expect(parseMesoKind('nope')).toBe('accumulation');
    expect(parseMesoKind(null)).toBe('accumulation');
  });
});
