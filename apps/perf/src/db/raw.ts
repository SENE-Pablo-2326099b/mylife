import { db, type SqlValue } from './db';

/** A row as stored, every column: what an undo puts back. */
export type RawRow = Record<string, SqlValue>;

export function selectRaw(table: string, where: string, params: readonly SqlValue[]): RawRow[] {
  return db().all<RawRow>(`SELECT * FROM ${table} WHERE ${where}`, params);
}

export function insertRaw(table: string, row: RawRow): void {
  const cols = Object.keys(row);
  db().run(`INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map((c) => row[c] ?? null));
}
