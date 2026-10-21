import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { getWorkout, settleSetsOnFinish } from '@/db/repos/workouts';
import { WorkoutView } from '@/features/workout/WorkoutView';
import { useWorkoutStore } from '@/state/workoutStore';
import { NotFoundScreen } from '@/ui/components/Screen';

/** Past workout: same logging UI, editable. The active workout always lives in Today. */
export default function WorkoutScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // Checked once on open: a workout discarded from this screen navigates away by itself.
  const [missing] = useState(() => getWorkout(id) === null);

  useEffect(() => {
    if (missing) return;
    const w = getWorkout(id);
    if (w?.status === 'active') {
      router.replace('/');
      return;
    }
    useWorkoutStore.getState().load(id);
    return () => {
      // Leaving the editor: settle sets like a finished workout and drop the in-memory copy.
      if (getWorkout(id)?.status === 'completed') settleSetsOnFinish(id, Date.now());
      useWorkoutStore.getState().unload(id);
    };
  }, [id, missing]);

  if (missing) return <NotFoundScreen title="Séance introuvable" />;
  return <WorkoutView workoutId={id} host="screen" />;
}
