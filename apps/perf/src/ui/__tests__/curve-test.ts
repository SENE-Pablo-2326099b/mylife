import { dailyValues } from '@/domain/bodyTrend';

import { monotonePath } from '../curve';

/** Every number of the path, as [x, y] pairs (M / C / L commands). */
const coords = (d: string): [number, number][] => {
  const nums = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i] ?? 0, nums[i + 1] ?? 0]);
  return out;
};

describe('monotone curve', () => {
  it('never overshoots the data nor goes back in x (uneven gaps, a jump, a plateau)', () => {
    const pts: [number, number][] = [
      [0, 100],
      [5, 100],
      [6, 40],
      [200, 42],
      [204, 41],
      [300, 41],
    ];
    const c = coords(monotonePath(pts));
    const ys = pts.map((p) => p[1]);
    for (const [, y] of c) {
      expect(y).toBeGreaterThanOrEqual(Math.min(...ys) - 0.05);
      expect(y).toBeLessThanOrEqual(Math.max(...ys) + 0.05);
    }
    // Control points stay between their segment's ends in x.
    for (let i = 1; i < c.length; i++) expect((c[i]?.[0] ?? 0) + 0.05).toBeGreaterThanOrEqual(c[i - 1]?.[0] ?? 0);
  });

  it('draws a straight segment for two points on the same x', () => {
    expect(monotonePath([[0, 0], [0, 10], [10, 5]])).toContain('L0.0,10.0');
  });
});

describe('daily body values', () => {
  it('keeps one value per day, the last one entered', () => {
    const d = dailyValues([
      { date: '2026-10-12', value: 69.5 },
      { date: '2026-10-12', value: 69.1 },
      { date: '2026-10-10', value: 69.8 },
    ]);
    expect(d.map((x) => [x.date, x.value])).toEqual([
      ['2026-10-10', 69.8],
      ['2026-10-12', 69.1],
    ]);
  });
});
