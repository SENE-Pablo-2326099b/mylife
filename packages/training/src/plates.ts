/** Plates sold in most gyms, heaviest first (kg). */
export const DEFAULT_PLATES: readonly number[] = [25, 20, 15, 10, 5, 2.5, 1.25];

export interface PlateLoad {
  /** Plates to put on one side of the bar (or on the dip belt), heaviest first. */
  plates: number[];
  /** What is actually loaded (bar + 2 × side, or belt total). Differs from the target when it cannot be matched. */
  loaded: number;
  /** Target is below the empty bar. */
  belowBar: boolean;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Greedy fill, heaviest first, never above `amount`. Plate weights are exact multiples, so greedy is optimal for standard sets. */
function fill(amount: number, available: readonly number[]): number[] {
  const out: number[] = [];
  let rest = round2(amount);
  for (const p of [...available].sort((a, b) => b - a)) {
    if (p <= 0) continue;
    while (rest + 1e-9 >= p) {
      out.push(p);
      rest = round2(rest - p);
    }
  }
  return out;
}

/**
 * Barbell: plates per side for a target total (bar included). Unmatchable remainders are dropped
 * (`loaded` tells what you really lift).
 */
export function barbellPlates(target: number, bar: number, available: readonly number[] = DEFAULT_PLATES): PlateLoad {
  if (target <= bar) return { plates: [], loaded: bar, belowBar: target < bar - 1e-9 };
  const plates = fill((target - bar) / 2, available);
  const side = plates.reduce((s, p) => s + p, 0);
  return { plates, loaded: round2(bar + side * 2), belowBar: false };
}

/** Dip / pull-up belt: the added load is hung as is (no pairs). */
export function beltPlates(added: number, available: readonly number[] = DEFAULT_PLATES): PlateLoad {
  if (added <= 0) return { plates: [], loaded: 0, belowBar: false };
  const plates = fill(added, available);
  return { plates, loaded: round2(plates.reduce((s, p) => s + p, 0)), belowBar: false };
}

/** "20 + 10 + 2,5" (French decimal comma). */
export function describePlates(plates: readonly number[]): string {
  return plates.map((p) => String(p).replace('.', ',')).join(' + ');
}
