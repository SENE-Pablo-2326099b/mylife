import { importPersonalData } from '@/import/importer';

import { db } from '../db';
import { emptyOverride, saveWeekOverride, weekOverrides } from '../repos/cyclePlans';
import { deleteMesocycleUndoable, getMesocycle, nextCycleName } from '../repos/cycles';
import { archiveTemplateUndoable, getWeekPattern, listTemplateExercises, listTemplates, removeTemplateExerciseUndoable } from '../repos/templates';
import { createTestDb } from './testDb';

const linked = (id: string) => db().first<{ n: number }>('SELECT COUNT(*) AS n FROM workouts WHERE mesocycle_id = ?', [id])?.n ?? 0;

it('undoing a mesocycle deletion restores the cycle, its overrides and its workouts', () => {
  createTestDb();
  importPersonalData();
  const id = 'meso_bloc1';
  saveWeekOverride(id, 'ex_squat', { ...emptyOverride(2), topPercent: 0.82 });
  const workouts = linked(id);
  expect(workouts).toBeGreaterThan(0);

  const undo = deleteMesocycleUndoable(id);
  expect(getMesocycle(id)).toBeNull();
  expect(linked(id)).toBe(0);

  undo();
  expect(getMesocycle(id)?.name).toContain('Bloc 1');
  expect(weekOverrides(id, 'ex_squat').get(2)?.topPercent).toBe(0.82);
  expect(linked(id)).toBe(workouts);
});

it('undoing a template exercise removal or a template archive puts everything back', () => {
  createTestDb();
  importPersonalData();
  const before = listTemplateExercises('tpl_jeudi');
  const first = before[0];
  if (first === undefined) throw new Error('no exercise');
  const undoRemove = removeTemplateExerciseUndoable(first.id);
  expect(listTemplateExercises('tpl_jeudi')).toHaveLength(before.length - 1);
  undoRemove();
  expect(listTemplateExercises('tpl_jeudi').map((t) => t.id)).toEqual(before.map((t) => t.id));

  const pattern = getWeekPattern().filter((e) => e.templateId === 'tpl_jeudi').length;
  const undoArchive = archiveTemplateUndoable('tpl_jeudi');
  expect(listTemplates().some((t) => t.id === 'tpl_jeudi')).toBe(false);
  undoArchive();
  expect(listTemplates().some((t) => t.id === 'tpl_jeudi')).toBe(true);
  expect(getWeekPattern().filter((e) => e.templateId === 'tpl_jeudi')).toHaveLength(pattern);
});

it('numbers the next cycle after the last « Cycle N », ignoring other block names', () => {
  expect(nextCycleName(['Bloc 1 — Remise en route', 'Cycle 1', 'Cycle 2', 'Cycle 3'])).toBe('Cycle 4');
  expect(nextCycleName(['Bloc 1'])).toBe('Cycle 2');
  expect(nextCycleName([])).toBe('Cycle 1');
});
