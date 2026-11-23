import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
/**
 * MyPerf, importer et partager un programme (maquette V3-Import) : aperçu avant toute écriture, application d'un coup
 * (séances types, EMOM, AMRAP, au temps, supersets, progressions, semaine type, 1RM, blocs), remplacer sans rien
 * effacer, et l'aller-retour d'un programme partagé vers un autre compte.
 */
import { createTestDb } from '@/db/__tests__/testDb';
import { addBodyEntry } from '@/db/repos/body';
import { getExercise } from '@/db/repos/exercises';
import { saveOneRm } from '@/db/repos/oneRm';
import { addPatternEntry, addTemplateExercise, createTemplate } from '@/db/repos/templates';
import { seedIfEmpty } from '@/db/seed';
import { sqliteStore } from '@/services/cloud/sqliteStore';
import { createBackend, type Backend } from '../app/src/modules/perf/data/backend';
import { wrapOo1, type Db, type Oo1Db } from '../app/src/modules/perf/data/sql';

let rows: { tbl: string; rid: string; row: unknown }[] = [];
let sqlite3: Awaited<ReturnType<typeof sqlite3InitModule>>;
const MONDAY = '2026-01-19';
const ALL = { mode: 'add', days: true, oneRms: true, blocks: true } as const;

beforeAll(async () => {
  sqlite3 = await sqlite3InitModule();
  createTestDb();
  seedIfEmpty();
  addBodyEntry('bodyweight', '2026-01-01', 80);
  const old = createTemplate('Ancienne');
  addTemplateExercise(old, getExercise('ex_squat')!);
  addPatternEntry(0, old);
  saveOneRm({ exerciseId: 'ex_squat', value: 160, mode: 'manual', setOn: '2026-01-01' });
  rows = await sqliteStore().snapshot();
});

let d: Db;
let b: Backend;
const fresh = (keep = true) => {
  d = wrapOo1(new sqlite3.oo1.DB(':memory:') as unknown as Oo1Db);
  b = createBackend(d);
  if (keep) b.apply(rows.map((r) => ({ ...r, deleted: false })));
};
beforeEach(() => fresh());
const templateId = (name: string) => d.first<{ id: string }>('SELECT id FROM templates WHERE name = ? AND archived = 0', [name])?.id ?? null;

const TEXT = `Mardi – Haut
A1. Dips 3x8
A2. Pompes déclinées 3x15
Tractions EMOM 10 min 5 reps
Gainage 3x45s
Développé couché 4x6 @75% repos 3min`;

describe('Importer : aperçu', () => {
  it('lu sur l’appareil, rien n’est écrit : séances, détail de chaque exercice, nouveaux, supersets', () => {
    const p = b.importPreview(TEXT);
    expect(p).toMatchObject({ ok: true, source: 'text', summary: { sessions: 1, exercises: 5 } });
    const ex = p.sessions[0]!.exercises;
    expect(p.sessions[0]).toMatchObject({ name: 'Mardi – Haut', days: 'mar' });
    expect(ex.find((e) => e.detail.startsWith('EMOM'))!.detail).toBe('EMOM 10 min · 5 / min');
    expect(ex.find((e) => e.detail === '3 × 45 s')).toBeDefined();
    expect(ex.filter((e) => e.group === 'A')).toHaveLength(2);
    expect(ex.some((e) => e.isNew)).toBe(true);
    expect(templateId('Mardi – Haut')).toBeNull();
    expect(b.importPreview('bonjour')).toMatchObject({ ok: false });
    expect(b.importPreview('bonjour').issues.length).toBeGreaterThan(0);
  });
});

