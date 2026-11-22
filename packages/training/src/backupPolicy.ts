/** Automatic backups: one a day at most, the newest `keep` files kept. */
export const AUTO_BACKUP_KEEP = 5;
export const AUTO_BACKUP_EVERY_MS = 24 * 60 * 60 * 1000;
const NAME = /^myperf-auto-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})\.json$/;

export function isBackupDue(lastAt: number | null, now: number): boolean {
  return lastAt === null || now - lastAt >= AUTO_BACKUP_EVERY_MS;
}

/** File name sortable by time: myperf-auto-2026-10-07T18-30-00.json */
export function autoBackupName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `myperf-auto-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}T${p(now.getHours())}-${p(now.getMinutes())}-${p(now.getSeconds())}.json`;
}

/** Backup files to delete (oldest first) so that only the newest `keep` remain. Foreign files are ignored. */
export function backupsToPrune(names: readonly string[], keep = AUTO_BACKUP_KEEP): string[] {
  const ours = names.filter((n) => NAME.test(n)).sort();
  return ours.slice(0, Math.max(0, ours.length - keep));
}
