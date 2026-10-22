import { db, TABLE_NAMES, type BudgetDB, type TableName } from '../db/db';
import { ensureSeeded } from '../db/seed';
import type { Settings } from '../db/types';

export const BACKUP_FORMAT = 'myfinances-backup';
/** Format des sauvegardes d'avant le nom MyFinances : toujours lisibles. */
const LEGACY_BACKUP_FORMAT = 'budget-dodge-backup';
/** v2 : patrimoine, objectifs, récurrences. Les sauvegardes v1 restent lisibles (réglages migrés à l'import). */
export const BACKUP_VERSION = 2;

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  tables: Record<TableName, unknown[]>;
}

/** Exporte toute la base. Le mot de passe du relais n'est jamais inclus. */
export async function exportBackup(database: BudgetDB = db): Promise<Backup> {
  const tables = {} as Record<TableName, unknown[]>;
  await database.transaction('r', TABLE_NAMES.map((n) => database.table(n)), async () => {
    for (const name of TABLE_NAMES) tables[name] = await database.table(name).toArray();
  });
  tables.settings = (tables.settings as Settings[]).map((s) => ({ ...s, bridgePassword: '' }));
  tables.meta = (tables.meta as { key: string }[]).filter((m) => m.key !== 'pendingAuth');
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), tables };
}

export class BackupError extends Error {}

export function validateBackup(data: unknown): Backup {
  if (!data || typeof data !== 'object') throw new BackupError('Fichier illisible : ce n’est pas un objet JSON.');
  const b = { ...(data as Partial<Backup>) };
  if ((b.format as string) === LEGACY_BACKUP_FORMAT) b.format = BACKUP_FORMAT;
  if (b.format !== BACKUP_FORMAT) throw new BackupError('Ce fichier n’est pas une sauvegarde MyFinances.');
  if (typeof b.version !== 'number' || b.version > BACKUP_VERSION) throw new BackupError('Sauvegarde créée par une version plus récente de l’app.');
  if (!b.tables || typeof b.tables !== 'object') throw new BackupError('Sauvegarde incomplète.');
  for (const name of TABLE_NAMES) {
    const t = (b.tables as Record<string, unknown>)[name];
    if (t !== undefined && !Array.isArray(t)) throw new BackupError(`Table « ${name} » invalide.`);
  }
  const txs = (b.tables.transactions ?? []) as Record<string, unknown>[];
  for (const t of txs) {
    if (typeof t.id !== 'string' || typeof t.date !== 'string' || !Number.isInteger(t.amount)) {
      throw new BackupError('Opération invalide dans la sauvegarde (montants attendus en centimes entiers).');
    }
  }
  return b as Backup;
}

/** Remplace toute la base par la sauvegarde (le mot de passe du relais de cet appareil est conservé). */
export async function importBackup(data: unknown, database: BudgetDB = db): Promise<{ transactions: number }> {
  const backup = validateBackup(data);
  const password = (await database.settings.get('main'))?.bridgePassword ?? '';
  await database.transaction('rw', TABLE_NAMES.map((n) => database.table(n)), async () => {
    for (const name of TABLE_NAMES) {
      await database.table(name).clear();
      const rows = backup.tables[name] ?? [];
      if (rows.length) await database.table(name).bulkPut(rows);
    }
    const s = await database.settings.get('main');
    if (s) await database.settings.put({ ...s, bridgePassword: password });
  });
  await ensureSeeded(database);
  return { transactions: backup.tables.transactions?.length ?? 0 };
}

/** Efface toutes les données locales puis réinitialise les valeurs par défaut. */
export async function wipeAll(database: BudgetDB = db): Promise<void> {
  await database.transaction('rw', TABLE_NAMES.map((n) => database.table(n)), async () => {
    for (const name of TABLE_NAMES) await database.table(name).clear();
  });
  await ensureSeeded(database);
}

export function backupFileName(now = new Date()): string {
  const d = now.toISOString().slice(0, 10);
  return `myfinances-${d}.json`;
}
