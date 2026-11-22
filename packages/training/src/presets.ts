/**
 * Les modèles livrés : des points de départ, enregistrés comme des données (structure, séances, créneaux avec leur
 * format et leur progression). Un utilisateur en choisit un ou part de zéro, puis change tout créneau par créneau.
 * Aucun ne contient le programme réel de quelqu'un : exercices de la bibliothèque de base, valeurs génériques.
 */
import { DEFAULT_DELOAD, generateScheme } from './mesocycle';
import type { Program, SessionTemplate, Slot, StrategyRef, Structure } from './model';
import { MAX_RISE_PER_CYCLE, RELIABLE_MAX_REPS } from './reference';
import type { Mesocycle } from './types';

export interface Preset {
  id: string;
  name: string;
  detail: string;
  /** Construit le programme de départ ; `start` : premier lundi du programme (AAAA-MM-JJ). */
  build(start: string): Omit<Program, 'exercises'>;
}

const slot = (id: string, exerciseId: string, strategy: StrategyRef, formatId = 'sets', extra: Partial<Slot> = {}): Slot => ({
  id,
  exerciseId,
  formatId,
  strategy,
  group: null,
  intention: null,
  restSec: null,
  notes: '',
  ...extra,
});
const percent = (): StrategyRef => ({ id: 'percent_reference', params: {} });
const double = (sets = 3, repMin?: number, repMax?: number): StrategyRef => ({ id: 'double_progression', params: { sets, repMin, repMax } });
const linear = (sets: number, reps: number, metric: 'load' | 'reps' | 'time' = 'load'): StrategyRef => ({ id: 'linear', params: { sets, reps, metric } });
const policy = { reliableMaxReps: RELIABLE_MAX_REPS, maxCycleGain: MAX_RISE_PER_CYCLE };
const week = (pairs: readonly [number, string][]) => pairs.map(([weekday, templateId], position) => ({ id: `w${position}`, weekday, templateId, position }));

function block(id: string, name: string, kind: Mesocycle['kind'], startDate: string, workWeeks: number): Mesocycle {
  return { id, name, kind, macrocycleId: null, startDate, workWeeks, deloadWeeks: 1, scheme: generateScheme(workWeeks), deload: DEFAULT_DELOAD, notes: '' };
}

const addWeeks = (date: string, weeks: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
};

