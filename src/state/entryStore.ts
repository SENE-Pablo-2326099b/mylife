/**
 * Numeric entry for the logging screen: which cell is focused and what is being typed.
 *
 * Choice: a custom in-app keypad instead of the system keyboard. It opens instantly on the
 * weight, never covers the rows, carries ± steps and a "validate set" key, and keeps the
 * layout stable — the whole entry fits in 2-3 seconds.
 */
import * as Haptics from 'expo-haptics';
import { create } from 'zustand';

import { plainWeight, roundToIncrement } from '@/domain/math';
import { effectiveReps, effectiveWeight } from '@/domain/sets';
import type { WorkoutSet } from '@/domain/types';

import { useWorkoutStore, type SetField } from './workoutStore';

export interface EntryFocus {
  workoutId: string;
  setId: string;
  field: SetField;
  /** Where the keypad renders: in place of the tab bar (Today) or at the bottom of a pushed screen. */
  host: 'tabs' | 'screen';
}

interface EntryState {
  focus: EntryFocus | null;
  /** Characters typed since focusing; empty + fresh means "show the current value, replace on first key". */
  buffer: string;
  fresh: boolean;
  open: (focus: EntryFocus) => void;
  close: () => void;
  key: (k: KeypadKey) => void;
}

export type KeypadKey =
  | { type: 'digit'; value: string }
  | { type: 'dot' }
  | { type: 'backspace' }
  | { type: 'step'; direction: 1 | -1 }
  | { type: 'next' }
  | { type: 'validate' };

function findSet(workoutId: string, setId: string): { set: WorkoutSet; increment: number; order: WorkoutSet[] } | null {
  const doc = useWorkoutStore.getState().docs[workoutId];
  if (doc === undefined) return null;
  const order = doc.items.flatMap((i) => [...i.sets]);
  for (const item of doc.items) {
    const set = item.sets.find((s) => s.id === setId);
    if (set !== undefined) return { set, increment: item.exercise.weightIncrement ?? doc.settings.increment, order };
  }
  return null;
}

function parse(buffer: string, field: SetField): number | null {
  if (buffer === '' || buffer === '.') return null;
  const n = field === 'weight' ? Number.parseFloat(buffer) : Number.parseInt(buffer, 10);
  return Number.isFinite(n) ? n : null;
}

const MAX_LEN: Record<SetField, number> = { weight: 6, reps: 3 };

export const useEntry = create<EntryState>((set, get) => {
  const write = (focus: EntryFocus, value: number | null) =>
    useWorkoutStore.getState().setValue(focus.workoutId, focus.setId, focus.field, value);

  const focusNextPending = (focus: EntryFocus) => {
    const found = findSet(focus.workoutId, focus.setId);
    if (found === null) return set({ focus: null });
    const idx = found.order.findIndex((s) => s.id === focus.setId);
    const next = found.order.slice(idx + 1).find((s) => !s.completed);
    set(
      next === undefined
        ? { focus: null, buffer: '', fresh: true }
        : { focus: { ...focus, setId: next.id, field: 'weight' }, buffer: '', fresh: true },
    );
  };

  return {
    focus: null,
    buffer: '',
    fresh: true,
    open: (focus) => {
      void Haptics.selectionAsync();
      set({ focus, buffer: '', fresh: true });
    },
    close: () => set({ focus: null, buffer: '', fresh: true }),
    key: (k) => {
      const { focus, buffer, fresh } = get();
      if (focus === null) return;
      const found = findSet(focus.workoutId, focus.setId);
      if (found === null) return set({ focus: null });
      const current = focus.field === 'weight' ? found.set.weight : found.set.reps;

      switch (k.type) {
        case 'digit': {
          const base = fresh ? '' : buffer;
          if (base.length >= MAX_LEN[focus.field]) return;
          const next = base === '0' ? k.value : base + k.value;
          set({ buffer: next, fresh: false });
          write(focus, parse(next, focus.field));
          return;
        }
        case 'dot': {
          if (focus.field !== 'weight') return;
          const base = fresh ? '0' : buffer || '0';
          if (base.includes('.')) return;
          set({ buffer: `${base}.`, fresh: false });
          return;
        }
        case 'backspace': {
          const base = fresh ? (current === null ? '' : plainWeight(current)) : buffer;
          const next = base.slice(0, -1);
          set({ buffer: next, fresh: false });
          write(focus, parse(next, focus.field));
          return;
        }
        case 'step': {
          const start =
            focus.field === 'weight' ? (effectiveWeight(found.set) ?? 0) : (effectiveReps(found.set) ?? 0);
          const delta = focus.field === 'weight' ? found.increment * k.direction : k.direction;
          const raw = Math.max(0, start + delta);
          const value = focus.field === 'weight' ? roundToIncrement(raw, found.increment) : Math.round(raw);
          void Haptics.selectionAsync();
          set({ buffer: '', fresh: true });
          write(focus, value);
          return;
        }
        case 'next': {
          if (focus.field === 'weight') set({ focus: { ...focus, field: 'reps' }, buffer: '', fresh: true });
          else focusNextPending(focus);
          return;
        }
        case 'validate': {
          const result = useWorkoutStore.getState().toggleComplete(focus.workoutId, focus.setId);
          if (result === 'need-weight') set({ focus: { ...focus, field: 'weight' }, buffer: '', fresh: true });
          else if (result === 'need-reps') set({ focus: { ...focus, field: 'reps' }, buffer: '', fresh: true });
          else set({ focus: null, buffer: '', fresh: true });
          return;
        }
      }
    },
  };
});
