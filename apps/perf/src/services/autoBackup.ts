import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { autoBackupName, backupsToPrune, isBackupDue } from '@/domain/backupPolicy';
import { buildBackup } from '@/db/backup';
import { getKv, setKv } from '@/db/repos/settings';

const LAST_KEY = 'auto_backup_last';

function folder(): Directory {
  const dir = new Directory(Paths.document, 'backups');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

export function lastAutoBackupAt(): number | null {
  const v = getKv(LAST_KEY);
  return v === null ? null : Number(v);
}

function writeBackup(now: Date): void {
  const dir = folder();
  const file = new File(dir, autoBackupName(now));
  file.create({ overwrite: true });
  file.write(JSON.stringify(buildBackup()));
  for (const name of backupsToPrune(dir.list().map((f) => f.name))) new File(dir, name).delete();
  setKv(LAST_KEY, String(now.getTime()));
}

/** Writes a full JSON backup in the app's documents if the last one is older than a day. Never throws. */
export function runAutoBackupIfDue(now = new Date()): boolean {
  try {
    if (!isBackupDue(lastAutoBackupAt(), now.getTime())) return false;
    writeBackup(now);
    return true;
  } catch {
    return false;
  }
}

/** Safety copy right before the data is replaced (program reload, restore). Never throws. */
export function backupBeforeReplace(now = new Date()): boolean {
  try {
    writeBackup(now);
    return true;
  } catch {
    return false;
  }
}

/** Shares the newest automatic backup (to save it off the phone). */
export async function shareLatestAutoBackup(): Promise<boolean> {
  const dir = folder();
  const names = dir
    .list()
    .map((f) => f.name)
    .filter((n) => n.startsWith('myperf-auto-'))
    .sort();
  const latest = names[names.length - 1];
  if (latest === undefined || !(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(new File(dir, latest).uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: 'Sauvegarde MyPerf' });
  return true;
}
