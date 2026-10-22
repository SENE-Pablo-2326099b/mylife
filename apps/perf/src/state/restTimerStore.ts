import * as Haptics from 'expo-haptics';
import { create } from 'zustand';

import { getKv, setKv } from '@/db/repos/settings';
import { cancelRestEnd, scheduleRestEnd } from '@/services/notifications';
import { useSettings } from './settingsStore';

/**
 * Rest timer as an absolute end timestamp: correct after backgrounding, and persisted so it
 * survives an app kill. The UI ticks locally; nothing here runs on an interval.
 */
interface RestState {
  endAt: number | null;
  duration: number;
  label: string;
  start: (seconds: number, label?: string) => void;
  adjust: (deltaSeconds: number) => void;
  stop: () => void;
  /** Called by the UI tick when time is up. */
  finish: () => void;
  hydrate: () => void;
}

const KV_KEY = 'rest_timer';
let notificationId: string | null = null;

function persist(endAt: number | null, duration: number, label: string) {
  setKv(KV_KEY, endAt === null ? null : JSON.stringify({ endAt, duration, label }));
}

function reschedule(endAt: number | null) {
  const previous = notificationId;
  notificationId = null;
  void cancelRestEnd(previous);
  if (endAt === null || !useSettings.getState().settings.restNotifications) return;
  void scheduleRestEnd((endAt - Date.now()) / 1000).then((id) => {
    notificationId = id;
  });
}

export const useRestTimer = create<RestState>((set, get) => ({
  endAt: null,
  duration: 0,
  label: '',
  start: (seconds, label = '') => {
    if (seconds <= 0) return;
    const endAt = Date.now() + seconds * 1000;
    set({ endAt, duration: seconds, label });
    persist(endAt, seconds, label);
    reschedule(endAt);
  },
  adjust: (delta) => {
    const { endAt, duration, label } = get();
    if (endAt === null) return;
    const nextEnd = Math.max(Date.now() + 1000, endAt + delta * 1000);
    const nextDuration = Math.max(1, duration + delta);
    set({ endAt: nextEnd, duration: nextDuration });
    persist(nextEnd, nextDuration, label);
    reschedule(nextEnd);
  },
  stop: () => {
    set({ endAt: null });
    persist(null, 0, '');
    reschedule(null);
  },
  finish: () => {
    if (get().endAt === null) return;
    set({ endAt: null });
    persist(null, 0, '');
    notificationId = null;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  },
  hydrate: () => {
    const raw = getKv(KV_KEY);
    if (raw === null) return;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) return;
      const endAt = 'endAt' in parsed && typeof parsed.endAt === 'number' ? parsed.endAt : null;
      const duration = 'duration' in parsed && typeof parsed.duration === 'number' ? parsed.duration : 0;
      const label = 'label' in parsed && typeof parsed.label === 'string' ? parsed.label : '';
      if (endAt !== null && endAt > Date.now()) set({ endAt, duration, label });
      else persist(null, 0, '');
    } catch {
      persist(null, 0, '');
    }
  },
}));
