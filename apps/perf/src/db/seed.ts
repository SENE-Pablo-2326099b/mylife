import { SEEDS } from '@/domain/seedLibrary';

import { db } from './db';
import { createExercise, exerciseCount } from './repos/exercises';

export function seedIfEmpty(defaultBackoff = 0.8): void {
  if (exerciseCount() > 0) return;
  db().transaction(() => {
    for (const s of SEEDS) {
      createExercise(
        {
          name: s.name,
          primaryMuscles: s.p,
          secondaryMuscles: s.s ?? [],
          equipment: s.eq,
          unilateral: s.uni ?? false,
          loadType: s.load ?? 'external',
          category: s.cat,
          progressionType: s.prog ?? 'double_progression',
          backoffPercent: defaultBackoff,
          repRangeMin: s.reps?.[0] ?? 8,
          repRangeMax: s.reps?.[1] ?? 12,
          weightIncrement: s.inc ?? null,
          isCustom: false,
          notes: '',
        },
        s.id,
      );
    }
  });
}
