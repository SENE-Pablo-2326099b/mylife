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
export { addDays, today, weekday } from './dates';
