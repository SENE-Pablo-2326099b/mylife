import { router } from 'expo-router';
import { create } from 'zustand';

/** Bridges the exercise picker route and whoever opened it (callbacks can't travel in URL params). */
interface PickerState {
  title: string;
  onPick: ((exerciseId: string) => void) | null;
  open: (title: string, onPick: (exerciseId: string) => void) => void;
  pick: (exerciseId: string) => void;
}

export const usePicker = create<PickerState>((set, get) => ({
  title: '',
  onPick: null,
  open: (title, onPick) => {
    set({ title, onPick });
    router.push('/exercise-picker');
  },
  pick: (exerciseId) => {
    const cb = get().onPick;
    set({ onPick: null });
    router.back();
    cb?.(exerciseId);
  },
}));
