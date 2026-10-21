import type { VolumeSet } from '../analytics';
import { BODY_REGIONS, loadLevel, regionAt, regionLoads } from '../bodyMap';
import { MUSCLES } from '../types';

const set = (
  date: string,
  primary: VolumeSet['primaryMuscles'],
  secondary: VolumeSet['secondaryMuscles'] = [],
  setType: VolumeSet['setType'] = 'working',
  category: VolumeSet['category'] = 'compound',
): VolumeSet => ({
  date,
  setType,
  primaryMuscles: primary,
  secondaryMuscles: secondary,
  category,
});

describe('body map', () => {
  it('every muscle of the app belongs to exactly one region', () => {
    for (const m of MUSCLES) {
      expect(BODY_REGIONS.filter((r) => r.muscles.includes(m))).toHaveLength(1);
    }
  });

  it('finds the region under a tap, per view', () => {
    expect(regionAt('front', 'deltoids')?.id).toBe('shoulders');
    expect(regionAt('back', 'deltoids')?.id).toBe('rear_delts');
    expect(regionAt('back', 'upper-back')?.id).toBe('back');
    expect(regionAt('front', 'tibialis')?.id).toBe('calves');
    expect(regionAt('front', 'head')).toBeNull();
    expect(regionAt('front', undefined)).toBeNull();
  });

  it('averages hard sets per week, counts secondaries as ½, once per region', () => {
    const sets = [
      set('2026-10-06', ['lats'], ['biceps']),
      set('2026-10-06', ['lats', 'back']),
      set('2026-10-06', ['lats'], [], 'warmup'),
      set('2026-09-20', ['chest'], ['triceps']),
      set('2026-08-01', ['chest']),
    ];
    const loads = new Map(regionLoads(sets, '2026-10-08', 28, 4).map((l) => [l.region, l]));
    expect(loads.get('back')).toMatchObject({ perWeek: 0.5, lastDate: '2026-10-06' });
    expect(loads.get('back')?.weekly).toEqual([0, 0, 0, 2]);
    // Arms: compound sets are indirect, apart from the direct count.
    expect(loads.get('biceps')).toMatchObject({ perWeek: 0, indirectPerWeek: 0.1, indirectThisWeek: 0.5 });
    expect(loads.get('chest')).toMatchObject({ perWeek: 0.3, lastDate: '2026-09-20' });
    expect(loads.get('triceps')).toMatchObject({ weekly: [0, 0, 0, 0], indirectPerWeek: 0.1, indirectThisWeek: 0 });
    expect(loads.get('glutes')).toMatchObject({ perWeek: 0, lastDate: null });
  });

  it('arms: isolation sets are direct', () => {
    const loads = new Map(regionLoads([set('2026-10-06', ['biceps'], ['forearms'], 'working', 'isolation')], '2026-10-08', 28, 4).map((l) => [l.region, l]));
    expect(loads.get('biceps')).toMatchObject({ weekly: [0, 0, 0, 1], indirectPerWeek: 0 });
    expect(loads.get('forearms')?.weekly).toEqual([0, 0, 0, 0.5]);
  });

  it('colours by weekly sets', () => {
    expect([0, 2, 5, 9.9, 10, 20].map(loadLevel)).toEqual([0, 1, 2, 2, 3, 3]);
  });
});
