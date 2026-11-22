import type { PendingChange, RemoteRow, SyncState } from '@mylife/core/engine';
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
  vfs: 'opfs-sahpool' | 'memory';
  sqlite: string;
}
