import { openDatabaseSync } from 'expo-sqlite';

import type { Db } from './db';

const DB_NAME = 'myperf.db';

/** Native needs no async preparation; see expoDriver.web.ts for the browser preview. */
export const NEEDS_PREPARE = false;
export async function prepareExpoDb(): Promise<void> {}

export function openExpoDb(name = DB_NAME): Db {
  const sqlite = openDatabaseSync(name);
  // WAL: durable, fast single-row writes; NORMAL sync is crash-safe in WAL mode.
  sqlite.execSync('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');
  return {
    run: (sql, params = []) => {
      sqlite.runSync(sql, [...params]);
    },
    all: <T>(sql: string, params: readonly (string | number | null)[] = []) => sqlite.getAllSync<T>(sql, [...params]),
    first: <T>(sql: string, params: readonly (string | number | null)[] = []) => sqlite.getFirstSync<T>(sql, [...params]),
    exec: (sql) => sqlite.execSync(sql),
    transaction: (fn) => sqlite.withTransactionSync(fn),
  };
}
