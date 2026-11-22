/**
 * La structure dans le temps → le contexte du jour. Trois formes (routine sans fin, cycle libre, blocs périodisés),
 * une seule sortie : les progressions lisent le contexte sans savoir d'où il vient.
 */
import { diffDays, weekday } from './dates';
import { mesocycleForDate, phaseFor } from './mesocycle';
import type { DayContext, Pattern, Structure } from './model';
import type { WeekOverride } from './types';

const noOverrides = () => new Map<number, WeekOverride>();

export function dayContext(structure: Structure, date: string): DayContext {
  if (structure.kind === 'routine') {
    return { date, block: null, week: null, modifiers: { phase: null, scheme: null, deload: null, overrides: noOverrides } };
  }
  if (structure.kind === 'cycle') {
    const offset = diffDays(structure.startDate, date);
    const weeks = Math.max(1, structure.weeks);
    const raw = Math.floor(offset / 7);
    const inside = offset >= 0 && (structure.repeat || raw < weeks);
    return {
      date,
      block: null,
      week: inside ? { index: (raw % weeks) + 1, of: weeks, deload: false } : null,
      modifiers: { phase: null, scheme: null, deload: null, overrides: noOverrides },
    };
  }
  // Périodisé : le bloc en cours et sa semaine, comme l'app d'avant (hors travail ou décharge, pas de bloc actif).
  const blocks = structure.blocks;
  const meso = mesocycleForDate(blocks, date);
  const phase = meso === null ? null : phaseFor(meso, date);
  const active = meso !== null && phase !== null && (phase.kind === 'work' || phase.kind === 'deload');
  if (!active) return { date, block: null, week: null, modifiers: { phase: null, scheme: null, deload: null, overrides: noOverrides } };
  const index = blocks.indexOf(meso);
  const week = phase.week;
  const overrides = (exerciseId: string) =>
    new Map(structure.overrides.filter((o) => o.mesocycleId === meso.id && o.exerciseId === exerciseId).map((o) => [o.weekIndex, o] as const));
  return {
    date,
    block: { id: meso.id, name: meso.name, kind: meso.kind, index: index + 1, total: blocks.length },
    week: { index: week, of: meso.workWeeks + meso.deloadWeeks, deload: phase.kind === 'deload' },
    modifiers: { phase, scheme: meso.scheme, deload: meso.deload, overrides },
  };
}

/** Les séances prévues de la semaine type pour un jour (lundi = 0). */
export function sessionsOn(pattern: Pattern, date: string): string[] {
  const day = weekday(date);
  return pattern
    .filter((p) => p.weekday === day)
    .sort((a, b) => a.position - b.position)
    .map((p) => p.templateId);
}

/** La semaine type de la structure. */
export const patternOf = (s: Structure): Pattern => s.pattern;

