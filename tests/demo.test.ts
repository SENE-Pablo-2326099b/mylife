import { describe, expect, it } from 'vitest';
import { computeAlerts } from '../src/domain/alerts';
import { CAT } from '../src/domain/defaults';
import { clearDemo, generateDemo, loadDemo } from '../src/domain/demo';
import { getSettings } from '../src/db/seed';
import { freshDb } from './helpers';

describe('données de démo', () => {
  it('~6 semaines, déterministes, montants entiers', () => {
    const a = generateDemo({ payday: 26 }, '2026-10-17');
    const b = generateDemo({ payday: 26 }, '2026-10-17');
    expect(a).toEqual(b);
    const all = [...a.bnp, ...a.rev];
    expect(all.length).toBeGreaterThan(80);
    expect(all.every((t) => Number.isInteger(t.amount))).toBe(true);
    expect(all.every((t) => t.date >= '2026-09-06' && t.date <= '2026-10-17')).toBe(true);
  });

  it('se chargent, se classent et déclenchent des alertes', async () => {
    const database = await freshDb();
    const n = await loadDemo({ payday: 26 }, database, '2026-10-17');
    expect(await database.transactions.count()).toBe(n);
    const txs = await database.transactions.toArray();
    const classified = txs.filter((t) => t.categoryId !== null).length;
    expect(classified / n).toBeGreaterThan(0.85);
    expect(txs.some((t) => t.categoryId === null)).toBe(true); // quelques-unes à classer
    // Les transferts BNP ↔ Revolut sont appariés et exclus
    const transfers = txs.filter((t) => t.categoryId === CAT.transferts);
    expect(transfers.length).toBeGreaterThanOrEqual(4);
    expect(transfers.every((t) => t.transferPairId)).toBe(true);
    const cats = new Map((await database.categories.toArray()).map((c) => [c.id, c]));
    const alerts = computeAlerts({ txs, cats, settings: await getSettings(database), today: '2026-10-17' });
    expect(alerts.map((x) => x.id)).toContain('deliveries');
    expect(alerts.map((x) => x.id)).toContain('amazon');

    await clearDemo(database);
    expect(await database.transactions.count()).toBe(0);
    expect(await database.accounts.count()).toBe(0);
  });
});
