import { create } from 'zustand';

/** The end-of-session report on screen (null = closed). */
export const useSessionSummary = create<{ workoutId: string | null; show: (id: string) => void; hide: () => void }>((set) => ({
  workoutId: null,
  show: (workoutId) => set({ workoutId }),
  hide: () => set({ workoutId: null }),
}));
