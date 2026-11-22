/**
 * Les trois portes du moteur, pures : `planSession` (la séance prescrite), `reviewSession` (le bilan par rapport au
 * plan) et `capabilities` (ce que les écrans montrent). Le module (écrans, stockage) n'appelle rien d'autre ; le moteur
 * ne connaît aucune méthode, seulement des créneaux (exercice, format, progression) et un contexte du jour.
 */
import { programCapabilities, slotCapabilities, type Capability } from './capabilities';
import { BUILTIN_FORMATS, type DayContext, type Format, type Program, type Slot } from './model';
import { strategyOf, type PlanContext } from './progression';
import type { HistorySet, Prescription } from './prescription';
import { manualReference, referenceAt, type RefCycle, type Reference, type RefSet } from './reference';
import type { TypedOneRm } from './rows';
import { dayContext } from './structure';
import type { Exercise, ProgressionType } from './types';

/** Ce que le moteur lit de l'historique : fourni par le module (requêtes SQL), ou par un test. */
export interface HistoryView {
  /** Séries faites lors de la dernière séance de cet exercice (une séance de même logique l'emporte). */
  lastSets(exerciseId: string, key: ProgressionType): readonly HistorySet[];
  /** Séries utiles à l'estimation du 1RM (masse totale), de la plus ancienne à la plus récente. */
  refSets(exerciseId: string): readonly RefSet[];
  /** 1RM saisi par l'utilisateur, tel que noté (lest pour un lesté). */
  typedOneRm(exerciseId: string): TypedOneRm | null;
  /** Dernier poids du corps connu à cette date. */
  bodyweight(date: string): number | null;
}

export interface PlannedItem {
  slot: Slot;
  exercise: Exercise;
  format: Format;
  prescription: Prescription;
  /** 1RM de référence utilisé (masse totale pour un lesté), si la progression en a besoin. */
  reference: Reference | null;
  /** Poids du corps pris en compte (lestés) ; l'écran montre toujours le lest net. */
  bodyweight: number | null;
  capabilities: Set<Capability>;
}

export interface SessionPlan {
  date: string;
  session: { id: string; name: string };
  day: DayContext;
  items: PlannedItem[];
}

const formatOf = (program: Program, id: string): Format =>
  program.formats.find((f) => f.id === id) ?? BUILTIN_FORMATS.find((f) => f.id === id) ?? (BUILTIN_FORMATS[0] as Format);

const cyclesOf = (program: Program): RefCycle[] =>
  program.structure.kind === 'periodized' ? program.structure.blocks.map((b) => ({ id: b.id, startDate: b.startDate, workWeeks: b.workWeeks })) : [];

/**
 * 1RM de référence d'un exercice à une date : celui saisi par l'utilisateur s'il pilote les charges (mode manuel),
 * sinon l'estimation de l'historique. Masse totale pour un lesté (poids du corps de la séance + lest).
 */
export function referenceFor(program: Program, history: HistoryView, exercise: Exercise, date: string, bodyweight: number | null): Reference | null {
  const typed = history.typedOneRm(exercise.id);
  if (typed !== null && typed.mode === 'manual') {
    const bw = exercise.loadType === 'bodyweight' ? (bodyweight ?? history.bodyweight(date) ?? 0) : 0;
    return manualReference(typed.value, bw, typed.setOn);
  }
  return referenceAt(history.refSets(exercise.id), cyclesOf(program), date);
}

/** La séance `sessionId` telle qu'elle serait prescrite à `date`. */
export function planSession(program: Program, sessionId: string, date: string, history: HistoryView): SessionPlan | null {
  const session = program.sessions.find((s) => s.id === sessionId);
  if (!session) return null;
  const day = dayContext(program.structure, date);
  const sessionBodyweight = history.bodyweight(date);
  const items: PlannedItem[] = [];
  for (const slot of session.slots) {
    const exercise = program.exercises.find((e) => e.id === slot.exerciseId);
    if (!exercise) continue;
    const strategy = strategyOf(slot.strategy.id);
    const bodyweight = exercise.loadType === 'bodyweight' ? sessionBodyweight : null;
    const reference = strategy.requires.includes('reference') ? referenceFor(program, history, exercise, date, sessionBodyweight) : null;
    const ctx: PlanContext = {
      exercise,
      day,
      increment: exercise.weightIncrement ?? program.increment,
      bodyweight,
      lastSets: history.lastSets(exercise.id, strategy.historyKey),
      reference: reference?.value ?? null,
    };
    items.push({ slot, exercise, format: formatOf(program, slot.formatId), prescription: strategy.prescribe(ctx, slot.strategy.params), reference, bodyweight, capabilities: slotCapabilities(program, slot) });
  }
  return { date, session: { id: session.id, name: session.name }, day, items };
}

export interface DoneSet {
  weight: number | null;
  reps: number | null;
  completed: boolean;
}

export interface ItemReview {
  slotId: string;
  /** Séries faites sur prévues. */
  done: number;
  planned: number;
  /** Par rapport au plan : comme prévu, au-dessus, en dessous (une rep de moins reste une rep de moins). */
  verdict: 'as_planned' | 'above' | 'below' | 'partial';
}

/** Le bilan d'une séance par rapport à son plan, créneau par créneau. */
export function reviewSession(plan: SessionPlan, done: Record<string, readonly DoneSet[]>): ItemReview[] {
  return plan.items.map((item) => {
    const sets = done[item.slot.id] ?? [];
    const completed = sets.filter((s) => s.completed);
    const planned = item.prescription.sets;
    let above = false;
    let below = false;
    planned.forEach((p, i) => {
      const s = completed[i];
      if (!s || p.targetReps === null || s.reps === null) return;
      if (s.reps > p.targetReps || (p.targetWeight !== null && s.weight !== null && s.weight > p.targetWeight)) above = true;
      if (s.reps < p.targetReps || (p.targetWeight !== null && s.weight !== null && s.weight < p.targetWeight)) below = true;
    });
    const verdict = completed.length < planned.length ? 'partial' : below ? 'below' : above ? 'above' : 'as_planned';
    return { slotId: item.slot.id, done: completed.length, planned: planned.length, verdict };
  });
}

/** Ce que les écrans du module peuvent montrer pour ce programme. */
export function capabilities(program: Program): Set<Capability> {
  return programCapabilities(program);
}
