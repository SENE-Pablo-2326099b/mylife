/**
 * Web driver (PWA MyLife + aperçu). expo-sqlite's web build is alpha and its synchronous API times
 * out on real workloads, so the browser uses sql.js — synchronous, in memory — and the database file
 * is saved to IndexedDB after writes (no 5 MB limit, unlike localStorage) and when the app goes to
 * the background. A database saved by the older localStorage driver is migrated once.
 */
import type { Database } from 'sql.js';
import { Asset } from 'expo-asset';
import initSqlJs from 'sql.js/dist/sql-wasm.js';
import sqlWasm from 'sql.js/dist/sql-wasm.wasm';

import type { Db, SqlValue } from './db';

const STORAGE_KEY = 'myperf.sqlite';
const IDB_NAME = 'myperf';
const IDB_STORE = 'files';
let sqlite: Database | null = null;

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key: string): Promise<Uint8Array | null> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result instanceof Uint8Array ? req.result : null);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key: string, value: Uint8Array): Promise<void> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export const NEEDS_PREPARE = true;

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

export async function prepareExpoDb(): Promise<void> {
  // Moteur SQLite en WebAssembly, servi comme fichier de l'app (mis en cache hors ligne).
  const wasmUrl = Asset.fromModule(sqlWasm).uri;
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  let bytes: Uint8Array | null = null;
  try {
    bytes = await idbGet(STORAGE_KEY);
  } catch {
    bytes = null;
  }
  if (bytes === null) {
    // Ancien stockage (localStorage) : repris une fois, effacé seulement une fois copié dans IndexedDB.
    let legacy: string | null = null;
    try {
      legacy = localStorage.getItem(STORAGE_KEY);
    } catch {
      legacy = null;
    }
    if (legacy !== null) {
      bytes = fromBase64(legacy);
      try {
        await idbPut(STORAGE_KEY, bytes);
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // IndexedDB indisponible : on garde l'ancienne copie.
      }
    }
  }
  sqlite = bytes === null ? new SQL.Database() : new SQL.Database(bytes);
  // L'app peut être fermée à tout moment (PWA mise en arrière-plan) : on sauvegarde à ce moment-là.
  const flush = () => {
    if (saveTimer !== null && sqlite) {
      clearTimeout(saveTimer);
      saveTimer = null;
      void save(sqlite);
    }
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('pagehide', flush);
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

async function save(db: Database): Promise<void> {
  try {
    await idbPut(STORAGE_KEY, db.export());
  } catch {
    // IndexedDB indisponible (navigation privée…) : dernier recours, l'ancien stockage.
    try {
      localStorage.setItem(STORAGE_KEY, toBase64(db.export()));
    } catch {
      // Stockage plein : l'app continue en mémoire.
    }
  }
}

/** Enregistre tout de suite ce qui attendait (avant un rechargement de la page : sinon, perdu). */
export async function flushExpoDb(): Promise<void> {
  if (saveTimer === null || !sqlite) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  await save(sqlite);
}

function scheduleSave(db: Database) {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void save(db);
  }, 300);
}

function rows<T>(db: Database, sql: string, params: readonly SqlValue[]): T[] {
  const stmt = db.prepare(sql);
  try {
    stmt.bind([...params]);
    const out: T[] = [];
    // Row shape is asserted by the caller's generic, exactly like expo-sqlite's getAllSync<T>.
    while (stmt.step()) out.push(stmt.getAsObject() as T);
    return out;
  } finally {
    stmt.free();
  }
}

export function openExpoDb(): Db {
  const db = sqlite;
  if (db === null) throw new Error('prepareExpoDb() must run first on web');
  db.exec('PRAGMA foreign_keys = ON;');
  let depth = 0;
  return {
    run: (sql, params = []) => {
      db.run(sql, [...params]);
      if (depth === 0) scheduleSave(db);
    },
    all: <T>(sql: string, params: readonly SqlValue[] = []) => rows<T>(db, sql, params),
    first: <T>(sql: string, params: readonly SqlValue[] = []) => rows<T>(db, sql, params)[0] ?? null,
    exec: (sql) => {
      db.exec(sql);
      scheduleSave(db);
    },
    transaction: (fn) => {
      db.exec('BEGIN');
      depth += 1;
      try {
        fn();
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      } finally {
        depth -= 1;
      }
      scheduleSave(db);
    },
  };
}
