/**
 * In-memory model of the workouts being displayed (the active one, or a past one being edited).
 *
 * Every mutation is applied immutably (only touched objects change → memoised rows don't re-render)
 * AND written to SQLite synchronously in the same call: the disk is never behind the screen,
 * so a crash or kill loses nothing.
 */
import * as Haptics from 'expo-haptics';
import { create } from 'zustand';

import { estimate1RM, formatWeight } from '@/domain/math';
import { RELIABLE_MAX_REPS } from '@/domain/reference';
import { restSeconds } from '@/domain/rest';
import { isRecordSet } from '@/domain/summary';
import {
  effectiveReps,
  effectiveWeight,
  nextSetType,
  recalcBackoffs,
  reclassifyCompleted,
  typeForNewSet,
  warmupRamp,
  warmupTarget,
} from '@/domain/sets';
import type { BarSpeed, SetType, WorkoutSet } from '@/domain/types';

import { db, newId } from '@/db/db';
import { linkPlannedWorkout } from '@/db/repos/planning';
import {
  deleteSet,
  deleteWorkoutExercise,
  insertSet,
  insertWorkout,
  insertWorkoutExercise,
  updateSet,
  updateWorkoutExercise,
  updateWorkoutMeta,
} from '@/db/repos/workouts';
import {
  addExerciseToWorkout,
  discardWorkout,
  finishWorkout,
  loadWorkoutDoc,
  replaceExercise,
  type ExerciseItem,
  type WorkoutDoc,
} from '@/services/workoutService';
import { useRestTimer } from './restTimerStore';
import { useSettings } from './settingsStore';
import { showToast } from './toastStore';

export type SetField = 'weight' | 'reps';
export type CompleteResult = 'completed' | 'uncompleted' | 'need-weight' | 'need-reps' | 'missing';

interface WorkoutStore {
  docs: Record<string, WorkoutDoc>;
  load: (workoutId: string) => WorkoutDoc | null;
  unload: (workoutId: string) => void;

  setValue: (workoutId: string, setId: string, field: SetField, value: number | null) => void;
  toggleComplete: (workoutId: string, setId: string) => CompleteResult;
  setBarSpeed: (workoutId: string, setId: string, speed: BarSpeed) => void;
  /** Marks / unmarks a max-effort test set (calibrates the reference 1RM). */
  toggleTest: (workoutId: string, setId: string) => void;
  cycleType: (workoutId: string, setId: string) => void;
  setSetType: (workoutId: string, setId: string, type: SetType) => void;
  addSet: (workoutId: string, weId: string) => string | null;
  addWarmup: (workoutId: string, weId: string) => void;
  removeSet: (workoutId: string, setId: string) => void;
  /** Free note on one set ('' removes it). */
  setNote: (workoutId: string, setId: string, note: string) => void;

  setExerciseNotes: (workoutId: string, weId: string, notes: string) => void;
  moveExercise: (workoutId: string, weId: string, direction: -1 | 1) => void;
  removeExercise: (workoutId: string, weId: string) => void;
  addExercise: (workoutId: string, exerciseId: string) => void;
  replaceExercise: (workoutId: string, weId: string, exerciseId: string, opts?: { alsoTemplate?: boolean }) => void;

  renameWorkout: (workoutId: string, name: string) => void;
  setWorkoutNotes: (workoutId: string, notes: string) => void;
  finish: (workoutId: string) => void;
  discard: (workoutId: string) => void;
}

/**
 * Post-processing after any set change: auto-detect types of done sets. Backoffs follow the top set
 * live only when the lift has no reference 1RM; with one, every set stays at its % of the day.
 */
function normalize(item: ExerciseItem, doc: WorkoutDoc, sets: readonly WorkoutSet[]): readonly WorkoutSet[] {
  let next = reclassifyCompleted(sets, item.we.progressionType);
  if (item.we.progressionType === 'top_set_backoff' && item.we.referenceE1rm === null) {
    next = recalcBackoffs(next, {
      percent: item.we.backoffPercent,
      increment: item.exercise.weightIncrement ?? doc.settings.increment,
      bodyweight: item.exercise.loadType === 'bodyweight' ? doc.workout.bodyweight : null,
    });
  }
  return next;
}

/** Writes every set whose object identity changed. */
function persistChanged(prev: readonly WorkoutSet[], next: readonly WorkoutSet[]) {
  if (prev === next) return;
  const before = new Map(prev.map((s) => [s.id, s]));
  db().transaction(() => {
    for (const s of next) {
      const old = before.get(s.id);
      if (old === undefined) insertSet(s);
      else if (old !== s) updateSet(s);
    }
  });
}

