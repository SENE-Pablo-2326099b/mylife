import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
/**
 * MyPerf, page Programme (module de la coquille) : la vue s'adapte à la structure (blocs : frise et tableau semaine par
 * semaine calculé par le moteur ; routine : ce qui monte la prochaine fois), les séances types et leurs créneaux se
 * modifient (format, progression, groupe, repos, note) ; les colonnes de l'app d'avant suivent, et la séance démarrée
 * prend le format du créneau (un EMOM de 10 min donne 10 minutes).
 */
import { createTestDb } from '@/db/__tests__/testDb';
import { addBodyEntry } from '@/db/repos/body';
import { saveMesocycle } from '@/db/repos/cycles';
import { getExercise } from '@/db/repos/exercises';
import { saveOneRm } from '@/db/repos/oneRm';
import { addPatternEntry, addTemplateExercise, createTemplate } from '@/db/repos/templates';
import { seedIfEmpty } from '@/db/seed';
import { sqliteStore } from '@/services/cloud/sqliteStore';
import { DEFAULT_DELOAD } from '../packages/training/src/mesocycle';
import { schemeForKind } from '../packages/training/src/mesoTypes';
import type { StrengthWeek } from '../packages/training/src/types';
import { createBackend, type Backend } from '../app/src/modules/perf/data/backend';
import { wrapOo1, type Db, type Oo1Db } from '../app/src/modules/perf/data/sql';

let rows: { tbl: string; rid: string; row: unknown }[] = [];
let sqlite3: Awaited<ReturnType<typeof sqlite3InitModule>>;
let force = '';
let volume = '';
// Lundi 19 janvier 2026 : semaine 3 du bloc Accumulation (débuté le 5).
const MONDAY = '2026-01-19';

beforeAll(async () => {
  sqlite3 = await sqlite3InitModule();
  createTestDb();
  seedIfEmpty();
  addBodyEntry('bodyweight', '2026-01-01', 80);
  force = createTemplate('Force A');
  for (const id of ['ex_squat', 'ex_weighted_pullup', 'ex_barbell_curl']) addTemplateExercise(force, getExercise(id)!);
  volume = createTemplate('Volume');
  for (const id of ['ex_barbell_curl', 'ex_bench']) addTemplateExercise(volume, getExercise(id)!);
  addPatternEntry(0, force);
  addPatternEntry(3, volume);
  saveOneRm({ exerciseId: 'ex_squat', value: 160, mode: 'manual', setOn: '2026-01-01' });
  saveOneRm({ exerciseId: 'ex_weighted_pullup', value: 50.8, mode: 'manual', setOn: '2026-01-01' });
  saveMesocycle({ name: 'Accumulation', kind: 'accumulation', macrocycleId: null, startDate: '2026-01-05', workWeeks: 4, deloadWeeks: 1, scheme: schemeForKind('accumulation', 4) as StrengthWeek[], deload: DEFAULT_DELOAD, notes: '' });
  rows = await sqliteStore().snapshot();
});

let d: Db;
let b: Backend;
const fresh = (keep: (r: { tbl: string }) => boolean = () => true) => {
  d = wrapOo1(new sqlite3.oo1.DB(':memory:') as unknown as Oo1Db);
  b = createBackend(d);
  b.apply(rows.filter(keep).map((r) => ({ ...r, deleted: false })));
};
beforeEach(() => fresh());
const slotOf = (templateId: string, exerciseId: string) => b.templateDetail(templateId, MONDAY)!.slots.find((s) => s.exerciseId === exerciseId)!;

