import { db } from '@/db/db';
import { createExercise, getExercise, listExercises } from '@/db/repos/exercises';
import { getOneRm, listOneRms, saveOneRm } from '@/db/repos/oneRm';
import { loadSettings } from '@/db/repos/settings';
import { addPatternEntry, addTemplateExercise, createTemplate, getWeekPattern, listTemplateExercises, listTemplates, removePatternEntry, updateTemplateExercise } from '@/db/repos/templates';
import { today } from '@/domain/dates';
import { buildPlan, newExercises, programToFile, type ImportPlan } from '@/domain/program/plan';
import type { ParsedProgram, ProgramFile } from '@/domain/program/format';
import type { LibraryEntry } from '@/domain/program/match';

/**
 * Import et export de programmes : du plan validé dans l'aperçu à la base (une seule transaction :
 * tout ou rien), et du programme actuel vers le format d'échange.
 */

export function exerciseLibrary(): LibraryEntry[] {
  return listExercises(false).map((e) => ({ id: e.id, name: e.name }));
}

export function planFor(program: ParsedProgram): ImportPlan {
  return buildPlan(program, exerciseLibrary(), listTemplates().map((t) => t.name));
}

export type PatternMode = 'keep' | 'add' | 'replace';

export interface ImportOptions {
  /** Semaine type : la garder telle quelle, y ajouter les jours du programme, ou la remplacer. */
  pattern: PatternMode;
  /** Enregistrer les 1RM du programme (sans écraser ceux déjà saisis). */
  oneRms: boolean;
}

export interface ImportResult {
  templates: string[];
  createdExercises: number;
  patternEntries: number;
  oneRms: number;
}

export function applyPlan(plan: ImportPlan, options: ImportOptions): ImportResult {
  const backoff = loadSettings().defaultBackoffPercent;
  const result: ImportResult = { templates: [], createdExercises: 0, patternEntries: 0, oneRms: 0 };
  db().transaction(() => {
    // 1. Les exercices inconnus de la bibliothèque.
    const created = new Map<string, string>();
    for (const e of newExercises(plan)) {
      const id = createExercise({
        name: e.name,
        primaryMuscles: e.primaryMuscles,
        secondaryMuscles: [],
        equipment: e.equipment,
        unilateral: e.unilateral,
        loadType: e.loadType,
        category: e.category,
        progressionType: 'double_progression',
        backoffPercent: backoff,
        repRangeMin: e.repMin,
        repRangeMax: e.repMax,
        weightIncrement: null,
        isCustom: true,
        notes: '',
      });
      created.set(e.name.toLowerCase(), id);
      result.createdExercises += 1;
    }
    // 2. Les séances types et leurs exercices.
    if (options.pattern === 'replace') for (const p of getWeekPattern()) removePatternEntry(p.id);
    for (const s of plan.sessions) {
      const templateId = createTemplate(s.name);
      result.templates.push(templateId);
      for (const pe of s.exercises) {
        const exerciseId = pe.exerciseId ?? created.get(pe.parsed.name.trim().toLowerCase());
        const ex = exerciseId ? getExercise(exerciseId) : null;
        if (!ex) continue;
        const slotId = addTemplateExercise(templateId, ex);
        const slot = listTemplateExercises(templateId).find((t) => t.id === slotId);
        if (!slot) continue;
        updateTemplateExercise({ ...slot, intention: pe.intention, targetSets: pe.sets, repMin: pe.repMin, repMax: pe.repMax, notes: pe.notes });
      }
      if (s.notes) db().run('UPDATE templates SET notes = ? WHERE id = ?', [s.notes, templateId]);
      // 3. La semaine type.
      if (options.pattern !== 'keep') {
        for (const day of s.weekdays) {
          addPatternEntry(day, templateId);
          result.patternEntries += 1;
        }
      }
    }
    // 4. Les 1RM, sans écraser ceux déjà saisis.
    if (options.oneRms) {
      for (const r of plan.oneRms) {
        const exerciseId = r.exerciseId ?? created.get(r.name.trim().toLowerCase()) ?? null;
        if (!exerciseId || getOneRm(exerciseId)?.mode === 'manual') continue;
        saveOneRm({ exerciseId, value: r.kg, mode: 'manual', setOn: today() });
        result.oneRms += 1;
      }
    }
  });
  return result;
}

/** Le programme actuel (séances types, semaine type, 1RM saisis) dans le format d'échange. */
export function exportProgram(name = 'Mon programme MyPerf'): ProgramFile {
  const templates = listTemplates();
  const names = new Map(templates.map((t) => [t.id, t.name]));
  const exercises = new Map(listExercises(true).map((e) => [e.id, e]));
  return programToFile({
    name,
    sessions: templates.map((t) => ({
      name: t.name,
      notes: t.notes,
      exercises: listTemplateExercises(t.id).flatMap((te) => {
        const ex = exercises.get(te.exerciseId);
        return ex ? [{ name: ex.name, sets: te.targetSets, repMin: te.repMin ?? ex.repRangeMin, repMax: te.repMax ?? ex.repRangeMax, notes: te.notes, equipment: ex.equipment, muscles: ex.primaryMuscles, bodyweight: ex.loadType === 'bodyweight' }] : [];
      }),
    })),
    pattern: getWeekPattern().flatMap((p) => (names.has(p.templateId) ? [{ weekday: p.weekday, session: names.get(p.templateId)! }] : [])),
    oneRms: listOneRms()
      .filter((o) => o.mode === 'manual')
      .flatMap((o) => (exercises.has(o.exerciseId) ? [{ name: exercises.get(o.exerciseId)!.name, kg: o.value }] : [])),
  });
}

export const hasWeekPattern = (): boolean => getWeekPattern().length > 0;
