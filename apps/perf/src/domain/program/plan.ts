import type { Equipment, Intention, LoadType, Muscle } from '../types';
import { PROGRAM_FORMAT, PROGRAM_VERSION, WEEKDAY_NAMES, type ParsedExercise, type ParsedProgram, type ProgramFile } from './format';
import { guessExercise, matchExercise, type LibraryEntry, type Match } from './match';

/**
 * Le plan d'import : ce qui sera créé, rapproché ou signalé, avant toute écriture. L'écran d'aperçu le
 * montre et permet de corriger (un exercice mal reconnu, une séance à renommer) ; le service l'applique.
 */

export interface PlanExercise {
  parsed: ParsedExercise;
  match: Match;
  /** Exercice de la bibliothèque retenu ; null : un nouvel exercice sera créé (nom `parsed.name`). */
  exerciseId: string | null;
  sets: number;
  repMin: number | null;
  repMax: number | null;
  intention: Intention;
  /** Ce que MyPerf ne range pas ailleurs (%, kg, RPE, repos, consignes), visible en séance. */
  notes: string;
}

export interface PlanSession {
  name: string;
  weekdays: number[];
  notes: string;
  exercises: PlanExercise[];
}

export interface ImportPlan {
  name: string;
  notes: string;
  sessions: PlanSession[];
  oneRms: { name: string; kg: number; exerciseId: string | null }[];
}

const fmtNum = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');

/** Les consignes d'un exercice qui n'ont pas de place dédiée, en une ligne. */
export function slotNotes(e: ParsedExercise): string {
  const parts: string[] = [];
  if (e.amrap) parts.push('max de reps');
  if (e.seconds !== null) parts.push(`${e.seconds} s`);
  if (e.percent !== null) parts.push(`${fmtNum(e.percent)} % du 1RM`);
  if (e.kg !== null) parts.push(`${e.bodyweight ? '+' : ''}${fmtNum(e.kg)} kg`);
  if (e.rpe !== null) parts.push(`RPE ${fmtNum(e.rpe)}`);
  if (e.restSeconds !== null) parts.push(`repos ${e.restSeconds >= 60 ? `${Math.floor(e.restSeconds / 60)} min${e.restSeconds % 60 ? ` ${e.restSeconds % 60}` : ''}` : `${e.restSeconds} s`}`);
  if (e.notes) parts.push(e.notes);
  return parts.join(' · ');
}

export const intentionFor = (repMax: number | null): Intention => (repMax !== null && repMax <= 5 ? 'strength' : 'hypertrophy');

/** Un nom pas encore pris (« Push », puis « Push (2) »). */
export function uniqueName(name: string, taken: Set<string>): string {
  let n = name.trim() || 'Séance';
  for (let i = 2; taken.has(n.toLowerCase()); i++) n = `${name.trim()} (${i})`;
  taken.add(n.toLowerCase());
  return n;
}

export function buildPlan(program: ParsedProgram, library: readonly LibraryEntry[], existingTemplates: readonly string[]): ImportPlan {
  const taken = new Set(existingTemplates.map((n) => n.toLowerCase()));
  return {
    name: program.name,
    notes: program.notes,
    sessions: program.sessions.map((s) => ({
      name: uniqueName(s.name, taken),
      weekdays: s.weekdays,
      notes: s.notes,
      exercises: s.exercises.map((e) => {
        const match = matchExercise(e.name, library);
        return { parsed: e, match, exerciseId: match.exerciseId, sets: e.sets, repMin: e.repMin, repMax: e.repMax, intention: intentionFor(e.repMax), notes: slotNotes(e) };
      }),
    })),
    oneRms: program.oneRms.map((r) => ({ ...r, exerciseId: matchExercise(r.name, library).exerciseId })),
  };
}

/** Les nouveaux exercices à créer (un par nom, même s'il revient dans plusieurs séances). */
export function newExercises(plan: ImportPlan): { name: string; equipment: Equipment; primaryMuscles: Muscle[]; loadType: LoadType; category: 'compound' | 'isolation' | 'main'; unilateral: boolean; repMin: number; repMax: number }[] {
  const out = new Map<string, ReturnType<typeof newExercises>[number]>();
  for (const s of plan.sessions) {
    for (const e of s.exercises) {
      if (e.exerciseId !== null) continue;
      const key = e.parsed.name.trim().toLowerCase();
      if (out.has(key)) continue;
      const g = guessExercise(e.parsed.name, { equipment: e.parsed.equipment, muscles: e.parsed.muscles, bodyweight: e.parsed.bodyweight });
      out.set(key, { name: e.parsed.name.trim(), ...g, repMin: e.repMin ?? 8, repMax: e.repMax ?? Math.max(12, e.repMin ?? 12) });
    }
  }
  return [...out.values()];
}

export interface PlanSummary {
  sessions: number;
  exercises: number;
  recognized: number;
  created: number;
  close: number;
  days: number;
}

export function summarizePlan(plan: ImportPlan): PlanSummary {
  const all = plan.sessions.flatMap((s) => s.exercises);
  return {
    sessions: plan.sessions.length,
    exercises: all.length,
    recognized: all.filter((e) => e.exerciseId !== null).length,
    created: newExercises(plan).length,
    close: all.filter((e) => e.match.kind === 'close' && e.exerciseId === e.match.exerciseId).length,
    days: new Set(plan.sessions.flatMap((s) => s.weekdays)).size,
  };
}

// ---------------------------------------------------------------- export

export interface ExportInput {
  name: string;
  sessions: {
    name: string;
    notes: string;
    exercises: { name: string; sets: number; repMin: number | null; repMax: number | null; notes: string; equipment: Equipment; muscles: Muscle[]; bodyweight: boolean }[];
  }[];
  /** Semaine type : jour (0 = lundi) → nom de la séance. */
  pattern: { weekday: number; session: string }[];
  oneRms: { name: string; kg: number }[];
}

/** Le programme actuel dans le format d'échange (à partager, à réimporter ailleurs). */
export function programToFile(input: ExportInput): ProgramFile {
  return {
    format: PROGRAM_FORMAT,
    version: PROGRAM_VERSION,
    name: input.name,
    sessions: input.sessions.map((s) => {
      const days = input.pattern.filter((p) => p.session === s.name).map((p) => WEEKDAY_NAMES[p.weekday]!);
      return {
        name: s.name,
        ...(days.length ? { days: [...new Set(days)] } : {}),
        ...(s.notes ? { notes: s.notes } : {}),
        exercises: s.exercises.map((e) => ({
          name: e.name,
          sets: e.sets,
          ...(e.repMin !== null ? { reps: e.repMax !== null && e.repMax !== e.repMin ? `${e.repMin}-${e.repMax}` : String(e.repMin) } : {}),
          ...(e.notes ? { notes: e.notes } : {}),
          equipment: e.equipment,
          ...(e.muscles.length ? { muscles: e.muscles } : {}),
          ...(e.bodyweight ? { bodyweight: true } : {}),
        })),
      };
    }),
    ...(input.oneRms.length ? { oneRepMaxes: input.oneRms.map((r) => ({ exercise: r.name, kg: r.kg })) } : {}),
  };
}
