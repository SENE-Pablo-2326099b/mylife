import { backupFileName, exportBackup } from './backup';
import { markBackedUp } from '../ui/backup';

/** Télécharge une copie complète des données (JSON) et note la date de cette sauvegarde (rappel hebdomadaire). */
export async function downloadBackup(): Promise<number> {
  const backup = await exportBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = backupFileName();
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  markBackedUp('finances');
  return backup.tables.transactions.length;
}
