import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
/**
 * MyPerf et le reste de MyLife (maquette V3-Accueil) : l'aperçu de la carte d'accueil, la fiche de Copilot Sport (séances
 * prévues décalables, lifts en lest net), l'agenda commun, et l'action « décaler » validée dans Copilot (et son retour).
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
import { ACTION_APP, parseActionSpec } from '../packages/lumen/src/actions';
import { createBackend, type Backend } from '../app/src/modules/perf/data/backend';
import { wrapOo1, type Oo1Db } from '../app/src/modules/perf/data/sql';

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
beforeEach(() => {
  b = createBackend(wrapOo1(new sqlite3.oo1.DB(':memory:') as unknown as Oo1Db));
  b.apply(rows.map((r) => ({ ...r, deleted: false })));
});


describe('MyPerf dans MyLife', () => {
  it('la carte d’accueil : la séance du jour (ou en cours), sa durée, sa semaine du bloc', () => {
    expect(b.homeCard(MONDAY)).toMatchObject({ kicker: 'MyPerf · séance du jour', title: 'Force A', chip: 'S3', start: 'Démarrer' });
    expect(b.homeCard('2026-01-20')).toMatchObject({ title: 'Volume', start: 'La faire maintenant' });
    b.startSession(b.dayView(MONDAY).today[0]!.id, MONDAY);
    expect(b.homeCard(MONDAY)).toMatchObject({ kicker: 'MyPerf · séance en cours', start: 'Reprendre' });
    const fresh = createBackend(wrapOo1(new sqlite3.oo1.DB(':memory:') as unknown as Oo1Db));
    expect(fresh.homeCard(MONDAY)).toBeNull();
  });

  it('la fiche Copilot : séances prévues décalables (21 jours), bloc, dernières séances, lifts ; l’agenda commun', () => {
    const card = b.copilotCard(MONDAY) as { planned: { id: string; date: string; session: string; action: string }[]; cycle: { name: string; week: number }; recentWorkouts: unknown[]; mainLifts: { exercise: string }[] };
    expect(card.planned[0]).toMatchObject({ date: MONDAY, session: 'Force A', action: 'perf.moveSession' });
    expect(card.planned[0]!.id).toMatch(/:2026-01-19$/);
    expect(card.planned.filter((p) => p.session === 'Volume').map((p) => p.date)).toEqual(['2026-01-22', '2026-01-29', '2026-02-05']);
    expect(card.cycle).toMatchObject({ name: 'Accumulation', week: 3 });
    expect(card.recentWorkouts.length).toBe(3);
    expect(card.mainLifts.length).toBeGreaterThan(0);
    expect(b.agendaEvents(MONDAY)[0]).toMatchObject({ kind: 'session', title: 'Force A', url: '/sport' });
  });

  it('« décaler » validé dans Copilot : exécuté par le module, avec son retour ; une action lue prudemment', () => {
    const volume = (b.copilotCard(MONDAY) as { planned: { id: string; session: string }[] }).planned.find((p) => p.session === 'Volume')!;
    const r = b.executeMove(volume.id, '2026-01-23');
    expect(r.summary).toMatch(/^Remettre « Volume » au jeudi 22 janvier$/);
    expect(b.dayView(MONDAY).week[4]!.planned.map((p) => p.name)).toEqual(['Volume']);
    // Le retour remet la séance à son jour.
    b.executeMove(r.undo.plannedId, r.undo.date);
    expect(b.dayView(MONDAY).week[3]!.planned.map((p) => p.name)).toEqual(['Volume']);
    expect(() => b.executeMove(volume.id.replace(/:.*$/, ':2026-01-21'), '2026-01-23')).toThrow(/plus prévue/);
    expect(ACTION_APP['perf.moveSession']).toBe('sport');
    expect(parseActionSpec({ kind: 'perf.moveSession', summary: 'Décaler', params: { plannedId: volume.id, date: '2026-01-23' } }).action).toBeDefined();
    expect(parseActionSpec({ kind: 'perf.moveSession', summary: 'Décaler', params: { plannedId: 'abc', date: '2026-01-23' } }).error).toMatch(/plannedId/);
  });
});
