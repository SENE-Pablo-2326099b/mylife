import Database from 'better-sqlite3';

import { setDb, type Db, type SqlValue } from '../db';
import { migrate } from '../migrations';

/** In-memory better-sqlite3 behind the same `Db` contract as expo-sqlite. */
export function createTestDb(): Db {
  const sqlite = new Database(':memory:');
  const raw: Db = {
    run: (sql, params = []) => {
      sqlite.prepare(sql).run(...params);
    },
    // Row shape is asserted by the caller's generic, exactly like expo-sqlite's getAllSync<T>.
    all: <T>(sql: string, params: readonly SqlValue[] = []) => sqlite.prepare(sql).all(...params) as T[],
    first: <T>(sql: string, params: readonly SqlValue[] = []) => (sqlite.prepare(sql).get(...params) as T | undefined) ?? null,
    exec: (sql) => {
      sqlite.exec(sql);
    },
    transaction: (fn) => {
      sqlite.transaction(fn)();
    },
  };
  const db = setDb(raw);
  migrate(db);
  return db;
}
