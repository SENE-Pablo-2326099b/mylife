import { describe, expect, it } from 'vitest';
import { markDone, objectiveLine, objectiveProgress, parseObjective, type Objective } from '../packages/lumen/src/objectifs';
import { addEntry, emptyMiniApp, MINI_TEMPLATES } from '../packages/lumen/src/miniapp';

/** MyObjectifs (V4, 3.1) : des objectifs mesurés par les apps, sans saisie. */
const at = 1;
const sessions = (weeks: Record<string, number>) => ({ perf: { v: 1 as const, at, weeks: Object.fromEntries(Object.entries(weeks).map(([w, n]) => [w, { sessions: n }])) } });
const obj = (over: Partial<Objective>): Objective => ({ v: 1, title: '40 séances', source: { type: 'counter', app: 'perf', key: 'sessions' }, target: 40, start: '2026-10-05', deadline: '2026-12-27', ...over });

describe('MyObjectifs : le moteur', () => {
  it('compte les semaines de la période, compare au rythme régulier : en avance, dans le rythme, en retard', () => {
    // Au 25 octobre : 21 jours écoulés sur 84 → le rythme attend 10 séances.
    const ctx = (n: number) => ({ stats: sessions({ '2026-09-28': 9, '2026-10-05': Math.ceil(n / 3), '2026-10-12': Math.floor(n / 3), '2026-10-19': n - Math.ceil(n / 3) - Math.floor(n / 3) }), miniApps: [], today: '2026-10-25' });
    expect(objectiveProgress(obj({}), ctx(14))).toMatchObject({ value: 14, expected: 10, status: 'ahead', milestones: [25] });
    expect(objectiveProgress(obj({}), ctx(10)).status).toBe('onTrack');
    expect(objectiveProgress(obj({}), ctx(6)).status).toBe('behind');
    expect(objectiveLine(objectiveProgress(obj({}), ctx(6)))).toBe('En retard : il en faudrait 10 aujourd’hui, tu en es à 6.');
    // La semaine d'avant le début ne compte pas.
    expect(objectiveProgress(obj({}), ctx(0)).value).toBe(0);
  });

  it('atteint (et le reste), date passée, app jamais ouverte', () => {
    const big = { stats: sessions({ '2026-10-05': 20, '2026-10-12': 20 }), miniApps: [], today: '2026-10-25' };
    const p = objectiveProgress(obj({}), big);
    expect(p).toMatchObject({ status: 'done', ratio: 1, milestones: [25, 50, 75, 100] });
    const done = markDone(obj({}), p, 99)!;
    expect(objectiveProgress(done, { ...big, stats: {} }).status).toBe('done');
    expect(objectiveProgress(obj({}), { stats: sessions({ '2026-10-05': 3 }), miniApps: [], today: '2027-01-05' }).status).toBe('missed');
    const none = objectiveProgress(obj({}), { stats: {}, miniApps: [], today: '2026-10-25' });
    expect([none.status, none.why]).toEqual(['unavailable', 'Ouvre MyPerf pour qu’il compte.']);
  });

  it('une app de « Mes apps » : nombre de saisies ou somme d’un champ, sur la période', () => {
    let app = emptyMiniApp('lect01', MINI_TEMPLATES[0]!);
    for (const [id, day, pages] of [['a', '2026-09-30', 50], ['b', '2026-10-06', 30], ['c', '2026-10-20', 45]] as const) app = addEntry(app, { id, day, values: { pages } });
    const ctx = { stats: {}, miniApps: [app], today: '2026-10-25' };
    expect(objectiveProgress(obj({ source: { type: 'miniapp', appId: 'lect01', agg: 'count' }, target: 10 }), ctx)).toMatchObject({ value: 2, unit: ['saisies', 'saisie'] });
    expect(objectiveProgress(obj({ source: { type: 'miniapp', appId: 'lect01', agg: 'sum', field: 'pages' }, target: 1000 }), ctx)).toMatchObject({ value: 75, unit: ['pages', 'pages'] });
    expect(objectiveProgress(obj({ source: { type: 'miniapp', appId: 'disparue', agg: 'count' } }), ctx).status).toBe('unavailable');
  });

  it('lecture prudente : source connue, cible positive, dates dans l’ordre', () => {
    expect(parseObjective(obj({}))).toEqual(obj({}));
    expect(parseObjective({ ...obj({}), source: { type: 'counter', app: 'finances', key: 'solde' } })).toBeNull();
    expect(parseObjective({ ...obj({}), target: -3 })).toBeNull();
    expect(parseObjective({ ...obj({}), deadline: '2026-01-01' })).toBeNull();
    expect(parseObjective({ ...obj({}), source: { type: 'miniapp', appId: 'lect01', agg: 'sum' } })).toBeNull();
    expect(parseObjective({ ...obj({}), source: { type: 'level' }, title: 'Niveau 10', target: 10 })?.source).toEqual({ type: 'level' });
  });
});
