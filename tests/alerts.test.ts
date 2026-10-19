import { describe, expect, it } from 'vitest';
import type { Settings, Transaction } from '../src/db/types';
import { computeAlerts } from '../src/domain/alerts';
import { CAT } from '../src/domain/defaults';
import { PROFILE, PROFILE_CATEGORIES } from './profile';
import { tx } from './helpers';

const cats = new Map(PROFILE_CATEGORIES.map((c) => [c.id, c]));
const settings: Settings = PROFILE;
const today = '2026-10-17';
let n = 0;
const t = (date: string, amount: number, categoryId: string | null, label = 'x'): Transaction => tx({ id: String(n++), date, amount, categoryId, label });
const ids = (txs: Transaction[], s = settings) => computeAlerts({ txs, cats, settings: s, today }).map((a) => `${a.id}:${a.level}`);

describe('alertes', () => {
  it('plus de 4 livraisons dans le cycle', () => {
    const four = [1, 2, 3, 4].map((d) => t(`2026-10-0${d}`, -2000, CAT.livraison, 'Deliveroo'));
    expect(ids(four)).toContain('deliveries:info');
    expect(ids([...four, t('2026-10-05', -1500, CAT.livraison, 'Uber Eats')])).toContain('deliveries:bad');
    // Hors cycle : ignorée
    expect(ids([...four, t('2026-09-20', -1500, CAT.livraison)])).not.toContain('deliveries:bad');
  });

  it('Amazon hors budget : objectif Shopping déjà dépassé', () => {
    const txs = [t('2026-10-01', -4500, CAT.shopping, 'Superdry'), t('2026-10-10', -1000, CAT.shopping, 'Amazon')];
    expect(ids(txs)).toContain('amazon:warn'); // 55 € > objectif 50 €
    expect(ids([t('2026-10-10', -1000, CAT.shopping, 'AMZN Mktp')])).not.toContain('amazon:warn');
  });

  it('Amazon sans objectif Shopping = toujours hors budget', () => {
    const custom = new Map(cats);
    custom.set(CAT.shopping, { ...cats.get(CAT.shopping)!, target: null });
    const a = computeAlerts({ txs: [t('2026-10-10', -1000, CAT.shopping, 'Amazon')], cats: custom, settings, today });
    expect(a.map((x) => x.id)).toContain('amazon');
  });

  it('budget du jour dépassé 3 jours de suite', () => {
    // budget ≈ 75 €/j à J19 : 3 jours à 100 € juste avant aujourd'hui
    const txs = ['2026-10-14', '2026-10-15', '2026-10-16'].map((d) => t(d, -10000, CAT.restos)); // ~75 €/j de budget
    const s = { ...settings };
    expect(ids(txs, s)).not.toContain('overrun:bad'); // aujourd'hui (0 €) interrompt la série
    expect(ids(txs, s)).toContain('overrun:warn');
    const withToday = [...txs, t(today, -9000, CAT.restos)];
    expect(ids(withToday, s)).toContain('overrun:bad');
  });

  it('tickets de bus au-dessus du pass annuel (12 mois glissants)', () => {
    const tickets = Array.from({ length: 70 }, (_, i) => t(`2026-0${1 + (i % 9)}-1${i % 9}`, -150, CAT.transport, 'Métropole Aix-Marseille-Provence'));
    expect(ids(tickets)).toContain('transport:warn'); // 105 €
    expect(ids(tickets.slice(0, 55))).toContain('transport:info'); // 82,50 €
    expect(ids([t('2025-01-01', -20000, CAT.transport, 'Metropole')])).not.toContain('transport:warn'); // trop ancien
  });

  it('catégorie au-dessus de son objectif', () => {
    expect(ids([t('2026-10-02', -16000, CAT.courses)])).toContain(`target-${CAT.courses}:bad`);
    expect(ids([t('2026-10-02', -12500, CAT.courses)])).toContain(`target-${CAT.courses}:warn`);
    expect(ids([t('2026-10-02', -5000, CAT.courses)])).not.toContain(`target-${CAT.courses}:warn`);
  });

  it('désactivation', () => {
    const off: Settings = { ...settings, alerts: { ...settings.alerts, categoryTarget: { enabled: false, warnPercent: 80 } } };
    expect(ids([t('2026-10-02', -16000, CAT.courses)], off)).toHaveLength(0);
  });

  it('tri par gravité', () => {
    const a = computeAlerts({ txs: [t('2026-10-02', -12500, CAT.courses), t('2026-10-02', -16000, CAT.sorties)], cats, settings, today });
    expect(a[0].level).toBe('bad');
  });
});
