import type { StrengthWeek } from './types';

/**
 * Mesocycle types (block periodization, Issurin): each block has a purpose and a load profile.
 * The type pre-fills the top set + backoff structure of the cycle; everything stays editable.
 *
 * All percentages are of the reference 1RM (total mass for weighted lifts). Top sets 1-5 reps,
 * backoffs 3-6 reps — the program's rules hold in every block.
 */
export type MesoKind = 'accumulation' | 'transmutation' | 'realization' | 'transition' | 'custom';

export interface MesoKindInfo {
  kind: MesoKind;
  label: string;
  /** One line: what this block is for. */
  goal: string;
  volume: 'élevé' | 'moyen' | 'bas';
  intensity: string;
  /** Typical work weeks (+ deload weeks). */
  weeks: number;
  deloadWeeks: number;
}

export const MESO_KINDS: readonly MesoKindInfo[] = [
  {
    kind: 'accumulation',
    label: 'Accumulation',
    goal: 'Construire : beaucoup de volume, intensité modérée.',
    volume: 'élevé',
    intensity: '80\u00A0→\u00A092,5\u00A0%',
    weeks: 4,
    deloadWeeks: 1,
  },
  {
    kind: 'transmutation',
    label: 'Transmutation',
    goal: 'Convertir en force : l’intensité monte, le volume baisse.',
    volume: 'moyen',
    intensity: '85\u00A0→\u00A092\u00A0%',
    weeks: 4,
    deloadWeeks: 1,
  },
  {
    kind: 'realization',
    label: 'Réalisation',
    goal: 'Exprimer la force : charges lourdes, test du max à la fin.',
    volume: 'bas',
    intensity: '90\u00A0→\u00A0100\u00A0%',
    weeks: 3,
    deloadWeeks: 1,
  },
  {
    kind: 'transition',
    label: 'Transition',
    goal: 'Récupérer entre deux blocs : léger et technique.',
    volume: 'bas',
    intensity: '65\u00A0→\u00A072\u00A0%',
    weeks: 2,
    deloadWeeks: 0,
  },
  {
    kind: 'custom',
    label: 'Personnalisé',
    goal: 'Ta propre structure, semaine par semaine.',
    volume: 'moyen',
    intensity: 'au choix',
    weeks: 4,
    deloadWeeks: 1,
  },
];

export function mesoKindInfo(kind: MesoKind): MesoKindInfo {
  return MESO_KINDS.find((k) => k.kind === kind) ?? (MESO_KINDS[0] as MesoKindInfo);
}

export function parseMesoKind(v: string | null | undefined): MesoKind {
  return MESO_KINDS.find((k) => k.kind === v)?.kind ?? 'accumulation';
}

const w = (topReps: number, topPercent: number, backoffSets: number, backoffReps: number, backoffPercent: number): StrengthWeek => ({
  topSets: 1,
  topRepsMin: topReps,
  topRepsMax: topReps,
  topPercent,
  backoffSets,
  backoffReps,
  backoffPercent,
});

/** Reference 4-week (3 for realization, 2 for transition) structures, from the program and block-periodization practice. */
const PRESETS: Record<Exclude<MesoKind, 'custom'>, readonly StrengthWeek[]> = {
  // programme-reel.md
  accumulation: [w(5, 0.8, 4, 6, 0.7), w(4, 0.83, 4, 6, 0.73), w(4, 0.85, 3, 6, 0.75), w(2, 0.925, 3, 5, 0.78)],
  // 75-90 % zone (Prilepin), volume down, backoffs ~8 points under the top set.
  transmutation: [w(3, 0.85, 3, 4, 0.77), w(3, 0.87, 3, 4, 0.79), w(2, 0.9, 2, 4, 0.81), w(2, 0.92, 2, 3, 0.84)],
  // Peak: singles and doubles, last week = test of the max.
  realization: [w(2, 0.9, 2, 3, 0.82), w(1, 0.95, 2, 3, 0.85), w(1, 1, 1, 3, 0.8)],
  transition: [w(5, 0.65, 2, 6, 0.6), w(5, 0.72, 2, 5, 0.65)],
};

/** Percent to the half point (0.925 stays 92.5 %). */
const round2 = (v: number) => Math.round(v * 200) / 200;

function interpolate(a: StrengthWeek, b: StrengthWeek, t: number): StrengthWeek {
  const lerp = (x: number, y: number) => x + (y - x) * t;
  const topReps = Math.round(lerp(a.topRepsMin, b.topRepsMin));
  return {
    topSets: 1,
    topRepsMin: topReps,
    topRepsMax: topReps,
    topPercent: round2(lerp(a.topPercent, b.topPercent)),
    backoffSets: Math.round(lerp(a.backoffSets, b.backoffSets)),
    backoffReps: Math.round(lerp(a.backoffReps, b.backoffReps)),
    backoffPercent: round2(lerp(a.backoffPercent, b.backoffPercent)),
  };
}

/**
 * Pre-filled structure for a block type and any number of work weeks: the reference weeks when
 * the count matches, otherwise the same curve stretched (first and last weeks kept).
 * `custom` returns null (keep what the user has).
 */
export function schemeForKind(kind: MesoKind, workWeeks: number): StrengthWeek[] | null {
  if (kind === 'custom') return null;
  const preset = PRESETS[kind];
  const n = Math.max(1, Math.round(workWeeks));
  if (n === preset.length) return preset.map((x) => ({ ...x }));
  const first = preset[0] as StrengthWeek;
  const last = preset[preset.length - 1] as StrengthWeek;
  if (n === 1) return [{ ...last }];
  return Array.from({ length: n }, (_, i) => {
    const pos = (i / (n - 1)) * (preset.length - 1);
    const lo = Math.floor(pos);
    const a = preset[lo] ?? first;
    const b = preset[Math.min(preset.length - 1, lo + 1)] ?? last;
    return interpolate(a, b, pos - lo);
  });
}
