import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
/**
 * Les cycles complets à l'import et à l'export (23/11) : macrocycle → blocs → semaines en groupes de séries libres →
 * exceptions par exercice ; un fichier de cycles seuls ne touche pas aux séances ; réimporter ce qu'on a exporté met à
 * jour (mêmes identifiants), sans rien dupliquer.
 */
import { createTestDb } from '@/db/__tests__/testDb';
import { addBodyEntry } from '@/db/repos/body';
import { saveMesocycle } from '@/db/repos/cycles';
import { getExercise } from '@/db/repos/exercises';
import { saveOneRm } from '@/db/repos/oneRm';
import { addPatternEntry, addTemplateExercise, createTemplate } from '@/db/repos/templates';
import { listSetsForWorkout, updateSet } from '@/db/repos/workouts';
import { seedIfEmpty } from '@/db/seed';
import { sqliteStore } from '@/services/cloud/sqliteStore';
import { finishWorkout, startWorkout } from '@/services/workoutService';
import { DEFAULT_DELOAD } from '../packages/training/src/mesocycle';
import { schemeForKind } from '../packages/training/src/mesoTypes';
import type { StrengthWeek } from '../packages/training/src/types';
import { createBackend, type Backend } from '../app/src/modules/perf/data/backend';
import { wrapOo1, type Db, type Oo1Db } from '../app/src/modules/perf/data/sql';

let rows: { tbl: string; rid: string; row: unknown }[] = [];
let sqlite3: Awaited<ReturnType<typeof sqlite3InitModule>>;
// Lundi 19 janvier 2026 : « Force A » est prévue le lundi, « Volume » le jeudi.
const MONDAY = '2026-01-19';

beforeAll(async () => {
  sqlite3 = await sqlite3InitModule();
  createTestDb();
  seedIfEmpty();
  addBodyEntry('bodyweight', '2026-01-01', 80);
  const force = createTemplate('Force A');
  for (const id of ['ex_squat', 'ex_weighted_pullup']) addTemplateExercise(force, getExercise(id)!);
  const volume = createTemplate('Volume');
  addTemplateExercise(volume, getExercise('ex_barbell_curl')!);
  addPatternEntry(0, force);
  addPatternEntry(3, volume);
  saveOneRm({ exerciseId: 'ex_squat', value: 160, mode: 'manual', setOn: '2026-01-01' });
  saveOneRm({ exerciseId: 'ex_weighted_pullup', value: 50.8, mode: 'manual', setOn: '2026-01-01' });
  saveMesocycle({ name: 'Accumulation', kind: 'accumulation', macrocycleId: null, startDate: '2026-01-05', workWeeks: 4, deloadWeeks: 1, scheme: schemeForKind('accumulation', 4) as StrengthWeek[], deload: DEFAULT_DELOAD, notes: '' });
  // Une séance faite il y a une semaine, puis une autre le jeudi 15, avec un record au curl (plus lourd qu'avant).
  for (const [date, template, w] of [['2026-01-12', force, 0], ['2026-01-13', volume, 30], ['2026-01-15', volume, 35]] as const) {
    const id = startWorkout({ date, templateId: template });
    for (const s of listSetsForWorkout(id)) updateSet({ ...s, weight: w > 0 ? w : (s.targetWeight ?? 0), reps: s.targetReps ?? 10, completed: true, completedAt: 1 });
    finishWorkout(id);
  }
  rows = await sqliteStore().snapshot();
});

let b: Backend;
let d: Db;
beforeEach(() => {
  d = wrapOo1(new sqlite3.oo1.DB(':memory:') as unknown as Oo1Db);
  b = createBackend(d);
  b.apply(rows.map((r) => ({ ...r, deleted: false })));
});



const FILE = {
  name: 'Force 2026',
  macrocycles: [
    {
      name: 'Saison 2026',
      blocks: [
        {
          name: 'Cycle A',
          type: 'accumulation',
          start: '2026-02-09',
          weeks: [
            ['top 1x4 @80%', 'backoff 3x6 @70%', '2x3 @75% pause 2 s'],
            ['top 1x4 @83%', 'backoff EMOM 5x2 @72%'],
          ],
          deload: { weeks: 1, sets: ['3x3 @60%'], accessories: { load: 0.6, volume: 0.5 } },
          lifts: { Squat: [{ week: 2, sets: ['top 1x2 @90%', 'backoff 3x3 @80%'] }], 'Lancer de marteau': [{ week: 1, sets: ['3x3'] }] },
        },
        { name: 'Cycle B', type: 'transmutation', weeks: [['5x3 @85%']], deloadWeeks: 0 },
      ],
    },
  ],
};
const label = (date: string) => b.dayView(date).today[0]!.lines.map((l) => `${l.name} · ${l.detail} · ${l.load}`);

