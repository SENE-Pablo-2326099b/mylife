import type { StrengthWeek } from '@mylife/training';
import type { PendingChange, RemoteRow, SyncState } from '@mylife/core/engine';
import { addBodyweight, createExercise, dayView, moveSession, type NewExercise } from './day';
import { archiveExercise, bodyVolume, createVariant, exerciseDetail, exercisesView, regionDetail, updateExercise, type ExercisePatch } from './exercises';
import { progressView, type ProgressWindow } from './progress';
import { rateSession, sessionReport } from './report';
import { cycleReport, justEnded } from './cycleReport';
import { agendaEvents, copilotCard, executeMove, homeCard } from './bridge';
import { calendarView } from './calendar';
import { setsCsv } from './exporter';
import { exportFull } from './full';
import { applyImport, exportProgram, importPreview, readyPrograms, readyProgramText, type ImportOptions } from './importer';
import { baseValues, blockDetail, deleteBlock, liftView, saveBlock, setBase, setBlockWeek, setLiftWeek, setReference, settingsView, type BasePatch, type BlockPatch } from './plan';
import { addSlot, archiveTemplate, createTemplate, moveSlot, programView, removeSlot, renameTemplate, setTemplateDays, slotDetail, templateDetail, templatesView, updateSlot, type SlotPatch } from './program';
import { overview } from './queries';
import { sessionOps } from './session';
import { migrate, SCHEMA_VERSION } from './schema';
import type { Db } from './sql';
import { installSyncTriggers, syncOps } from './syncStore';

/**
 * Le « serveur » de MyPerf dans le navigateur : il tourne dans le Worker, à côté de SQLite, et répond aux messages de
 * l'écran. Pur (une base en paramètre) : les tests le font tourner sur la même SQLite, en mémoire.
 */