function locate(doc: WorkoutDoc, setId: string): { index: number; item: ExerciseItem; set: WorkoutSet } | null {
  for (let index = 0; index < doc.items.length; index++) {
    const item = doc.items[index];
    const set = item?.sets.find((s) => s.id === setId);
    if (item !== undefined && set !== undefined) return { index, item, set };
  }
  return null;
}

const bodyweightFor = (doc: WorkoutDoc, item: ExerciseItem) =>
  item.exercise.loadType === 'bodyweight' ? doc.workout.bodyweight : null;

export const useWorkoutStore = create<WorkoutStore>((set, get) => {
  const getDoc = (workoutId: string): WorkoutDoc | null => get().docs[workoutId] ?? null;
  const putDoc = (doc: WorkoutDoc) => set((s) => ({ docs: { ...s.docs, [doc.workout.id]: doc } }));

  /** Replaces one item's sets through the normalisation pipeline and persists the diff. */
  const commitSets = (doc: WorkoutDoc, index: number, rawNext: readonly WorkoutSet[]) => {
    const item = doc.items[index];
    if (item === undefined) return;
    const next = normalize(item, doc, rawNext);
    persistChanged(item.sets, next);
    const items = doc.items.slice();
    items[index] = { ...item, sets: next };
    putDoc({ ...doc, items });
  };

  const updateOneSet = (workoutId: string, setId: string, fn: (s: WorkoutSet) => WorkoutSet) => {
    const doc = getDoc(workoutId);
    const loc = doc === null ? null : locate(doc, setId);
    if (doc === null || loc === null) return;
    commitSets(
      doc,
      loc.index,
      loc.item.sets.map((s) => (s.id === setId ? fn(s) : s)),
    );
  };

  const reload = (workoutId: string) => {
    const doc = loadWorkoutDoc(workoutId);
    if (doc !== null) putDoc(doc);
    return doc;
  };

  return {
    docs: {},

    load: (workoutId) => reload(workoutId),

    unload: (workoutId) =>
      set((s) => {
        const docs = { ...s.docs };
        delete docs[workoutId];
        return { docs };
      }),

    setValue: (workoutId, setId, field, value) =>
      updateOneSet(workoutId, setId, (s) => (field === 'weight' ? { ...s, weight: value } : { ...s, reps: value })),

    toggleComplete: (workoutId, setId) => {
      const doc = getDoc(workoutId);
      const loc = doc === null ? null : locate(doc, setId);
      if (doc === null || loc === null) return 'missing';
      const { item, set: target } = loc;

      if (target.completed) {
        updateOneSet(workoutId, setId, (s) => ({ ...s, completed: false, completedAt: null }));
        return 'uncompleted';
      }
      const weight = effectiveWeight(target);
      const reps = effectiveReps(target);
      if (weight === null) return 'need-weight';
      if (reps === null) return 'need-reps';

      const bw = bodyweightFor(doc, item);
      const e1rm = estimate1RM(weight, reps, bw);
      const strength = item.we.progressionType === 'top_set_backoff';
      const countsForRecord = (r: number) => !strength || r <= RELIABLE_MAX_REPS;
      const bestToday = item.sets.reduce(
        (m, s) =>
          s.completed && s.weight !== null && s.reps !== null && s.setType !== 'warmup' && countsForRecord(s.reps)
            ? Math.max(m, estimate1RM(s.weight, s.reps, bw))
            : m,
        0,
      );

      updateOneSet(workoutId, setId, (s) => ({ ...s, weight, reps, completed: true, completedAt: Date.now() }));
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      if (isRecordSet({ e1rm, historicBest: item.historicBest, bestToday, setType: target.setType, countsForRecord: countsForRecord(reps) })) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showToast(
          {
            message: `Record sur ${item.exercise.name} : e1RM ${formatWeight(Math.round(e1rm * 10) / 10)} kg (+${formatWeight(Math.round((e1rm - (item.historicBest ?? 0)) * 10) / 10)})`,
            tone: 'gold',
          },
          5000,
        );
      }

      const settings = useSettings.getState().settings;
      if (settings.restAutoStart && doc.workout.status === 'active') {
        const after = getDoc(workoutId);
        const setType = after === null ? target.setType : (locate(after, setId)?.set.setType ?? target.setType);
        const seconds = restSeconds(settings.rest, item.exercise.category, item.we.intention, setType);
        useRestTimer.getState().start(seconds, item.exercise.name);
      }
      return 'completed';
    },

    setBarSpeed: (workoutId, setId, speed) =>
      updateOneSet(workoutId, setId, (s) => ({ ...s, barSpeed: s.barSpeed === speed ? null : speed })),

    toggleTest: (workoutId, setId) => {
      void Haptics.selectionAsync();
      updateOneSet(workoutId, setId, (s) => ({ ...s, isTest: !s.isTest }));
    },

    cycleType: (workoutId, setId) => {
      const doc = getDoc(workoutId);
      const loc = doc === null ? null : locate(doc, setId);
      if (loc === null) return;
      void Haptics.selectionAsync();
      updateOneSet(workoutId, setId, (s) => ({
        ...s,
        setType: nextSetType(s.setType, loc.item.we.progressionType),
        typeManual: true,
      }));
    },

    setSetType: (workoutId, setId, type) => {
      void Haptics.selectionAsync();
      updateOneSet(workoutId, setId, (s) => ({ ...s, setType: type, typeManual: true }));
    },

    addSet: (workoutId, weId) => {
      const doc = getDoc(workoutId);
      const index = doc?.items.findIndex((i) => i.we.id === weId) ?? -1;
      const item = doc?.items[index];
      if (doc === null || doc === undefined || item === undefined) return null;
      const last = item.sets[item.sets.length - 1];
      const setType = typeForNewSet(item.sets, item.we.progressionType);
      const newSet: WorkoutSet = {
        id: newId(),
        workoutExerciseId: weId,
        position: item.sets.reduce((m, s) => Math.max(m, s.position + 1), 0),
        setType,
        typeManual: false,
        weight: null,
        reps: null,
        targetWeight: last === undefined ? null : effectiveWeight(last),
        targetReps: last === undefined ? item.we.repMin : effectiveReps(last),
        targetRepsMax: last?.targetRepsMax ?? null,
        barSpeed: null,
        isTest: false,
        note: '',
        completed: false,
        completedAt: null,
      };
      void Haptics.selectionAsync();
      commitSets(doc, index, [...item.sets, newSet]);
      return newSet.id;
    },

    addWarmup: (workoutId, weId) => {
      const doc = getDoc(workoutId);
      const index = doc?.items.findIndex((i) => i.we.id === weId) ?? -1;
      const item = doc?.items[index];
      if (doc === null || doc === undefined || item === undefined) return;
      const warmups = item.sets.filter((s) => s.setType === 'warmup').length;
      const firstWork = item.sets.find((s) => s.setType !== 'warmup');
      const working = firstWork === undefined ? null : effectiveWeight(firstWork);
      const increment = item.exercise.weightIncrement ?? doc.settings.increment;
      const blank = (targetWeight: number | null, targetReps: number): WorkoutSet => ({
        id: newId(),
        workoutExerciseId: weId,
        position: 0,
        setType: 'warmup',
        typeManual: true,
        weight: null,
        reps: null,
        targetWeight,
        targetReps,
        targetRepsMax: null,
        barSpeed: null,
        isTest: false,
        note: '',
        completed: false,
        completedAt: null,
      });
      // First tap: the whole ramp at once. Later taps: one more warm-up set.
      const ramp =
        warmups === 0
          ? warmupRamp(working, {
              increment,
              bodyweight: item.exercise.loadType === 'bodyweight' ? doc.workout.bodyweight : null,
              barWeight: item.exercise.equipment === 'barbell' ? doc.settings.barWeight : null,
            })
          : [];
      const added =
        ramp.length > 0
          ? ramp.map((w) => blank(w.weight, w.reps))
          : (() => {
              const target = warmupTarget(working, warmups, increment);
              return [blank(target.weight, target.reps)];
            })();
      // Insert after existing warmups, then renumber positions.
      const ordered = [...item.sets];
      ordered.splice(warmups, 0, ...added);
      void Haptics.selectionAsync();
      commitSets(
        doc,
        index,
        ordered.map((s, position) => (s.position === position && !added.includes(s) ? s : { ...s, position })),
      );
    },

    setNote: (workoutId, setId, note) => updateOneSet(workoutId, setId, (s) => ({ ...s, note: note.trim() })),

    removeSet: (workoutId, setId) => {
      const doc = getDoc(workoutId);
      const loc = doc === null ? null : locate(doc, setId);
      if (doc === null || loc === null) return;
      deleteSet(setId);
      const items = doc.items.slice();
      items[loc.index] = { ...loc.item, sets: loc.item.sets.filter((s) => s.id !== setId) };
      putDoc({ ...doc, items });
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      showToast({
        message: 'Série supprimée',
        actionLabel: 'Annuler',
        onAction: () => {
          const current = getDoc(workoutId);
          const idx = current?.items.findIndex((i) => i.we.id === loc.item.we.id) ?? -1;
          const it = current?.items[idx];
          if (current === null || current === undefined || it === undefined) return;
          insertSet(loc.set);
          const restored = [...it.sets, loc.set].sort((a, b) => a.position - b.position);
          const nextItems = current.items.slice();
          nextItems[idx] = { ...it, sets: restored };
          putDoc({ ...current, items: nextItems });
        },
      });
    },

    setExerciseNotes: (workoutId, weId, notes) => {
      const doc = getDoc(workoutId);
      const index = doc?.items.findIndex((i) => i.we.id === weId) ?? -1;
      const item = doc?.items[index];
      if (doc === null || doc === undefined || item === undefined) return;
      const we = { ...item.we, notes };
      updateWorkoutExercise(we);
      const items = doc.items.slice();
      items[index] = { ...item, we };
      putDoc({ ...doc, items });
    },

    moveExercise: (workoutId, weId, direction) => {
      const doc = getDoc(workoutId);
      if (doc === null) return;
      const index = doc.items.findIndex((i) => i.we.id === weId);
      const other = index + direction;
      const a = doc.items[index];
      const b = doc.items[other];
      if (a === undefined || b === undefined) return;
      const items = doc.items.slice();
      const aWe = { ...a.we, position: b.we.position };
      const bWe = { ...b.we, position: a.we.position };
      db().transaction(() => {
        updateWorkoutExercise(aWe);
        updateWorkoutExercise(bWe);
      });
      items[other] = { ...a, we: aWe };
      items[index] = { ...b, we: bWe };
      putDoc({ ...doc, items });
    },

    removeExercise: (workoutId, weId) => {
      const doc = getDoc(workoutId);
      if (doc === null) return;
      const index = doc.items.findIndex((i) => i.we.id === weId);
      const item = doc.items[index];
      if (item === undefined) return;
      deleteWorkoutExercise(weId);
      putDoc({ ...doc, items: doc.items.filter((i) => i.we.id !== weId) });
      showToast({
        message: `${item.exercise.name} retiré`,
        actionLabel: 'Annuler',
        onAction: () => {
          db().transaction(() => {
            insertWorkoutExercise(item.we);
            item.sets.forEach(insertSet);
          });
          const current = getDoc(workoutId);
          if (current === null) return;
          const items = current.items.slice();
          items.splice(Math.min(index, items.length), 0, item);
          putDoc({ ...current, items });
        },
      });
    },

    addExercise: (workoutId, exerciseId) => {
      addExerciseToWorkout(workoutId, exerciseId);
      reload(workoutId);
    },

    replaceExercise: (workoutId, weId, exerciseId, opts) => {
      replaceExercise(weId, exerciseId, opts);
      reload(workoutId);
    },

    renameWorkout: (workoutId, name) => {
      const doc = getDoc(workoutId);
      const trimmed = name.trim();
      if (doc === null || trimmed === '') return;
      updateWorkoutMeta(workoutId, { name: trimmed });
      putDoc({ ...doc, workout: { ...doc.workout, name: trimmed } });
    },

    setWorkoutNotes: (workoutId, notes) => {
      const doc = getDoc(workoutId);
      if (doc === null) return;
      updateWorkoutMeta(workoutId, { notes });
      putDoc({ ...doc, workout: { ...doc.workout, notes } });
    },

    finish: (workoutId) => {
      finishWorkout(workoutId);
      useRestTimer.getState().stop();
      get().unload(workoutId);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },

    discard: (workoutId) => {
      const doc = getDoc(workoutId);
      if (doc === null) return;
      discardWorkout(workoutId);
      useRestTimer.getState().stop();
      get().unload(workoutId);
      showToast(
        {
          message: 'Séance abandonnée',
          actionLabel: 'Annuler',
          onAction: () => {
            db().transaction(() => {
              insertWorkout(doc.workout);
              for (const item of doc.items) {
                insertWorkoutExercise(item.we);
                item.sets.forEach(insertSet);
              }
              if (doc.workout.plannedId !== null) linkPlannedWorkout(doc.workout.plannedId, doc.workout.id);
            });
            reload(workoutId);
          },
        },
        6000,
      );
    },
  };
});
