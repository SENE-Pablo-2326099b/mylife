/** Rounds to the nearest multiple of `increment` (default plate step 2.5 kg), free of float noise. */
export function roundToIncrement(value: number, increment = 2.5): number {
  if (!Number.isFinite(value)) return 0;
  if (increment <= 0) return Math.round(value * 100) / 100;
  const rounded = Math.round(value / increment) * increment;
  return Math.round(rounded * 100) / 100;
}

/**
 * Estimated 1RM, Epley formula: weight × (1 + reps / 30).
 * Choice: a single rep returns the weight itself (Epley would inflate a true single by 3.3%).
 * Never stored — always computed on the fly.
 *
 * For bodyweight exercises pass `bodyweight`: the estimate is done on total system mass
 * and returned as ADDED load, so it stays comparable to what the user logs.
 */
export function estimate1RM(weight: number, reps: number, bodyweight: number | null = null): number {
  if (reps <= 0) return 0;
  const total = weight + (bodyweight ?? 0);
  if (total <= 0) return 0;
  const e1rm = reps === 1 ? total : total * (1 + reps / 30);
  return e1rm - (bodyweight ?? 0);
}

/** Inverse Epley: the load that should allow `reps` reps for a given e1RM (same bodyweight convention). */
export function weightForReps(e1rm: number, reps: number, bodyweight: number | null = null): number {
  const total = e1rm + (bodyweight ?? 0);
  const load = reps <= 1 ? total : total / (1 + reps / 30);
  return load - (bodyweight ?? 0);
}

/**
 * Backoff load = top set × percent, rounded to the increment.
 * For bodyweight exercises the percentage applies to total mass, clamped at 0 added load.
 */
export function backoffWeight(
  topWeight: number,
  percent: number,
  increment = 2.5,
  bodyweight: number | null = null,
): number {
  const bw = bodyweight ?? 0;
  const raw = (topWeight + bw) * percent - bw;
  return Math.max(0, roundToIncrement(raw, increment));
}

/** Weight as a plain number string ("82.5"): keypad buffers, data for the coach. */
export function plainWeight(weight: number | null | undefined): string {
  if (weight === null || weight === undefined) return '';
  return Number.isInteger(weight) ? String(weight) : String(Math.round(weight * 100) / 100);
}

/** Weight for display, French decimal comma ("82,5"). */
export function formatWeight(weight: number | null | undefined): string {
  return plainWeight(weight).replace('.', ',');
}

/** Any number for display: at most `digits` decimals, French decimal comma ("18,4"). */
export function formatDecimal(value: number, digits = 1): string {
  const f = 10 ** digits;
  const r = Math.round(value * f) / f;
  return (Number.isInteger(r) ? String(r) : String(r)).replace('.', ',');
}

/** Fraction as a percentage for display, to the tenth ("92,5 %", "80 %"). */
export function formatPercent(fraction: number): string {
  return `${formatDecimal(fraction * 100, 1)} %`;
}
