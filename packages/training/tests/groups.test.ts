import { describe, expect, it } from 'vitest';
import { describeGroups, groupsOfWeek, groupToSpec, parseGroup, parseGroups, weekFromGroups } from '../src/groups';
import { DEFAULT_DELOAD, DEFAULT_SCHEME_4, phaseFor } from '../src/mesocycle';
import { prescribe, type PrescriptionInput } from '../src/prescription';
import { parseScheme, toWeekOverride } from '../src/rows';
import type { Mesocycle, SetGroup, WeekOverride } from '../src/types';

/**
 * Semaines en groupes de séries libres (cycles importés, 23/11) : n'importe quelle combinaison dans l'ordre voulu (top
 * set, backoffs, séries pausées à un autre %, vagues, EMOM, séries droites, au temps), lue, réécrite à l'identique, et
 * prescrite série par série au % du 1RM.
 */
const g = (s: string) => {
  const r = parseGroup(s);
  if ('error' in r) throw new Error(r.error);
  return r.group;
};

describe('groupes : lecture et réécriture', () => {
  it('les écritures courantes', () => {
    expect(g('top 1x4 @80%')).toEqual({ type: 'top_set', sets: 1, reps: 4, percent: 0.8 });
    expect(g('Backoffs : 4×6 @ 70 %')).toEqual({ type: 'backoff', sets: 4, reps: 6, percent: 0.7 });
    expect(g('2x3 @75% pause 2 s')).toEqual({ type: 'working', sets: 2, reps: 3, percent: 0.75, note: 'pause 2 s' });
    expect(g('EMOM 6x2 @70%')).toEqual({ type: 'working', sets: 6, reps: 2, percent: 0.7, everySec: 60 });
    expect(g('backoff E2MOM 5x3 @72,5%')).toEqual({ type: 'backoff', sets: 5, reps: 3, percent: 0.725, everySec: 120 });
    expect(g('3x45s')).toEqual({ type: 'working', sets: 3, reps: 1, seconds: 45 });
    expect(g('top 1x3-5 @85% repos 3 min')).toEqual({ type: 'top_set', sets: 1, reps: 3, repsMax: 5, percent: 0.85, restSec: 180 });
    expect(g('échauffement 2x5 @50%').type).toBe('warmup');
    expect(g('3x8')).toEqual({ type: 'working', sets: 3, reps: 8 });
  });

  it('objets, raccourci { top, backoff }, listes ; erreurs claires, jamais inventées', () => {
    expect(parseGroup({ type: 'backoff', sets: 3, reps: '5', percent: 75, rest: 120, note: 'tempo 3-1-1' })).toEqual({ group: { type: 'backoff', sets: 3, reps: 5, percent: 0.75, restSec: 120, note: 'tempo 3-1-1' } });
    expect(parseGroups({ top: '1x4 @80%', backoff: '4x6 @70%' }).groups.map((x) => x.type)).toEqual(['top_set', 'backoff']);
    expect(parseGroups(['top 1x4 @80%', '4x6 @70%', '2x3 @75% pause']).groups).toHaveLength(3);
    expect(parseGroups('1x4 @80% + 4x6 @70%').groups).toHaveLength(2);
    expect(parseGroup('4x6 @150%')).toEqual({ error: expect.stringMatching(/20 à 120/) });
    expect(parseGroup('quatre fois six')).toEqual({ error: expect.stringMatching(/4x6 @70%/) });
    expect(parseGroup('30x5')).toEqual({ error: expect.stringMatching(/séries/) });
    const r = parseGroups(['4x6 @70%', 'n’importe quoi']);
    expect(r.groups).toHaveLength(1);
    expect(r.issues).toHaveLength(1);
  });

  it('réécrit à l’identique : relire ce qu’on exporte redonne les mêmes groupes', () => {
    const groups: SetGroup[] = [
      { type: 'top_set', sets: 1, reps: 3, repsMax: 5, percent: 0.875, restSec: 240 },
      { type: 'backoff', sets: 4, reps: 6, percent: 0.7 },
      { type: 'working', sets: 2, reps: 3, percent: 0.75, note: 'pause 2 s' },
      { type: 'backoff', sets: 6, reps: 2, percent: 0.7, everySec: 60 },
      { type: 'working', sets: 3, reps: 1, seconds: 45, restSec: 90 },
      { type: 'warmup', sets: 2, reps: 5, percent: 0.5 },
      { type: 'drop', sets: 1, reps: 10, percent: 0.6 },
    ];
    for (const x of groups) expect(g(groupToSpec(x))).toEqual(x);
    expect(describeGroups(groups.slice(0, 3))).toBe('Top 1×3-5 @ 87,5 % + Backoffs 4×6 @ 70 % + 2×3 @ 75 % · pause 2 s');
  });

  it('la forme top set + backoffs déduite, et l’inverse', () => {
    const w = weekFromGroups([g('2x3 @75% pause'), g('top 1x4 @82%'), g('backoff 3x5 @72%')], DEFAULT_SCHEME_4[0]!);
    expect(w).toMatchObject({ topSets: 1, topRepsMin: 4, topPercent: 0.82, backoffSets: 3, backoffReps: 5, backoffPercent: 0.72 });
    expect(w.groups).toHaveLength(3);
    expect(groupsOfWeek(DEFAULT_SCHEME_4[0]!)).toEqual([
      { type: 'top_set', sets: 1, reps: 5, percent: 0.8 },
      { type: 'backoff', sets: 4, reps: 6, percent: 0.7 },
    ]);
  });
});

