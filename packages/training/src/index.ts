/**
 * packages/training : le métier de MyPerf, pur (aucune base, aucun écran). Le calcul éprouvé de l'app d'avant
 * (prescription, référence 1RM, cycles, volume, stagnation) et, par-dessus, le modèle composable (formats,
 * progressions, structures, capacités, modèles). Détail : docs/V5-MYPERF-TRAINING.md.
 */
export * from './model';
export * from './capabilities';
export * from './progression';
export * from './structure';
export * from './engine';
export * from './presets';
export * from './fromLegacy';
export * from './rows';
export type * from './types';
export type { HistorySet, PlannedSet, Prescription } from './prescription';
export type { Reference, RefSet } from './reference';
export { DEFAULT_REST, restSeconds, type RestSettings } from './rest';
export { DEFAULT_PLATES, barbellPlates, beltPlates, describePlates } from './plates';
export { recalcBackoffs, typeForNewSet } from './sets';
export { addDays, diffDays, today, weekday } from './dates';
export { estimate1RM } from './math';
export { MESO_KINDS, mesoKindInfo, schemeForKind } from './mesoTypes';
export { DEFAULT_DELOAD, generateScheme, resizeScheme, totalWeeks } from './mesocycle';
export { parseJsonLoose, parseProgramInput, programPrompt, PROGRAM_FORMAT, type ParsedBlock, type ParsedExercise, type ParsedProgram, type ParseResult, type ProgramFile } from './program/exchange';
export { buildPlan, newExercises, programToFile, slotNotes, summarizePlan, type ExportBlock, type ExportInput, type ImportPlan, type PlanExercise } from './program/plan';
export { guessExercise, matchExercise, type LibraryEntry } from './program/match';
export { READY_PROGRAMS, type ReadyProgram } from './program/ready';
export { BODY_REGIONS, loadLevel, regionAt, regionById, regionLoads, type BodyRegion, type BodyView, type RegionId, type RegionLoad } from './bodyMap';
export { isIndirect, type VolumeSet } from './analytics';
export { bestPerCycle, detectStagnation, e1rmSeries, PROGRESS_THRESHOLD, recordEvents, weeklyConsistency, type SetRecord } from './analytics';
export { bodyTrend } from './bodyTrend';
export { summarizeSession, type SessionSummary, type SummarySet } from './summary';

export { describeGroup, describeGroups, GROUP_LIMITS, groupsOfWeek, groupToSpec, parseGroup, parseGroups, weekFromGroups } from './groups';
export { weekPlan } from './prescription';