describe('cycles complets : import, prescription, export, réimport', () => {
  it('cycles seuls : séances intactes ; semaines en groupes, décharge, exception par exercice ; lift inconnu signalé', () => {
    const templates = b.templatesView().length;
    const text = JSON.stringify(FILE);
    const p = b.importPreview(text);
    expect(p.ok).toBe(true);
    expect(p.summary.sessions).toBe(0);
    expect(p.blocks.map((x) => [x.macro, x.name, x.weeks, x.update])).toEqual([['Saison 2026', 'Cycle A', 2, false], ['Saison 2026', 'Cycle B', 1, false]]);
    expect(p.blocks[0]!.plan).toEqual(['Top 1×4 @ 80 % + Backoffs 3×6 @ 70 % + 2×3 @ 75 % · pause 2 s', 'Top 1×4 @ 83 % + Backoffs EMOM 5×2 @ 72 %']);
    expect(p.blocks[0]!.lifts.map((l) => [l.name, l.week])).toEqual([['Squat', 2]]);
    expect(p.issues.some((i) => /Lancer de marteau/.test(i))).toBe(true);
    b.applyImport(text, { mode: 'replace', days: true, oneRms: true, blocks: true }, MONDAY);
    expect(b.templatesView()).toHaveLength(templates);
    // S1 du cycle A (lundi 9 février) : les trois groupes, dans l'ordre, au % du 1RM de 160 kg.
    expect(label('2026-02-09')[0]).toBe('Squat · Top 1×4 @ 80 % + Backoffs 3×6 @ 70 % + 2×3 @ 75 % · pause 2 s · 127,5 kg');
    // S2 : l'exception du squat prime ; les tractions lestées suivent la semaine.
    expect(label('2026-02-16')[0]).toBe('Squat · Top 1×2 @ 90 % + Backoffs 3×3 @ 80 % · 145 kg');
    expect(label('2026-02-16')[1]).toMatch(/Top 1×4 @ 83 % \+ Backoffs EMOM 5×2 @ 72 %/);
    // La décharge : ses groupes.
    expect(label('2026-02-23')[0]).toMatch(/^Squat · Décharge · 3×3 @ 60 %/);
    expect(d.first<{ n: number }>("SELECT COUNT(*) AS n FROM macrocycles WHERE name = 'Saison 2026'")!.n).toBe(1);
  });

  it('exporter, retoucher, réimporter : mêmes blocs mis à jour, rien de dupliqué', () => {
    b.applyImport(JSON.stringify(FILE), { mode: 'replace', days: true, oneRms: true, blocks: true }, MONDAY);
    const blocks = () => d.all<{ id: string; name: string }>('SELECT id, name FROM mesocycles ORDER BY start_date');
    const before = blocks();
    const file = JSON.parse(b.exportProgram() as unknown as string) as { macrocycles: { name: string; blocks: { id: string; name: string; weeks: string[][]; lifts?: Record<string, { week: number; sets: string[] }[]> }[] }[]; blocks?: unknown[] };
    expect(file.macrocycles).toHaveLength(1);
    const a = file.macrocycles[0]!.blocks.find((x) => x.name === 'Cycle A')!;
    expect(a.weeks[0]).toEqual(['top 1x4 @80%', 'backoff 3x6 @70%', '2x3 @75% pause 2 s']);
    expect(a.lifts!.Squat).toEqual([{ week: 2, sets: ['top 1x2 @90%', 'backoff 3x3 @80%'] }]);
    // Le bloc passé (Accumulation, sans macrocycle) est exporté aussi, à part.
    expect(file.blocks).toHaveLength(1);
    a.weeks[0]![0] = 'top 1x3 @82.5%';
    const p = b.importPreview(JSON.stringify(file));
    expect(p.blocks.filter((x) => x.update)).toHaveLength(3);
    b.applyImport(JSON.stringify(file), { mode: 'replace', days: true, oneRms: true, blocks: true }, MONDAY);
    expect(blocks()).toEqual(before);
    expect(d.first<{ n: number }>('SELECT COUNT(*) AS n FROM macrocycles')!.n).toBe(1);
    expect(d.first<{ n: number }>('SELECT COUNT(*) AS n FROM cycle_week_overrides')!.n).toBe(1);
    expect(label('2026-02-09')[0]).toMatch(/^Squat · Top 1×3 @ 82,5 %/);
    // Des séances types toujours là, une seule fois chacune.
    const names = b.templatesView().map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
