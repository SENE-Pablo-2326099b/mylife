import { bodyTrend, movingAverage } from '../bodyTrend';

describe('body weight trend', () => {
  it('smooths with a 7-day trailing average', () => {
    const avg = movingAverage([
      { date: '2026-10-01', value: 63 },
      { date: '2026-10-03', value: 65 },
      { date: '2026-10-10', value: 64 },
    ]);
    expect(avg.map((a) => a.value)).toEqual([63, 64, 64]);
  });
  it('measures kg per week and projects the goal date', () => {
    // +0.5 kg / week, 4 weeks
    const entries = [1, 8, 15, 22, 29].map((d, i) => ({ date: `2026-09-${String(d).padStart(2, '0')}`, value: 63 + i * 0.5 }));
    const t = bodyTrend(entries, 66, 35);
    expect(t?.ratePerWeek).toBeCloseTo(0.5, 5);
    expect(t?.goalDate).not.toBeNull();
    expect(t?.goalReached).toBe(false);
  });
  it('gives no rate with a single entry or a short span, and no date when heading away from the goal', () => {
    expect(bodyTrend([{ date: '2026-09-07', value: 63 }], 71.5)?.ratePerWeek).toBeNull();
    expect(bodyTrend([{ date: '2026-09-07', value: 63 }, { date: '2026-09-09', value: 63.4 }], 71.5)?.ratePerWeek).toBeNull();
    const down = bodyTrend(
      [
        { date: '2026-09-01', value: 64 },
        { date: '2026-09-15', value: 63 },
      ],
      71.5,
    );
    expect(down?.ratePerWeek).toBeLessThan(0);
    expect(down?.goalDate).toBeNull();
  });
  it('recognises a reached goal', () => {
    expect(bodyTrend([{ date: '2026-09-07', value: 71.4 }], 71.5)?.goalReached).toBe(true);
    expect(bodyTrend([], 71.5)).toBeNull();
  });
});
