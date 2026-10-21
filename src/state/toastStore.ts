import { create } from 'zustand';

export interface Toast {
  id: number;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Gold = a record (trophy). */
  tone?: 'gold';
}

interface ToastState {
  toast: Toast | null;
  show: (t: Omit<Toast, 'id'>, durationMs?: number) => void;
  dismiss: () => void;
}

let seq = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

/** Non-blocking feedback with optional undo — replaces confirmation popups. */
export const useToast = create<ToastState>((set) => ({
  toast: null,
  show: (t, durationMs = 4000) => {
    seq += 1;
    const id = seq;
    if (timer !== null) clearTimeout(timer);
    set({ toast: { ...t, id } });
    timer = setTimeout(() => set((s) => (s.toast?.id === id ? { toast: null } : s)), durationMs);
  },
  dismiss: () => set({ toast: null }),
}));

export const showToast = (t: Omit<Toast, 'id'>, durationMs?: number) => useToast.getState().show(t, durationMs);
