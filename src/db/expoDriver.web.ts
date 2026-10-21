/**
 * Browser PREVIEW driver (the app targets iOS/Android). expo-sqlite's web build is alpha and its
 * synchronous API times out on real workloads, so the browser uses sql.js — synchronous, in memory,
 * snapshotted to localStorage after writes so a reload keeps the data.
 */
import type { Database } from 'sql.js';
import initSqlJs from 'sql.js/dist/sql-asm.js';

import type { Db, SqlValue } from './db';

const STORAGE_KEY = 'myperf.sqlite';
let sqlite: Database | null = null;

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
  const SQL = await initSqlJs();
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch {
    saved = null;
  }
  sqlite = saved === null ? new SQL.Database() : new SQL.Database(fromBase64(saved));
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(db: Database) {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, toBase64(db.export()));
    } catch {
      // Storage full or unavailable: the preview keeps working in memory.
    }
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