describe('Importer : appliquer', () => {
  it('séance type avec formats, superset, progression au %, repos ; jours ; la séance démarrée suit (10 minutes d’EMOM)', () => {
    const r = b.applyImport(TEXT, ALL, MONDAY);
    expect(r).toMatchObject({ templates: 1, days: 1 });
    const id = templateId('Mardi – Haut')!;
    const t = b.templateDetail(id, MONDAY)!;
    expect(t.days).toEqual([1]);
    const slot = (re: RegExp) => b.slotDetail(t.slots.find((s) => re.test(s.name))!.id, MONDAY)!;
    expect(slot(/Dips/)).toMatchObject({ group: { kind: 'superset', rounds: 3, withNext: true } });
    expect(slot(/Tractions/)).toMatchObject({ format: { base: 'emom', everySec: 60, totalSec: 600 }, strategy: { id: 'linear' } });
    expect(slot(/Gainage/)).toMatchObject({ format: { base: 'hold', workSec: 45 }, strategy: { id: 'free', params: { sets: 3 } } });
    expect(slot(/couché/)).toMatchObject({ strategy: { id: 'percent_reference' }, restSec: 180 });
    const doc = b.sessionDoc(b.startSession(id, '2026-01-20'))!;
    expect(doc.items.find((i) => /Tractions/.test(i.name))!.sets).toHaveLength(10);
    expect(doc.items[0]!.group?.id).toBe(doc.items[1]!.group?.id);
  });

  it('JSON : 1RM (sans écraser celui déjà saisi), nouvel exercice créé, blocs enchaînés', () => {
    const json = JSON.stringify({
      format: 'myperf-program',
      version: 1,
      name: 'Force',
      sessions: [{ name: 'Force A', days: ['lundi', 'jeudi'], exercises: [{ name: 'Squat', sets: 5, reps: '3', progression: 'percent' }, { name: 'Muscle-up', sets: 4, reps: '3', bodyweight: true, progression: 'percent' }] }],
      oneRepMaxes: [{ exercise: 'Squat', kg: 999 }, { exercise: 'Muscle-up', kg: 15 }],
      blocks: [{ name: 'Accu', type: 'accumulation', weeks: 4, deloadWeeks: 1, start: '2026-01-05' }, { name: 'Réal', type: 'realization', weeks: 3, deloadWeeks: 0 }],
    });
    const r = b.applyImport(json, ALL, MONDAY);
    expect(r).toMatchObject({ templates: 1, created: 1, days: 2, oneRms: 1, blocks: 2 });
    expect(d.first('SELECT value FROM exercise_one_rm WHERE exercise_id = ?', ['ex_squat'])).toEqual({ value: 160 });
    const mu = d.first<{ id: string; load_type: string }>("SELECT id, load_type FROM exercises WHERE name = 'Muscle-up'")!;
    expect(mu.load_type).toBe('bodyweight');
    expect(d.first('SELECT value FROM exercise_one_rm WHERE exercise_id = ?', [mu.id])).toEqual({ value: 15 });
    expect(b.programView(MONDAY).blocks.map((x) => [x.name, x.dates])).toEqual([['Accu', '5 janv. → 8 févr.'], ['Réal', '9 févr. → 1 mars']]);
  });

  it('remplacer : les séances types actuelles sont archivées (pas effacées), la semaine type repart', () => {
    const old = templateId('Ancienne')!;
    b.applyImport(TEXT, { ...ALL, mode: 'replace' }, MONDAY);
    expect(templateId('Ancienne')).toBeNull();
    expect(d.first('SELECT archived FROM templates WHERE id = ?', [old])).toEqual({ archived: 1 });
    expect(b.programView(MONDAY).week.map((w) => w.weekday)).toEqual([1]);
    expect(() => b.applyImport('rien', ALL, MONDAY)).toThrow(/Rien à importer/);
  });
});

describe('Partager', () => {
  it('aller-retour vers un compte neuf : séances, formats, superset, semaine type, 1RM, blocs', () => {
    b.applyImport(TEXT, ALL, MONDAY);
    b.saveBlock(null, { name: 'Accu', workWeeks: 4, deloadWeeks: 1, startDate: '2026-01-05' }, MONDAY);
    const file = JSON.parse(b.exportProgram('Partagé'));
    expect(file).toMatchObject({ format: 'myperf-program', version: 1, name: 'Partagé', blocks: [{ name: 'Accu', start: '2026-01-05', deload: { weeks: 1 } }] });
    // Les semaines sont toujours écrites, en groupes (relisibles à l'identique).
    expect(file.blocks![0]!.weeks).toEqual([['top 1x5 @80%', 'backoff 4x6 @70%'], ['top 1x4 @83%', 'backoff 4x6 @73%'], ['top 1x4 @85%', 'backoff 3x6 @75%'], ['top 1x2 @92.5%', 'backoff 3x5 @78%']]);
    const haut = file.sessions.find((s: { name: string }) => s.name === 'Mardi – Haut');
    expect(haut.days).toEqual(['mardi']);
    expect(haut.exercises.find((e: { name: string }) => /Tractions/.test(e.name))).toMatchObject({ format: 'emom', minutes: 10, reps: '5' });
    expect(haut.exercises.find((e: { name: string }) => e.name === 'Gainage')).toMatchObject({ reps: '45s' });
    expect(haut.exercises.filter((e: { superset?: string }) => e.superset === 'A')).toHaveLength(2);
    // Un autre compte importe le fichier : même programme.
    fresh(false);
    const r = b.applyImport(JSON.stringify(file), ALL, MONDAY);
    expect(r.templates).toBe(2);
    const t = b.templateDetail(templateId('Mardi – Haut')!, MONDAY)!;
    expect(t.days).toEqual([1]);
    expect(t.slots.find((s) => /Tractions/.test(s.name))!.prescription).toBe('EMOM 10 min · 5 / min');
    expect(t.slots.filter((s) => s.group?.startsWith('superset'))).toHaveLength(2);
    expect(b.programView(MONDAY).blocks.map((x) => x.name)).toEqual(['Accu']);
  });

  it('les programmes prêts se lisent', () => {
    const ready = b.readyPrograms();
    expect(ready.length).toBeGreaterThan(0);
    expect(b.importPreview(b.readyProgramText(ready[0]!.id)!)).toMatchObject({ ok: true, source: 'json' });
  });
});
