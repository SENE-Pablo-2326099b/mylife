import { describe, expect, it } from 'vitest';
import { BUILTIN_FORMATS, PRESETS, STRATEGIES, capabilities, dayContext, formatErrors, planSession, reviewSession, speedFromLegacy, type HistoryView, type Program } from '../src';
import { SEEDS } from '../src/seedLibrary';
import type { Exercise } from '../src/types';

/** La bibliothèque de base comme exercices (données fictives, aucun programme réel). */
const LIBRARY: Exercise[] = SEEDS.map((s) => ({
  id: s.id,
  name: s.name,
  primaryMuscles: s.p,
  secondaryMuscles: s.s ?? [],
  equipment: s.eq,
  unilateral: s.uni ?? false,
  loadType: s.load ?? 'external',
  category: s.cat,
  progressionType: s.prog ?? 'double_progression',
  backoffPercent: 0.8,
  repRangeMin: s.reps?.[0] ?? 8,
  repRangeMax: s.reps?.[1] ?? 12,
  weightIncrement: s.inc ?? null,
  isCustom: false,
  archived: false,
  notes: '',
}));

const program = (id: string, start = '2026-01-05'): Program => ({ ...PRESETS.find((p) => p.id === id)!.build(start), exercises: LIBRARY });
const caps = (id: string) => [...capabilities(program(id))].sort();
const empty: HistoryView = { lastSets: () => [], refSets: () => [], typedOneRm: () => null, bodyweight: () => 80 };

describe('capacités : l’interface ne montre que ce que le programme utilise', () => {
  it('chaque modèle a ses capacités, figées', () => {
    expect(caps('streetlifting-blocs')).toEqual(['blocks', 'deload', 'metric:load', 'metric:reps', 'percentages', 'plates', 'reference', 'timer:rest', 'weeks', 'weighted']);
    expect(caps('routine-simple')).toEqual(['metric:load', 'metric:reps', 'plates', 'timer:rest']);
    expect(caps('lineaire-5x5')).toEqual(['metric:load', 'metric:reps', 'plates', 'timer:rest']);
    expect(caps('hypertrophie-rir')).toEqual(['metric:load', 'metric:reps', 'rir', 'timer:rest', 'weeks']);
    expect(caps('callisthenie')).toEqual(['groups', 'metric:load', 'metric:reps', 'metric:time', 'timer:countdown', 'timer:interval', 'timer:rest', 'weeks', 'weighted']);
  });

  it('une routine ne fait jamais apparaître les blocs ni les % ; sans créneau au 1RM, pas de référence', () => {
    for (const id of ['routine-simple', 'lineaire-5x5', 'hypertrophie-rir', 'callisthenie']) {
      const c = capabilities(program(id));
      expect(c.has('blocks'), id).toBe(false);
      expect(c.has('percentages'), id).toBe(false);
      expect(c.has('reference'), id).toBe(false);
    }
  });
});

describe('structures : un seul contexte du jour', () => {
  it('routine : ni bloc ni semaine ; cycle libre : la semaine, répétée ou non ; blocs : bloc, semaine, décharge', () => {
    expect(dayContext(program('routine-simple').structure, '2026-03-02')).toMatchObject({ block: null, week: null });
    const cycle = program('hypertrophie-rir').structure;
    expect(dayContext(cycle, '2026-01-19').week).toEqual({ index: 3, of: 6, deload: false });
    expect(dayContext(cycle, '2026-02-23').week).toEqual({ index: 2, of: 6, deload: false });
    expect(dayContext(program('callisthenie').structure, '2026-02-23').week).toBeNull();
    const blocks = program('streetlifting-blocs').structure;
    expect(dayContext(blocks, '2026-01-12')).toMatchObject({ block: { name: 'Accumulation', index: 1, total: 3 }, week: { index: 2, of: 5, deload: false } });
    expect(dayContext(blocks, '2026-02-02').week).toEqual({ index: 5, of: 5, deload: true });
  });
});

