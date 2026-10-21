import { backoffWeight, estimate1RM, roundToIncrement, weightForReps } from '../math';

describe('roundToIncrement', () => {
  it('rounds to the nearest 2.5 kg by default', () => {
    expect(roundToIncrement(81)).toBe(80);
    expect(roundToIncrement(81.3)).toBe(82.5);
    expect(roundToIncrement(83.74)).toBe(82.5);
    expect(roundToIncrement(83.75)).toBe(85);
  });
  it('supports other increments without float noise', () => {
    expect(roundToIncrement(31.1, 2)).toBe(32);
    expect(roundToIncrement(10.3, 1.25)).toBe(10);
    expect(roundToIncrement(0.1 + 0.2, 0.1)).toBe(0.3);
  });
});

describe('estimate1RM (Epley)', () => {
  it('applies weight × (1 + reps / 30)', () => {
    expect(estimate1RM(100, 5)).toBeCloseTo(116.667, 2);
    expect(estimate1RM(100, 10)).toBeCloseTo(133.333, 2);
  });
  it('returns the weight for a single', () => {
    expect(estimate1RM(140, 1)).toBe(140);
  });
  it('returns 0 for no reps', () => {
    expect(estimate1RM(100, 0)).toBe(0);
  });
  it('works on total mass for bodyweight exercises and returns added load', () => {
    // 80 kg athlete, +40 kg × 5 → total 120 × 1.1667 = 140 → +60 added
    expect(estimate1RM(40, 5, 80)).toBeCloseTo(60, 5);
    // bodyweight only pull-ups still produce an estimate
    expect(estimate1RM(0, 10, 75)).toBeCloseTo(25, 5);
  });
  it('is inverted by weightForReps', () => {
    const e = estimate1RM(100, 5);
    expect(weightForReps(e, 5)).toBeCloseTo(100, 6);
    expect(weightForReps(estimate1RM(30, 3, 80), 3, 80)).toBeCloseTo(30, 6);
  });
});

describe('backoffWeight', () => {
  it('is top × percent rounded to 2.5', () => {
    expect(backoffWeight(100, 0.8)).toBe(80);
    expect(backoffWeight(142.5, 0.8)).toBe(115); // 114 → 115
    expect(backoffWeight(105, 0.85)).toBe(90); // 89.25 → 90
  });
  it('uses total mass for bodyweight exercises, clamped at 0', () => {
    // (80 + 40) × 0.8 = 96 → +16
    expect(backoffWeight(40, 0.8, 2.5, 80)).toBe(15);
    expect(backoffWeight(10, 0.8, 2.5, 80)).toBe(0);
  });
});
