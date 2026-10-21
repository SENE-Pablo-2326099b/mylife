import { autoBackupName, backupsToPrune, isBackupDue } from '../backupPolicy';

describe('auto backup policy', () => {
  it('is due after 24 h or when never done', () => {
    expect(isBackupDue(null, 0)).toBe(true);
    expect(isBackupDue(0, 23 * 3600e3)).toBe(false);
    expect(isBackupDue(0, 24 * 3600e3)).toBe(true);
  });
  it('names files so that they sort by time', () => {
    expect(autoBackupName(new Date(2026, 9, 7, 8, 5, 9))).toBe('myperf-auto-2026-10-07T08-05-09.json');
  });
  it('keeps the newest five and never touches other files', () => {
    const names = ['notes.txt', ...[1, 2, 3, 4, 5, 6, 7].map((d) => `myperf-auto-2026-10-0${d}T08-00-00.json`)];
    expect(backupsToPrune(names)).toEqual(['myperf-auto-2026-10-01T08-00-00.json', 'myperf-auto-2026-10-02T08-00-00.json']);
    expect(backupsToPrune(names.slice(0, 3))).toEqual([]);
  });
});
