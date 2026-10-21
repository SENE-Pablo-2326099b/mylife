import { createTestDb } from '@/db/__tests__/testDb';
import { importPersonalData } from '@/import/importer';

import { nextSessionFor, templatePreview } from '../workoutService';

describe('templatePreview (Today)', () => {
  beforeEach(() => {
    createTestDb();
    importPersonalData();
  });

  it('gives the real top set load of a main lift in a work week', () => {
    // Cycle 1, week 1 (12 oct.): squat top set 1×5 @80 % of the reference.
    const squat = templatePreview('tpl_jeudi', '2026-10-15').find((l) => l.exerciseId === 'ex_squat');
    expect(squat?.main).toBe(true);
    expect(squat?.top?.reps).toBe(5);
    expect(squat?.top?.weight).toBeGreaterThan(60);
  });

  it('shows the deload volume for accessories, like the logging screen', () => {
    // Bloc 1 deload week (10 oct.): accessories keep half their sets.
    const lines = templatePreview('tpl_samedi', '2026-10-10');
    const accessory = lines.find((l) => !l.main);
    expect(accessory?.label).toBe('Deload · 2×8-10');
  });

  it('tells an accessory its next load and rep target; main lifts have none', () => {
    const next = nextSessionFor('ex_cable_lateral', '2026-10-13');
    expect(next).toMatchObject({ repMin: 12, repMax: 20 });
    expect(next?.weight).toBeGreaterThan(0);
    expect(nextSessionFor('ex_squat', '2026-10-13')).toBeNull();
  });
});
