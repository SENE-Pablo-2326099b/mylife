import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, computeEnvelope } from '../src/domain/defaults';
import { normalizeSettings } from '../src/domain/settingsModel';
import { ensureSeeded, getSettings } from '../src/db/seed';
import { BudgetDB } from '../src/db/db';

describe('réglages : personnalisation et migration', () => {
  it('nouvel utilisateur : rien de personnel, accueil à faire', () => {
    const s = normalizeSettings(undefined);
    expect(s).toEqual(DEFAULT_SETTINGS);
    expect(s.onboarded).toBe(false);
    expect(s.incomes).toEqual([]);
    expect(s.holderNames).toEqual([]);
  });

  it('réglages v1 (mono-utilisateur) → listes modifiables, sans perte', () => {
    const s = normalizeSettings({ id: 'main', payday: 26, salary: 153700, apl: 17000, activityBonus: 0, fixedCharges: 35900, investment: 45000, envelopeOverride: null, ownerName: 'PABLO SENE', bridgePassword: 'pw' });
    expect(s.incomes).toEqual([
      { id: 'income-salary', label: 'Salaire', amount: 153700, day: 26 },
      { id: 'income-apl', label: 'APL', amount: 17000, day: 5 },
    ]);
    expect(s.fixedCharges).toEqual([{ id: 'fixed-all', label: 'Charges fixes', amount: 35900, day: null }]);
    expect(s.savings).toEqual({ mode: 'manual', manual: 45000 });
    expect(s.holderNames).toEqual(['PABLO SENE']);
    expect(s.onboarded).toBe(true);
    expect(s.bridgePassword).toBe('pw');
    expect(computeEnvelope(s)).toBe(153700 + 17000 - 35900 - 45000);
    // Idempotent
    expect(normalizeSettings(s)).toEqual(s);
  });

  it('valeurs invalides ramenées dans les bornes', () => {
    const s = normalizeSettings({ payday: 45, theme: 'inconnu', incomes: [{ label: 'X', amount: -500, day: 40 }], bankCountry: 'france' });
    expect(s.payday).toBe(31);
    expect(s.theme).toBe('nuit');
    expect(s.incomes[0]).toMatchObject({ amount: 500, day: null });
    expect(s.bankCountry).toBe('FR');
  });

  it('une base v1 est migrée à l’ouverture', async () => {
    const database = new BudgetDB(`mig-${Date.now()}`);
    await database.settings.put({ id: 'main', payday: 26, salary: 153700, ownerName: 'X Y' } as never);
    await ensureSeeded(database);
    const s = await getSettings(database);
    expect(s.incomes[0]?.amount).toBe(153700);
    expect(s.holderNames).toEqual(['X Y']);
    expect('salary' in ((await database.settings.get('main')) as object)).toBe(false);
  });
});
