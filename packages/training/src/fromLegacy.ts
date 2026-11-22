/**
 * Les données de MyPerf telles qu'elles sont aujourd'hui (tables SQLite de la synchro `perf`) lues comme un programme
 * composable, sans conversion des données : les mésocycles deviennent la structure « blocs », les séances types les
 * séances, chaque exercice de séance type un créneau au format « séries » avec sa progression (top set et backoffs au %
 * du 1RM, ou double progression). C'est son modèle « Streetlifting par blocs », à l'identique.
 */
import type { Program, SessionTemplate, Slot, Structure } from './model';
import { MAX_RISE_PER_CYCLE, RELIABLE_MAX_REPS } from './reference';
import { incrementFromSettings, sortMesocycles, toExercise, toTemplate, toTemplateExercise, toWeekOverride, toWeekPattern, type Row } from './rows';

export interface LegacyTables {
  exercises: readonly Row[];
  mesocycles: readonly Row[];
  cycle_week_overrides: readonly Row[];
  templates: readonly Row[];
  template_exercises: readonly Row[];
  week_pattern: readonly Row[];
  settings: readonly Row[];
}

export function programFromLegacy(t: LegacyTables): Program {
  const exercises = t.exercises.map(toExercise);
  const byId = new Map(exercises.map((e) => [e.id, e]));
  const slotsOf = (templateId: string): Slot[] =>
    t.template_exercises
      .map(toTemplateExercise)
      .filter((te) => te.templateId === templateId)
      .sort((a, b) => a.position - b.position)
      .flatMap((te): Slot[] => {
        const exercise = byId.get(te.exerciseId);
        if (!exercise) return [];
        const progression = te.progressionType ?? exercise.progressionType;
        return [
          {
            id: te.id,
            exerciseId: te.exerciseId,
            formatId: 'sets',
            strategy:
              progression === 'top_set_backoff'
                ? { id: 'percent_reference', params: { topSets: te.topSets, backoffSets: te.backoffSets, backoffPercent: te.backoffPercent } }
                : { id: 'double_progression', params: { sets: te.targetSets, repMin: te.repMin, repMax: te.repMax } },
            group: null,
            intention: te.intention,
            restSec: null,
            notes: te.notes,
          },
        ];
      });
  const sessions: SessionTemplate[] = t.templates
    .map(toTemplate)
    .sort((a, b) => a.position - b.position)
    .map((tpl) => ({ id: tpl.id, name: tpl.name, slots: slotsOf(tpl.id) }));
  const pattern = t.week_pattern.map(toWeekPattern);
  const blocks = sortMesocycles(t.mesocycles);
  const structure: Structure = blocks.length > 0 ? { kind: 'periodized', blocks, overrides: t.cycle_week_overrides.map(toWeekOverride), pattern } : { kind: 'routine', pattern };
  return {
    structure,
    sessions,
    exercises,
    formats: [],
    increment: incrementFromSettings(t.settings),
    reference: { reliableMaxReps: RELIABLE_MAX_REPS, maxCycleGain: MAX_RISE_PER_CYCLE },
  };
}