export function createBackend(d: Db) {
  migrate(d);
  installSyncTriggers(d);
  const sync = syncOps(d);
  const session = sessionOps(d);
  const ops = {
    schemaVersion: () => SCHEMA_VERSION,
    overview: (today: string) => overview(d, today, sync.pendingCount()),
    pending: (limit: number) => sync.pending(limit),
    ack: (done: Pick<PendingChange, 'tbl' | 'rid' | 'ver'>[]) => sync.ack(done),
    apply: (rows: RemoteRow[]) => sync.apply(rows),
    snapshot: () => sync.snapshot(),
    replace: (rows: RemoteRow[]) => sync.replace(rows),
    clearPending: () => sync.clearPending(),
    forget: () => sync.forget(),
    getState: () => sync.getState(),
    setState: (state: SyncState) => sync.setState(state),
    pendingCount: () => sync.pendingCount(),
    /** Des données propres à l'appareil (séances, mesures) : pour relier l'appareil sans rien perdre ni mélanger. */
    hasData: () => (d.first<{ n: number }>('SELECT (SELECT COUNT(*) FROM workouts) + (SELECT COUNT(*) FROM body_entries) AS n')?.n ?? 0) > 0,
    // La page Jour.
    dayView: (date: string) => dayView(d, date),
    addBodyweight: (date: string, value: number) => addBodyweight(d, date, value),
    moveSession: (templateId: string, from: string, to: string) => moveSession(d, templateId, from, to),
    programView: (date: string) => programView(d, date),
    templatesView: () => templatesView(d),
    templateDetail: (id: string, date: string) => templateDetail(d, id, date),
    slotDetail: (id: string, date: string) => slotDetail(d, id, date),
    createTemplate: (name: string) => createTemplate(d, name),
    renameTemplate: (id: string, name: string) => renameTemplate(d, id, name),
    archiveTemplate: (id: string) => archiveTemplate(d, id),
    setTemplateDays: (id: string, days: number[]) => setTemplateDays(d, id, days),
    addSlot: (templateId: string, exerciseId: string) => addSlot(d, templateId, exerciseId),
    removeSlot: (id: string) => removeSlot(d, id),
    moveSlot: (id: string, delta: -1 | 1) => moveSlot(d, id, delta),
    updateSlot: (id: string, patch: SlotPatch) => updateSlot(d, id, patch),
    createExerciseIn: (templateId: string | null, e: NewExercise) => {
      const id = createExercise(d, e);
      if (templateId) addSlot(d, templateId, id);
      return id;
    },
    settingsView: (date: string, blockId: string | null) => settingsView(d, date, blockId),
    liftView: (exerciseId: string, blockId: string | null, date: string) => liftView(d, exerciseId, blockId, date),
    setLiftWeek: (blockId: string, exerciseId: string, weekIndex: number, week: Partial<StrengthWeek> | null) => setLiftWeek(d, blockId, exerciseId, weekIndex, week),
    setReference: (exerciseId: string, value: number | null, date: string) => setReference(d, exerciseId, value, date),
    blockDetail: (id: string | null, date: string) => blockDetail(d, id, date),
    saveBlock: (id: string | null, patch: BlockPatch, date: string) => saveBlock(d, id, patch, date),
    setBlockWeek: (id: string, weekIndex: number, week: Partial<StrengthWeek>) => setBlockWeek(d, id, weekIndex, week),
    deleteBlock: (id: string) => deleteBlock(d, id),
    baseValues: () => baseValues(d),
    setBase: (patch: BasePatch) => setBase(d, patch),
    importPreview: (input: string) => importPreview(d, input),
    applyImport: (input: string, options: ImportOptions, date: string) => applyImport(d, input, options, date),
    exportProgram: (name?: string) => JSON.stringify(exportProgram(d, name), null, 2),
    readyPrograms: () => readyPrograms(),
    readyProgramText: (id: string) => readyProgramText(id),
    exercisesView: (date: string) => exercisesView(d, date),
    exerciseDetail: (id: string, date: string) => exerciseDetail(d, id, date),
    updateExercise: (id: string, patch: ExercisePatch) => updateExercise(d, id, patch),
    archiveExercise: (id: string) => archiveExercise(d, id),
    createVariant: (parentId: string, name: string) => createVariant(d, parentId, name),
    bodyVolume: (date: string, windowDays: number) => bodyVolume(d, date, windowDays),
    regionDetail: (id: Parameters<typeof regionDetail>[1], date: string, windowDays: number) => regionDetail(d, id, date, windowDays),
    progressView: (date: string, window: ProgressWindow, hidden: string[]) => progressView(d, date, window, hidden),
    sessionReport: (id: string) => sessionReport(d, id),
    rateSession: (id: string, rating: number | null, notes: string) => rateSession(d, id, rating, notes),
    cycleReport: (id: string, date: string) => cycleReport(d, id, date),
    justEnded: (date: string) => justEnded(d, date),
    calendarView: (month: string, today: string) => calendarView(d, month, today),
    exportFull: () => JSON.stringify(exportFull(d), null, 2),
    setsCsv: () => setsCsv(d),
    homeCard: (date: string) => homeCard(d, date),
    copilotCard: (date: string) => copilotCard(d, date),
    agendaEvents: (date: string) => agendaEvents(d, date),
    executeMove: (plannedId: string, to: string) => executeMove(d, plannedId, to),
    createExercise: (e: NewExercise) => createExercise(d, e),
    // La séance (étape P2).
    activeSession: () => session.active(),
    startOptions: (date: string) => session.startOptions(date),
    startSession: (templateId: string | null, date: string) => session.start(templateId, date),
    sessionDoc: (id: string) => session.doc(id),
    updateSet: (setId: string, patch: Parameters<typeof session.update>[1]) => session.update(setId, patch),
    completeSet: (setId: string, patch: Parameters<typeof session.complete>[1]) => session.complete(setId, patch),
    uncompleteSet: (setId: string) => session.uncomplete(setId),
    addSet: (weId: string) => session.addSet(weId),
    removeSet: (setId: string) => session.removeSet(setId),
    setSetType: (setId: string, type: Parameters<typeof session.setType>[1]) => session.setType(setId, type),
    exerciseComment: (weId: string, text: string) => session.exerciseComment(weId, text),
    replaceExercise: (weId: string, exerciseId: string, scope: 'today' | 'program') => session.replace(weId, exerciseId, scope),
    addExercise: (workoutId: string, exerciseId: string) => session.addExercise(workoutId, exerciseId),
    exerciseChoices: (forExerciseId: string | null) => session.exerciseChoices(forExerciseId),
    setBodyweight: (workoutId: string, value: number | null) => session.setBodyweight(workoutId, value),
    finishSession: (workoutId: string) => session.finish(workoutId),
    discardSession: (workoutId: string) => session.discard(workoutId),
  };
  return ops;
}

export type Backend = ReturnType<typeof createBackend>;
export type Op = keyof Backend;

/** Un message de l'écran vers le Worker, et sa réponse. */
export interface Request {
  id: number;
  op: Op;
  args: unknown[];
}
export type Response = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

/** Où vit la base : fichier persistant (OPFS) ou, à défaut, en mémoire (perdue au rechargement). */
export interface StorageInfo {
  /** `busy` : la base est ouverte ailleurs (un autre onglet) ; cet écran travaille en mémoire, rien n'est gardé. */
  vfs: 'opfs-sahpool' | 'memory' | 'busy';
  sqlite: string;
}
