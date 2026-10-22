import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { BudgetDB, migrateLegacyDatabase } from '../src/db/db';
import { validateBackup } from '../src/domain/backup';

describe('nom de la base locale', () => {
  it('la base d’avant le nom MyFinances est reprise une fois, puis supprimée', async () => {
    const legacy = new BudgetDB('ancienne-base');
    await legacy.transactions.put({ id: 't1', accountId: 'a', date: '2026-01-02', amount: -1250, label: 'Boulangerie' } as never);
    await legacy.settings.put({ id: 'main', onboarded: true } as never);
    legacy.close();
    expect(await migrateLegacyDatabase('base-actuelle', 'ancienne-base')).toBe(true);
    expect(await Dexie.exists('ancienne-base')).toBe(false);
    const current = new BudgetDB('base-actuelle');
    expect((await current.transactions.get('t1'))?.amount).toBe(-1250);
    expect((await current.settings.get('main'))?.onboarded).toBe(true);
    current.close();
    // Déjà faite : plus rien à reprendre.
    expect(await migrateLegacyDatabase('base-actuelle', 'ancienne-base')).toBe(false);
  });
  it('les sauvegardes d’avant restent lisibles, au nouveau format', () => {
    const b = validateBackup({ format: 'budget-dodge-backup', version: 1, exportedAt: '', tables: {} });
    expect(b.format).toBe('myfinances-backup');
  });
});
