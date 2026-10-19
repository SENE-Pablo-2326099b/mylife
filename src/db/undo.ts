import { db, type BudgetDB, type TableName } from './db';
import { undoable } from '../ui/toastStore';

export type RowsByTable = Partial<Record<TableName, unknown[]>>;

/** Remet des lignes telles qu'elles étaient (restauration après « Annuler »). */
export async function restoreRows(rows: RowsByTable, database: BudgetDB = db): Promise<void> {
  const names = Object.keys(rows) as TableName[];
  await database.transaction('rw', names.map((n) => database.table(n)), async () => {
    for (const n of names) {
      const list = rows[n];
      if (list?.length) await database.table(n).bulkPut(list);
    }
  });
}

/**
 * Suppression (ou modification) annulable : `capture` renvoie les lignes touchées dans leur état
 * actuel, `apply` fait le changement ; « Annuler » remet les lignes capturées.
 */
export async function changeWithUndo(message: string, capture: () => Promise<RowsByTable>, apply: () => Promise<unknown>, afterRestore?: () => Promise<unknown>): Promise<void> {
  const before = await capture();
  await undoable(message, apply, async () => {
    await restoreRows(before);
    await afterRestore?.();
  });
}
