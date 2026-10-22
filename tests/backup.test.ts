import { describe, expect, it } from 'vitest';
import { BACKUP_EVERY_MS, backupDue } from '../packages/ui/src/backup';

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;

describe('rappel de sauvegarde hebdomadaire', () => {
  it('jamais sauvegardé : dû', () => expect(backupDue(null, null, NOW)).toBe(true));
  it('sauvegardé il y a moins de 7 jours : pas dû', () => expect(backupDue(NOW - 6 * DAY, null, NOW)).toBe(false));
  it('exactement 7 jours : dû', () => expect(backupDue(NOW - BACKUP_EVERY_MS, null, NOW)).toBe(true));
  it('« Plus tard » repousse d’un jour, puis le rappel revient', () => {
    expect(backupDue(NOW - 10 * DAY, NOW - 3_600_000, NOW)).toBe(false);
    expect(backupDue(NOW - 10 * DAY, NOW - DAY - 1, NOW)).toBe(true);
  });
});
