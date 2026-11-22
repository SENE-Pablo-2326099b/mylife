/**
 * Les capacités réellement utilisées par un programme : c'est ce qui pilote l'interface. Chaque composant d'écran
 * exige la sienne et ne s'affiche que si elle est présente (une routine ne montre jamais de frise de blocs ; sans 1RM,
 * aucune table de %). Calculées depuis les données, jamais d'après le nom d'une méthode.
 */
import { BUILTIN_FORMATS, type Format, type Program, type Slot } from './model';
import { STRATEGIES } from './progression';

export type Capability =
  | 'blocks'
  | 'weeks'
  | 'deload'
  | 'reference'
  | 'percentages'
  | 'plates'
  | 'weighted'
  | 'rpe'
  | 'rir'
  | 'speed'
  | 'metric:load'
  | 'metric:reps'
  | 'metric:time'
  | 'metric:distance'
  | 'metric:rounds'
  | 'timer:rest'
  | 'timer:interval'
  | 'timer:countdown'
  | 'timer:cap'
  | 'timer:stopwatch'
  | 'groups';

const formatOf = (program: Pick<Program, 'formats'>, id: string): Format =>
  program.formats.find((f) => f.id === id) ?? BUILTIN_FORMATS.find((f) => f.id === id) ?? (BUILTIN_FORMATS[0] as Format);

/** Ce qu'une carte d'exercice montre en séance : colonnes de la ligne de série, minuteur, repères. */
export function slotCapabilities(program: Pick<Program, 'formats' | 'exercises'>, slot: Slot): Set<Capability> {
  const caps = new Set<Capability>();
  const format = formatOf(program, slot.formatId);
  for (const m of format.metrics) {
    if (m === 'rpe' || m === 'rir' || m === 'speed') caps.add(m);
    else caps.add(`metric:${m}`);
  }
  caps.add(`timer:${format.timer.kind}`);
  for (const c of STRATEGIES[slot.strategy.id]?.requires ?? []) caps.add(c);
  const exercise = program.exercises.find((e) => e.id === slot.exerciseId);
  if (exercise?.loadType === 'bodyweight' && caps.has('metric:load')) caps.add('weighted');
  if (exercise?.equipment === 'barbell' && caps.has('metric:load')) caps.add('plates');
  if (slot.group) caps.add('groups');
  return caps;
}

/** Ce que les écrans du module (Jour, Programme, Progrès) peuvent montrer pour ce programme. */
export function programCapabilities(program: Program): Set<Capability> {
  const caps = new Set<Capability>();
  const s = program.structure;
  if (s.kind === 'periodized' && s.blocks.length > 0) {
    caps.add('blocks');
    caps.add('weeks');
    if (s.blocks.some((b) => b.deloadWeeks > 0)) caps.add('deload');
  }
  if (s.kind === 'cycle') caps.add('weeks');
  for (const session of program.sessions) for (const slot of session.slots) for (const c of slotCapabilities(program, slot)) caps.add(c);
  return caps;
}