describe('Programme : la vue', () => {
  it('par blocs : frise, aujourd’hui, semaine type, tableau semaine par semaine du moteur (semaine en cours, décharge)', () => {
    const v = b.programView(MONDAY);
    expect(v.kind).toBe('periodized');
    expect(v.subtitle).toMatch(/^Par blocs · du 5 janvier au 8 février$/);
    expect(v.blocks).toMatchObject([{ name: 'Accumulation', weeks: 4, deloadWeeks: 1, current: true }]);
    expect(v.today).toMatchObject({ week: 3 });
    expect(v.current).toMatchObject({ name: 'Accumulation', deloadFrom: 5 });
    expect(v.week.map((w) => [w.weekday, w.sessions.map((s) => s.name)])).toEqual([[0, ['Force A']], [3, ['Volume']]]);
    expect(v.week[0]!.sessions[0]!.tag).toBe('force');
    const squat = v.tables.find((t) => t.exerciseId === 'ex_squat')!;
    expect(squat.weeks.map((w) => w.label)).toEqual(['S1', 'S2', 'S3', 'S4', 'Déch.']);
    expect(squat.weeks.filter((w) => w.current).map((w) => w.label)).toEqual(['S3']);
    expect(squat.weeks[2]).toMatchObject({ top: expect.stringMatching(/^1×\d$/), topPct: expect.stringMatching(/ %$/), back: expect.stringMatching(/^\d×\d$/) });
    // Le tableau est celui que la séance prescrira : la semaine 3 vue ici = la séance du lundi 19.
    const today = b.dayView(MONDAY).today[0]!.lines.find((l) => l.name === getExercise('ex_squat')!.name)!;
    expect(today.detail).toContain(squat.weeks[2]!.topPct!);
    expect(v.tables.map((t) => t.exerciseId)).toContain('ex_weighted_pullup');
    expect(v.tables.map((t) => t.exerciseId)).not.toContain('ex_barbell_curl');
  });

  it('en routine (sans bloc) : sous-titre, prochaine séance, pas de frise', () => {
    fresh((r) => r.tbl !== 'mesocycles');
    const v = b.programView('2026-01-20');
    expect(v.kind).toBe('routine');
    expect(v.subtitle).toBe('Routine · 2 séances par semaine');
    expect(v.blocks).toEqual([]);
    expect(v.tables).toEqual([]);
    expect(v.next).toMatchObject({ date: '2026-01-22', session: { name: 'Volume' } });
  });

  it('un compte neuf : rien', () => {
    const empty = createBackend(wrapOo1(new sqlite3.oo1.DB(':memory:') as unknown as Oo1Db));
    expect(empty.programView(MONDAY)).toMatchObject({ hasProgram: false, blocks: [], week: [], tables: [], templates: 0 });
  });
});

describe('Programme : séances types', () => {
  it('créer, renommer, jours, ajouter, déplacer, retirer, archiver (la semaine type suit)', () => {
    const id = b.createTemplate('  Haut du corps ');
    b.renameTemplate(id, 'Haut');
    b.setTemplateDays(id, [1, 4, 4, 9]);
    expect(b.templatesView().find((t) => t.id === id)).toMatchObject({ name: 'Haut', days: [1, 4] });
    const a = b.addSlot(id, 'ex_bench');
    const c = b.addSlot(id, 'ex_barbell_curl');
    b.moveSlot(c, -1);
    expect(b.templateDetail(id, MONDAY)!.slots.map((s) => s.id)).toEqual([c, a]);
    b.removeSlot(c);
    expect(b.templateDetail(id, MONDAY)!.slots.map((s) => s.id)).toEqual([a]);
    expect(b.programView(MONDAY).week.find((w) => w.weekday === 1)!.sessions[0]!.name).toBe('Haut');
    b.archiveTemplate(id);
    expect(b.templatesView().some((t) => t.id === id)).toBe(false);
    expect(b.programView(MONDAY).week.some((w) => w.weekday === 1)).toBe(false);
    expect(() => b.createTemplate('  ')).toThrow(/invalide/);
  });
});

