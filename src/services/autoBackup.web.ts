/** Web preview: no file system — backups go through Réglages → Exporter. */
export function lastAutoBackupAt(): number | null {
  return null;
}

export function runAutoBackupIfDue(): boolean {
  return false;
}

export async function shareLatestAutoBackup(): Promise<boolean> {
  return false;
}

export function backupBeforeReplace(): boolean {
  return false;
}