export const PRESETS: readonly Preset[] = [
  {
    id: 'streetlifting-blocs',
    name: 'Streetlifting par blocs',
    detail: 'blocs périodisés, lifts au % du 1RM (top set et backoffs), accessoires en double progression',
    build(start) {
      const blocks = [block('b1', 'Accumulation', 'accumulation', start, 4), block('b2', 'Transmutation', 'transmutation', addWeeks(start, 5), 3), block('b3', 'Réalisation', 'realization', addWeeks(start, 9), 3)];
      const structure: Structure = { kind: 'periodized', blocks, overrides: [], pattern: week([[0, 'force-a'], [2, 'volume'], [4, 'force-b']]) };
      const sessions: SessionTemplate[] = [
        { id: 'force-a', name: 'Force A', slots: [slot('fa1', 'ex_weighted_pullup', percent()), slot('fa2', 'ex_squat', percent()), slot('fa3', 'ex_barbell_curl', double())] },
        { id: 'force-b', name: 'Force B', slots: [slot('fb1', 'ex_weighted_dip', percent()), slot('fb2', 'ex_deadlift', percent()), slot('fb3', 'ex_lateral_raise', double(3, 12, 15))] },
        { id: 'volume', name: 'Volume', slots: [slot('v1', 'ex_weighted_pullup', double(4, 6, 10)), slot('v2', 'ex_dip', double(4, 8, 12)), slot('v3', 'ex_leg_press', double())] },
      ];
      return { structure, sessions, formats: [], increment: 2.5, reference: policy };
    },
  },
  {
    id: 'routine-simple',
    name: 'Routine simple',
    detail: 'semaine type sans fin, tout en double progression',
    build() {
      const structure: Structure = { kind: 'routine', pattern: week([[0, 'haut'], [2, 'bas'], [4, 'complet']]) };
      const sessions: SessionTemplate[] = [
        { id: 'haut', name: 'Haut du corps', slots: [slot('h1', 'ex_db_press', double(3, 8, 12)), slot('h2', 'ex_lat_pulldown', double(3, 10, 15)), slot('h3', 'ex_lateral_raise', double(3, 12, 15))] },
        { id: 'bas', name: 'Bas du corps', slots: [slot('b1', 'ex_leg_press', double(3, 10, 15)), slot('b2', 'ex_rdl', double(3, 8, 12)), slot('b3', 'ex_standing_calf', double(3, 12, 20))] },
        { id: 'complet', name: 'Complet', slots: [slot('c1', 'ex_db_row', double()), slot('c2', 'ex_hip_thrust', double()), slot('c3', 'ex_cable_crunch', double(3, 12, 20))] },
      ];
      return { structure, sessions, formats: [], increment: 2.5, reference: policy };
    },
  },
  {
    id: 'lineaire-5x5',
    name: 'Linéaire 5 × 5',
    detail: 'routine, +2,5 kg à chaque séance réussie',
    build() {
      const structure: Structure = { kind: 'routine', pattern: week([[0, 'a'], [2, 'b'], [4, 'a']]) };
      const sessions: SessionTemplate[] = [
        { id: 'a', name: 'Séance A', slots: [slot('a1', 'ex_squat', linear(5, 5)), slot('a2', 'ex_bench', linear(5, 5)), slot('a3', 'ex_barbell_row', linear(5, 5))] },
        { id: 'b', name: 'Séance B', slots: [slot('b1', 'ex_squat', linear(5, 5)), slot('b2', 'ex_ohp', linear(5, 5)), slot('b3', 'ex_deadlift', linear(1, 5))] },
      ];
      return { structure, sessions, formats: [], increment: 2.5, reference: policy };
    },
  },
  {
    id: 'hypertrophie-rir',
    name: 'Hypertrophie au RIR',
    detail: 'cycle de 6 semaines, charges suggérées par les reps en réserve',
    build(start) {
      const rir = (reps: number): StrategyRef => ({ id: 'autoregulated', params: { sets: 3, reps, rir: 2 } });
      const structure: Structure = { kind: 'cycle', name: 'Hypertrophie', startDate: start, weeks: 6, repeat: true, pattern: week([[0, 'push'], [2, 'pull'], [4, 'legs']]) };
      const sessions: SessionTemplate[] = [
        { id: 'push', name: 'Poussée', slots: [slot('p1', 'ex_incline_db_press', rir(10)), slot('p2', 'ex_cable_fly', rir(12))] },
        { id: 'pull', name: 'Tirage', slots: [slot('t1', 'ex_cable_row', rir(10)), slot('t2', 'ex_face_pull', rir(15))] },
        { id: 'legs', name: 'Jambes', slots: [slot('j1', 'ex_hack_squat', rir(10)), slot('j2', 'ex_leg_curl', rir(12))] },
      ];
      return { structure, sessions, formats: [], increment: 2.5, reference: policy };
    },
  },
  {
    id: 'callisthenie',
    name: 'Callisthénie',
    detail: 'cycle libre, EMOM, travail au temps et circuits',
    build(start) {
      const structure: Structure = { kind: 'cycle', name: 'Retour', startDate: start, weeks: 6, repeat: false, pattern: week([[1, 'haut'], [4, 'complet']]) };
      const sessions: SessionTemplate[] = [
        {
          id: 'haut',
          name: 'Haut du corps',
          slots: [
            slot('h1', 'ex_pullup', double(3, 6, 10), 'sets', { group: { id: 'g1', kind: 'superset', rounds: 3 } }),
            slot('h2', 'ex_pushup', double(3, 12, 20), 'sets', { group: { id: 'g1', kind: 'superset', rounds: 3 } }),
            slot('h3', 'ex_pullup', linear(10, 5, 'reps'), 'emom'),
            slot('h4', 'ex_hanging_leg_raise', linear(3, 45, 'time'), 'hold'),
          ],
        },
        { id: 'complet', name: 'Complet', slots: [slot('c1', 'ex_inverted_row', double(4, 8, 15), 'sets', { group: { id: 'g2', kind: 'circuit', rounds: 4 } }), slot('c2', 'ex_dip', double(4, 8, 15), 'sets', { group: { id: 'g2', kind: 'circuit', rounds: 4 } })] },
      ];
      return { structure, sessions, formats: [], increment: 2.5, reference: policy };
    },
  },
];
