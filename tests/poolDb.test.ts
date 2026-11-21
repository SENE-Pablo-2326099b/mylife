import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { poolDb } from '../server/http';

/** Un faux pool : chaque connexion note ce qu'elle exécute ; on vérifie qu'une transaction tient sur une seule. */
function fakePool() {
  const log: string[] = [];
  let conns = 0;
  let released = 0;
  let destroyed = 0;
  const pool = {
    query: async (text: string) => {
      log.push(`pool: ${text}`);
      return { rows: [] };
    },
    connect: async () => {
      const id = ++conns;
      return {
        query: async (text: string) => {
          log.push(`c${id}: ${text}`);
          if (text.startsWith('FAIL') || (text === 'ROLLBACK' && log.some((l) => l.endsWith('FAIL HARD')))) throw new Error('panne');
          return { rows: [] };
        },
        release: (destroy?: boolean) => void (destroy ? destroyed++ : released++),
      };
    },
  };
  return { pool: pool as unknown as pg.Pool, log, stats: () => ({ conns, released, destroyed }) };
}

describe('base sur un pool Postgres (production)', () => {
  it('une transaction passe par une seule connexion : BEGIN, les requêtes, COMMIT, puis la connexion est rendue', async () => {
    const { pool, log, stats } = fakePool();
    const db = poolDb(pool);
    await db.transaction(async (tx) => {
      await tx.query('DELETE A');
      await tx.query('DELETE B');
    });
    expect(log).toEqual(['c1: BEGIN', 'c1: DELETE A', 'c1: DELETE B', 'c1: COMMIT']);
    expect(stats()).toEqual({ conns: 1, released: 1, destroyed: 0 });
  });

  it('une étape qui échoue : ROLLBACK, l’erreur remonte, la connexion est rendue ; pas de transaction imbriquée', async () => {
    const { pool, log, stats } = fakePool();
    const db = poolDb(pool);
    await expect(
      db.transaction(async (tx) => {
        await tx.query('DELETE A');
        await tx.query('FAIL B');
      }),
    ).rejects.toThrow('panne');
    expect(log).toEqual(['c1: BEGIN', 'c1: DELETE A', 'c1: FAIL B', 'c1: ROLLBACK']);
    expect(stats()).toEqual({ conns: 1, released: 1, destroyed: 0 });
    await expect(db.transaction((tx) => tx.transaction(async () => 1))).rejects.toThrow('Transaction déjà ouverte.');
    expect(stats().released).toBe(2);
  });

  it('si l’annulation échoue aussi, la connexion est fermée au lieu de retourner au pool', async () => {
    const { pool, stats } = fakePool();
    await expect(poolDb(pool).transaction((tx) => tx.query('FAIL HARD'))).rejects.toThrow('panne');
    expect(stats()).toEqual({ conns: 1, released: 0, destroyed: 1 });
  });
});
