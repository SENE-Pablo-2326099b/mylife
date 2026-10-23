import Dexie, { type EntityTable } from 'dexie';
import { db, type BudgetDB } from '../db/db';
import { exportBackup, importBackup, type Backup } from './backup';

/**
 * Points de restauration : une copie complète de la base, prise automatiquement juste avant chaque geste
 * qui remplace ou efface des données (restauration d'une sauvegarde, « Tout effacer », suppression de la
 * démo, données du compte reprises à la place de celles de l'appareil, retour à un autre point).
 *
 * Gardés dans une base à part de cet appareil : jamais synchronisés, jamais dans une sauvegarde, effacés
 * quand un autre compte se connecte. Les 5 plus récents seulement.
 */

export interface RestorePoint {
  id?: number;
  at: number;
  /** Ce qui allait se passer (« Avant une restauration de sauvegarde »). */
  reason: string;
  transactions: number;
  backup: Backup;
}

export class RestoreDB extends Dexie {
  points!: EntityTable<RestorePoint, 'id'>;
  constructor(name = 'myfinances-restore') {
    super(name);
    this.version(1).stores({ points: '++id, at' });
  }
}

export const restoreDb = new RestoreDB();
export const MAX_RESTORE_POINTS = 5;

/** Copie la base telle qu'elle est (rien si elle n'a ni opération ni placement : il n'y a rien à perdre). */
export async function createRestorePoint(reason: string, database: BudgetDB = db, store: RestoreDB = restoreDb, now = Date.now()): Promise<number | null> {
  const [txs, portfolios] = await Promise.all([database.transactions.count(), database.portfolios.count()]);
  if (txs === 0 && portfolios === 0) return null;
  const backup = await exportBackup(database);
  const id = await store.points.add({ at: now, reason, transactions: txs, backup });
  const old = await store.points.orderBy('at').reverse().offset(MAX_RESTORE_POINTS).primaryKeys();
  if (old.length) await store.points.bulkDelete(old);
  return id ?? null;
}

/** Les points, du plus récent au plus ancien (sans leur contenu). */
export async function listRestorePoints(store: RestoreDB = restoreDb): Promise<Omit<RestorePoint, 'backup'>[]> {
  const all = await store.points.orderBy('at').reverse().toArray();
  return all.map(({ backup: _backup, ...p }) => p);
}

/** Revient à un point (après en avoir pris un de l'état actuel : ce retour s'annule de la même façon). */
export async function restoreFromPoint(id: number, database: BudgetDB = db, store: RestoreDB = restoreDb): Promise<{ transactions: number }> {
  const point = await store.points.get(id);
  if (!point) throw new Error('Ce point de restauration n’existe plus.');
  await createRestorePoint('Avant de revenir à un point de restauration', database, store);
  return importBackup(point.backup, database);
}

export async function deleteRestorePoint(id: number, store: RestoreDB = restoreDb): Promise<void> {
  await store.points.delete(id);
}

export async function clearRestorePoints(store: RestoreDB = restoreDb): Promise<void> {
  await store.points.clear();
}
