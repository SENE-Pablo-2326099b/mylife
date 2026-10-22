import { router } from 'expo-router';

import { listExercises } from '@/db/repos/exercises';
import { exerciseActivity } from '@/db/repos/history';
import { ExerciseList } from '@/features/exercises/ExerciseList';
import { usePicker } from '@/state/pickerStore';
import { Button } from '@/ui/components/primitives';
import { Screen } from '@/ui/components/Screen';
import { useLive } from '@/ui/useLive';

export default function ExercisePicker() {
  const title = usePicker((s) => s.title);
  const pick = usePicker((s) => s.pick);
  const exercises = useLive(() => listExercises(), []);
  const lastDates = useLive(() => new Map(exerciseActivity().map((a) => [a.exerciseId, a.lastDate])), []);
  return (
    <Screen title={title === '' ? 'Exercices' : title} stack modal scroll={false} mood="library">
      <ExerciseList
        exercises={exercises}
        lastDates={lastDates}
        onPress={(e) => pick(e.id)}
        autoFocus
        header={<Button label="Créer un exercice" icon="add" variant="ghost" size="sm" style={{ alignSelf: 'flex-start' }} onPress={() => router.push('/exercise-edit')} />}
      />
    </Screen>
  );
}