describe('Programme : un créneau', () => {
  it('EMOM 10 min à 5 reps : la séance démarrée a 10 minutes ; la colonne de l’app d’avant reste cohérente', () => {
    const curl = slotOf(volume, 'ex_barbell_curl');
    b.updateSlot(curl.id, { format: { base: 'emom', everySec: 60, totalSec: 600 }, strategy: { id: 'linear', params: { sets: 1, reps: 5, step: 1, metric: 'reps' } } });
    const detail = b.slotDetail(curl.id, MONDAY)!;
    expect(detail.format).toMatchObject({ base: 'emom', everySec: 60, totalSec: 600, name: 'EMOM' });
    expect(detail.strategy).toEqual({ id: 'linear', params: { sets: 1, reps: 5, step: 1, metric: 'reps' } });
    expect(detail.preview).toBe('EMOM 10 min · 5 / min');
    expect(d.first('SELECT progression_type, target_sets FROM template_exercises WHERE id = ?', [curl.id])).toEqual({ progression_type: 'double_progression', target_sets: 1 });
    const sid = b.startSession(volume, '2026-01-22');
    const item = b.sessionDoc(sid)!.items.find((i) => i.exerciseId === 'ex_barbell_curl')!;
    expect(item.format.scheme).toBe('interval');
    expect(item.sets.map((s) => s.targetReps)).toEqual(Array(10).fill(5));
    expect(item.sets.every((s) => s.targetWeight === null)).toBe(true);
    // Une minute se valide sans charge.
    expect(b.completeSet(item.sets[0]!.id, {})).toBe('ok');
  });

  it('formats à soi : au temps 60 s et séries en reps seules, créés une fois, reconnus à la validation', () => {
    const curl = slotOf(force, 'ex_barbell_curl');
    b.updateSlot(curl.id, { format: { base: 'hold', workSec: 60 } });
    b.updateSlot(curl.id, { format: { base: 'hold', workSec: 60 } });
    expect(d.all('SELECT id FROM formats')).toEqual([{ id: 'hold-60' }]);
    expect(b.slotDetail(curl.id, MONDAY)!.preview).toMatch(/^\d+ × 60 s$/);
    const pull = slotOf(force, 'ex_weighted_pullup');
    b.updateSlot(pull.id, { format: { base: 'sets', load: false }, strategy: { id: 'double_progression', params: { sets: 4, repMin: 6, repMax: 10 } } });
    const sid = b.startSession(force, MONDAY);
    const item = b.sessionDoc(sid)!.items.find((i) => i.exerciseId === 'ex_weighted_pullup')!;
    expect(item.format.metrics).toEqual(['reps']);
    expect(b.completeSet(item.sets[0]!.id, { reps: 8 })).toBe('ok');
  });

  it('progression au % : colonnes de l’app d’avant ; réglages bornés par la définition de la progression', () => {
    const curl = slotOf(force, 'ex_barbell_curl');
    b.updateSlot(curl.id, { strategy: { id: 'percent_reference', params: { topSets: 9, backoffSets: 3, inconnu: 1 } } });
    expect(d.first('SELECT progression_type, top_sets, backoff_sets, strategy FROM template_exercises WHERE id = ?', [curl.id])).toEqual({ progression_type: 'top_set_backoff', top_sets: 5, backoff_sets: 3, strategy: null });
    expect(b.slotDetail(curl.id, MONDAY)!.strategy).toMatchObject({ id: 'percent_reference', params: { topSets: 5, backoffSets: 3 } });
    expect(() => b.updateSlot(curl.id, { strategy: { id: 'nimporte' as never, params: {} } })).toThrow(/inconnue/);
  });

  it('superset avec le suivant : un seul groupe, tours communs ; la séance le reçoit ; dégrouper libère les deux', () => {
    const [squat, pull] = b.templateDetail(force, MONDAY)!.slots;
    b.updateSlot(squat!.id, { group: { kind: 'superset', rounds: 3 }, restSec: 90, notes: '  sans pause ' });
    const groups = d.all<{ group_json: string }>('SELECT group_json FROM template_exercises WHERE template_id = ? ORDER BY position', [force]).map((r) => (r.group_json ? JSON.parse(r.group_json) : null));
    expect(groups[0]).toMatchObject({ kind: 'superset', rounds: 3 });
    expect(groups[1]).toEqual(groups[0]);
    expect(groups[2]).toBeNull();
    expect(b.slotDetail(squat!.id, MONDAY)).toMatchObject({ group: { kind: 'superset', rounds: 3, withNext: true }, restSec: 90, notes: 'sans pause' });
    expect(b.templateDetail(force, MONDAY)!.slots[1]!.group).toBe('superset A · 3 tours');
    const sid = b.startSession(force, MONDAY);
    const items = b.sessionDoc(sid)!.items;
    expect(items[0]!.group?.id).toBe(items[1]!.group?.id);
    expect(items[0]!.restSec).toBe(90);
    b.discardSession(sid);
    b.updateSlot(pull!.id, { group: null });
    expect(d.all('SELECT group_json FROM template_exercises WHERE template_id = ? AND group_json IS NOT NULL', [force])).toEqual([]);
  });
});
