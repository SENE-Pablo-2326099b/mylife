import { create } from 'zustand';

/** The set whose note / actions sheet is open (one sheet per session screen, not one per row). */
export const useSetMenu = create<{
  target: { workoutId: string; setId: string; mode: 'menu' | 'note' } | null;
  open: (workoutId: string, setId: string, mode: 'menu' | 'note') => void;
  close: () => void;
}>((set) => ({
  target: null,
  open: (workoutId, setId, mode) => set({ target: { workoutId, setId, mode } }),
  close: () => set({ target: null }),
}));
