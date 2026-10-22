import { useState } from 'react';
import { Pressable, Switch, View } from 'react-native';

import { EQUIPMENTS, type Equipment } from '@/domain/types';
import { getExercise } from '@/db/repos/exercises';
import { alternativesFor } from '@/db/repos/substitutions';
import { createVariant, type ExerciseItem } from '@/services/workoutService';
import { usePicker } from '@/state/pickerStore';
import { showToast } from '@/state/toastStore';
import { useWorkoutStore } from '@/state/workoutStore';
import { Button, Chip, Field, Icon, Text } from '@/ui/components/primitives';
import { Sheet } from '@/ui/components/Sheet';
import { EQUIPMENT_LABEL, MUSCLE_LABEL } from '@/ui/labels';
import { space, useTheme } from '@/ui/theme';

/**
 * Mid-session swap in 2 taps: what you already did instead of this exercise comes first, then
 * exercises for the same muscles. A new variant (e.g. the machine version) is created in one go and
 * inherits muscles, rep range and progression — its loads and stats stay separate.
 */
export function SwapSheet({ visible, onClose, workoutId, item }: { visible: boolean; onClose: () => void; workoutId: string; item: ExerciseItem }) {
  const t = useTheme();
  const openPicker = usePicker((s) => s.open);
  const [alsoTemplate, setAlsoTemplate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [equipment, setEquipment] = useState<Equipment>('machine');
  const { exercise, we } = item;
  const alternatives = visible ? alternativesFor(exercise, 10) : [];
  const done = item.sets.some((s) => s.completed);

  const swap = (exerciseId: string) => {
    useWorkoutStore.getState().replaceExercise(workoutId, we.id, exerciseId, { alsoTemplate });
    const target = getExercise(exerciseId);
    showToast({ message: `${exercise.name} → ${target?.name ?? 'nouvel exercice'}${alsoTemplate ? ' (séance type mise à jour)' : ''}` });
    setCreating(false);
    setName('');
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={`Remplacer ${exercise.name}`}>
      <View style={{ paddingHorizontal: space.lg, gap: space.sm, paddingBottom: space.sm }}>
        {done && (
          <Text variant="small" tone="secondary">
            Les séries déjà faites restent sur {exercise.name} ; la suite part sur le nouvel exercice.
          </Text>
        )}
        {we.templateExerciseId !== null && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Text style={{ flex: 1 }}>Remplacer aussi dans la séance type</Text>
            <Switch value={alsoTemplate} onValueChange={setAlsoTemplate} trackColor={{ true: t.accent, false: t.surfaceAlt }} thumbColor={t.knob} />
          </View>
        )}
      </View>

      {alternatives.map(({ exercise: alt, uses }) => (
        <Pressable
          key={alt.id}
          onPress={() => swap(alt.id)}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.md,
            paddingHorizontal: space.lg,
            minHeight: 56,
            backgroundColor: pressed ? t.surfacePressed : 'transparent',
          })}>
          <Icon name={uses > 0 ? 'time-outline' : 'swap-horizontal'} color={uses > 0 ? t.accent : t.textSecondary} />
          <View style={{ flex: 1 }}>
            <Text variant="bodyStrong" numberOfLines={1}>
              {alt.name}
            </Text>
            <Text variant="small" tone="secondary" numberOfLines={1}>
              {uses > 0 ? `Déjà fait à la place · ${uses}×` : alt.primaryMuscles.map((m) => MUSCLE_LABEL[m]).join(', ')} · {EQUIPMENT_LABEL[alt.equipment]}
            </Text>
          </View>
        </Pressable>
      ))}

      <Pressable
        onPress={() => {
          onClose();
          openPicker(`Remplacer ${exercise.name}`, (id) => useWorkoutStore.getState().replaceExercise(workoutId, we.id, id, { alsoTemplate }));
        }}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, minHeight: 52, backgroundColor: pressed ? t.surfacePressed : 'transparent' })}>
        <Icon name="search" color={t.textSecondary} />
        <Text variant="bodyStrong">Chercher dans la bibliothèque…</Text>
      </Pressable>

      {!creating ? (
        <Pressable
          onPress={() => {
            setName(`${exercise.name} (machine)`);
            setCreating(true);
          }}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, minHeight: 52, backgroundColor: pressed ? t.surfacePressed : 'transparent' })}>
          <Icon name="add-circle-outline" color={t.accent} />
          <Text variant="bodyStrong" tone="accent">
            Nouvelle variante (autre machine…)
          </Text>
        </Pressable>
      ) : (
        <View style={{ padding: space.lg, gap: space.md }}>
          <Field label="Nom de la variante" value={name} onChangeText={setName} autoFocus selectTextOnFocus />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {EQUIPMENTS.map((eq) => (
              <Chip key={eq} label={EQUIPMENT_LABEL[eq]} small tone={t.info} selected={equipment === eq} onPress={() => setEquipment(eq)} />
            ))}
          </View>
          <Text variant="small" tone="muted">
            Mêmes muscles, fourchette de reps et progression que {exercise.name} ; charges et stats séparées.
          </Text>
          <Button
            label="Créer et remplacer"
            icon="swap-horizontal"
            disabled={name.trim() === ''}
            onPress={() => swap(createVariant(exercise, name.trim(), equipment))}
          />
        </View>
      )}
    </Sheet>
  );
}
