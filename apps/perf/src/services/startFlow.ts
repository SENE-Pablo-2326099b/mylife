import { router } from 'expo-router';

import { today } from '@/domain/dates';
import { getActiveWorkout, updateWorkoutMeta } from '@/db/repos/workouts';
import { showToast } from '@/state/toastStore';
import { useWorkoutStore } from '@/state/workoutStore';

import { startWorkout, type StartOptions } from './workoutService';

/** Starts (or resumes) the session and brings the user to Today. One active workout at a time. */
export function beginWorkout(opts: Omit<StartOptions, 'date'>): void {
  const active = getActiveWorkout();
  if (active !== null) {
    showToast({ message: `« ${active.name} » est déjà en cours` });
    router.navigate('/');
    return;
  }
  const id = startWorkout({ ...opts, date: today() });
  useWorkoutStore.getState().load(id);
  router.navigate('/');
}

/** Logs a session after the fact (forgotten in the gym): created as completed, opened for editing. */
export function logPastWorkout(date: string, templateId: string | null = null): void {
  const id = startWorkout({ date, templateId });
  updateWorkoutMeta(id, { status: 'completed', endedAt: Date.now() });
  router.push(`/workout/${id}`);
}
