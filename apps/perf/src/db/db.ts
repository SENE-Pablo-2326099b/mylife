/**
 * Minimal synchronous database contract.
 *
 * Choice: synchronous SQLite. Every user action is written to disk before the UI moves on,
 * so an in-progress workout survives a crash or a kill. Writes are single-row and take well
 * under a millisecond; heavier reads (stats) are aggregated in SQL.
 * The app plugs expo-sqlite in; tests plug better-sqlite3 in.
 */
export type SqlValue = string | number | null;

export interface Db {
  run(sql: string, params?: readonly SqlValue[]): void;
  all<T>(sql: string, params?: readonly SqlValue[]): T[];
  first<T>(sql: string, params?: readonly SqlValue[]): T | null;
  exec(sql: string): void;
  transaction(fn: () => void): void;
}

type Listener = () => void;

let current: Db | null = null;
let version = 0;
const listeners = new Set<Listener>();
let batchDepth = 0;
let pendingNotify = false;

/** Wraps a raw driver so every write bumps the data version (screens re-query lazily on it). */
function instrument(raw: Db): Db {
  const notify = () => {
    if (batchDepth > 0) {
      pendingNotify = true;
      return;
    }
    version += 1;
    listeners.forEach((l) => l());
  };
  return {
    run(sql, params) {
      raw.run(sql, params);
      notify();
    },
    all: (sql, params) => raw.all(sql, params),
    first: (sql, params) => raw.first(sql, params),
    exec(sql) {
      raw.exec(sql);
      notify();
    },
    transaction(fn) {
      // Nested calls join the outer transaction (SQLite has no nested BEGIN).
      if (batchDepth > 0) {
        fn();
        return;
      }
      batchDepth += 1;
      try {
        raw.transaction(fn);
      } finally {
        batchDepth -= 1;
      }
      if (batchDepth === 0 && pendingNotify) {
        pendingNotify = false;
        notify();
      }
    },
  };
}

export function setDb(raw: Db): Db {
  current = instrument(raw);
  return current;
}

export function db(): Db {
  if (current === null) throw new Error('Database not initialised');
  return current;
}

export function dataVersion(): number {
  return version;
}

export function subscribeData(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

let idCounter = 0;
/** Sortable unique id (time + counter + random). Collision-free for a single-device app. */
export function newId(): string {
  idCounter = (idCounter + 1) % 1_679_616;
  return `${Date.now().toString(36)}${idCounter.toString(36).padStart(4, '0')}${Math.random().toString(36).slice(2, 8)}`;
}