describe('groupes : la prescription, série par série', () => {
  const groups = [g('top 1x4 @80%'), g('backoff 3x6 @70%'), g('2x3 @75% pause 2 s'), g('EMOM 4x2 @65%')];
  const meso: Mesocycle = { id: 'm', name: 'C', kind: 'accumulation', macrocycleId: null, startDate: '2026-01-05', workWeeks: 4, deloadWeeks: 1, scheme: DEFAULT_SCHEME_4.map((w, i) => (i === 1 ? weekFromGroups(groups, w) : { ...w })), deload: DEFAULT_DELOAD, notes: '' };
  const base: PrescriptionInput = { progressionType: 'top_set_backoff', repMin: 3, repMax: 6, targetSets: 3, topSetsOverride: 2, backoffSetsOverride: 5, backoffPercent: 0.8, increment: 2.5, bodyweight: null, phase: null, scheme: meso.scheme, deload: DEFAULT_DELOAD, lastSets: [], referenceE1rm: 150 };

  it('chaque groupe dans l’ordre, à son %, sa consigne et son repos ; les nombres de séries du créneau ne s’en mêlent pas', () => {
    const p = prescribe({ ...base, phase: phaseFor(meso, '2026-01-12') });
    expect(p.sets.map((s) => `${s.setType}:${s.targetWeight}x${s.targetReps}`)).toEqual([
      'top_set:120x4',
      'backoff:105x6', 'backoff:105x6', 'backoff:105x6',
      'working:112.5x3', 'working:112.5x3',
      'working:97.5x2', 'working:97.5x2', 'working:97.5x2', 'working:97.5x2',
    ]);
    expect(p.sets[4]).toMatchObject({ percent: 0.75, note: 'pause 2 s' });
    expect(p.sets[6]).toMatchObject({ note: 'EMOM', restSec: 60 });
    expect(p.percents).toEqual({ top: 0.8, backoff: 0.7 });
    expect(p.label).toBe('Top 1×4 @ 80 % + Backoffs 3×6 @ 70 % + 2×3 @ 75 % · pause 2 s + EMOM 4×2 @ 65 %');
    // Les autres semaines gardent leur forme.
    expect(prescribe({ ...base, phase: phaseFor(meso, '2026-01-05') }).sets).toHaveLength(2 + 5);
  });

  it('lesté : la charge est le lest (masse totale × %, moins le poids du corps) ; sans 1RM, à toi de la saisir', () => {
    const p = prescribe({ ...base, bodyweight: 80, referenceE1rm: 150, phase: phaseFor(meso, '2026-01-12') });
    expect(p.sets[0]!.targetWeight).toBe(40);
    expect(prescribe({ ...base, referenceE1rm: null, phase: phaseFor(meso, '2026-01-12') }).sets.every((s) => s.targetWeight === null)).toBe(true);
  });

  it('l’exception d’un exercice : ses groupes priment ; un réglage chiffré redonne la forme top set + backoffs', () => {
    const own: WeekOverride = { weekIndex: 2, groups: [g('3x3 @85%')], topSets: null, topRepsMin: null, topRepsMax: null, backoffSets: null, backoffReps: null, backoffPercent: null, topPercent: null };
    expect(prescribe({ ...base, phase: phaseFor(meso, '2026-01-12'), weekOverrides: new Map([[2, own]]) }).sets.map((s) => s.targetWeight)).toEqual([127.5, 127.5, 127.5]);
    const numeric: WeekOverride = { ...own, groups: null, topPercent: 0.9 };
    const p = prescribe({ ...base, phase: phaseFor(meso, '2026-01-12'), weekOverrides: new Map([[2, numeric]]) });
    expect(p.sets[0]).toMatchObject({ setType: 'top_set', targetWeight: 135 });
  });

  it('gardés tels quels dans la base : le JSON des semaines et la colonne des réglages', () => {
    const scheme = parseScheme(JSON.stringify(meso.scheme));
    expect(scheme[1]!.groups).toEqual(groups);
    expect(scheme[0]!.groups).toBeUndefined();
    expect(toWeekOverride({ mesocycle_id: 'm', exercise_id: 'e', week_index: 2, groups: JSON.stringify([groups[2]]) }).groups).toEqual([groups[2]]);
  });
});
