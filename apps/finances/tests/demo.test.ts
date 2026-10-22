import { describe, expect, it } from 'vitest';
import { computeAlerts } from '../src/domain/alerts';
import { CAT } from '../src/domain/defaults';
import { clearDemo, generateDemo, loadDemo } from '../src/domain/demo';
import { detectRecurring } from '../src/domain/recurring';
import { getSettings } from '../src/db/seed';
import { freshDb } from './helpers';

const TODAY = '2026-10-17';

describe('données de démo', () => {
  it('6 mois, déterministes, montants entiers', () => {
    const a = generateDemo(TODAY);
    const b = generateDemo(TODAY);
    expect(a).toEqual(b);
    const all = [...a.main, ...a.neo, ...a.livret];
    expect(all.length).toBeGreaterThan(300);
    expect(all.every((t) => Number.isInteger(t.amount))).toBe(true);
    expect(all.every((t) => t.date >= '2026-04-19' && t.date <= TODAY)).toBe(true);
  });

  it('se chargent, se classent, remplissent le patrimoine et déclenchent des alertes', async () => {
    const database = await freshDb();
    const n = await loadDemo(database, TODAY);
    expect(await database.transactions.count()).toBe(n);
    const txs = await database.transactions.toArray();
    const classified = txs.filter((t) => t.categoryId !== null).length;
    expect(classified / n).toBeGreaterThan(0.9);
    expect(txs.some((t) => t.categoryId === null)).toBe(true); // quelques-unes à classer
    // Les virements entre les comptes de Camille sont appariés et exclus
    const transfers = txs.filter((t) => t.categoryId === CAT.transferts);
    expect(transfers.length).toBeGreaterThanOrEqual(10);
    expect(transfers.every((t) => t.transferPairId)).toBe(true);

    const settings = await getSettings(database);
    expect(settings.incomes[0]?.amount).toBe(210000);
    expect(settings.holderNames).toContain('CAMILLE MARTIN');
    expect(settings.plannedSavingsAuto).toBeGreaterThan(25000); // PEA 150 € + bitcoin ~43 € + fonds d'urgence 100 €

    const cats = new Map((await database.categories.toArray()).map((c) => [c.id, c]));
    const alerts = computeAlerts({ txs, cats, settings, today: TODAY });
    expect(alerts.map((x) => x.id)).toContain('deliveries');
    expect(alerts.map((x) => x.id)).toContain('amazon');

    // Récurrences : salaire, loyer, abonnements, avec la hausse du forfait
    const rec = detectRecurring(txs, cats, TODAY);
    expect(rec.find((r) => r.label === 'ACME SAS')?.kind).toBe('income');
    expect(rec.find((r) => /foncia/i.test(r.label))?.subscription).toBe(false);
    expect(rec.find((r) => /netflix/i.test(r.label))?.subscription).toBe(true);
    expect(rec.find((r) => /free/i.test(r.label))?.priceChange).toEqual({ from: 1599, to: 1999 });

    expect(await database.portfolios.count()).toBe(2);
    expect(await database.goals.count()).toBe(3);
    expect(await database.snapshots.count()).toBeGreaterThan(150);
    const accounts = await database.accounts.toArray();
    expect(accounts.every((a) => (a.balance ?? 0) > 0)).toBe(true);

    await clearDemo(database);
    expect(await database.transactions.count()).toBe(0);
    expect(await database.accounts.count()).toBe(0);
    expect(await database.portfolios.count()).toBe(0);
    expect((await getSettings(database)).incomes).toHaveLength(0); // réglages d'avant la démo rétablis
  });
});