describe('progressions', () => {
  const p = program('lineaire-5x5');
  const history = (sets: { weight: number; reps: number }[]): HistoryView => ({ ...empty, lastSets: () => sets.map((s) => ({ ...s, setType: 'working' as const, barSpeed: null })) });

  it('linéaire : +2,5 kg quand tout est réussi, la même charge sinon', () => {
    const ok = planSession(p, 'a', '2026-01-05', history(Array.from({ length: 5 }, () => ({ weight: 100, reps: 5 }))))!;
    expect(ok.items[0]!.prescription.sets.map((s) => s.targetWeight)).toEqual([102.5, 102.5, 102.5, 102.5, 102.5]);
    expect(ok.items[0]!.prescription.hint).toEqual({ kind: 'increase', from: 100, to: 102.5 });
    const miss = planSession(p, 'a', '2026-01-05', history([{ weight: 100, reps: 5 }, { weight: 100, reps: 5 }, { weight: 100, reps: 4 }, { weight: 100, reps: 5 }, { weight: 100, reps: 5 }]))!;
    expect(miss.items[0]!.prescription.sets[0]!.targetWeight).toBe(100);
  });

  it('libre : la dernière fois, telle quelle ; RIR : charge suggérée depuis la meilleure série', () => {
    const free = STRATEGIES.free.prescribe({ exercise: LIBRARY[0]!, day: dayContext({ kind: 'routine', pattern: [] }, '2026-01-05'), increment: 2.5, bodyweight: null, lastSets: [{ setType: 'working', weight: 20, reps: 12, barSpeed: null }], reference: null }, {});
    expect(free.sets).toEqual([{ setType: 'working', targetWeight: 20, targetReps: 12, targetRepsMax: null }]);
    const rir = planSession(program('hypertrophie-rir'), 'push', '2026-01-05', history([{ weight: 30, reps: 10 }]))!;
    const w = rir.items[0]!.prescription.sets[0]!.targetWeight!;
    expect(w).toBeGreaterThan(20);
    expect(w).toBeLessThan(30);
  });

  it('sans historique, une première séance s’ouvre quand même (charges à saisir)', () => {
    for (const preset of PRESETS) {
      const prog = program(preset.id);
      for (const s of prog.sessions) expect(planSession(prog, s.id, '2026-01-05', empty)!.items.length, `${preset.id}/${s.id}`).toBe(s.slots.length);
    }
  });

  it('bilan : comme prévu, au-dessus, en dessous (une rep de moins reste une rep de moins), incomplet', () => {
    const plan = planSession(p, 'a', '2026-01-05', history(Array.from({ length: 5 }, () => ({ weight: 100, reps: 5 }))))!;
    const as = (reps: number[]) => reps.map((r) => ({ weight: 102.5, reps: r, completed: true }));
    const [a1, a2, a3] = plan.items.map((i) => i.slot.id);
    const r = reviewSession(plan, { [a1!]: as([5, 5, 5, 5, 5]), [a2!]: as([5, 5, 6, 5, 5]), [a3!]: as([5, 5, 4, 5, 5]) });
    expect(r.map((x) => x.verdict)).toEqual(['as_planned', 'above', 'below']);
    expect(reviewSession(plan, { [a1!]: as([5, 5]) })[0]).toMatchObject({ verdict: 'partial', done: 2, planned: 5 });
  });
});

describe('formats et grandeurs', () => {
  it('les formats livrés sont valides ; un format à soi mal formé est refusé', () => {
    for (const f of BUILTIN_FORMATS) expect(formatErrors(f), f.id).toEqual([]);
    expect(formatErrors({ id: 'x', name: 'Tabata', metrics: ['reps'], scheme: 'interval', timer: { kind: 'interval', everySec: 30, totalSec: 10 } })).toEqual(['minuteur']);
    expect(formatErrors({ id: 'x', name: '', metrics: [], scheme: 'sets', timer: { kind: 'rest', after: 'set' } })).toEqual(['nom', 'grandeurs']);
  });

  it('la vitesse de barre passe de 3 à 5 niveaux sans rien perdre', () => {
    expect([speedFromLegacy('slow'), speedFromLegacy('normal'), speedFromLegacy('fast'), speedFromLegacy(null)]).toEqual([1, 3, 5, null]);
  });
});
