import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import type { Exercise, Intention, ProgressionType, TemplateExercise } from '@/domain/types';
import { getExercise, listExercises } from '@/db/repos/exercises';
import {
  addTemplateExercise,
  archiveTemplateUndoable,
  getTemplate,
  listTemplateExercises,
  removeTemplateExerciseUndoable,
  renameTemplate,
  reorderTemplateExercises,
  updateTemplateExercise,
} from '@/db/repos/templates';
import { beginWorkout } from '@/services/startFlow';
import { usePicker } from '@/state/pickerStore';
import { showToast } from '@/state/toastStore';
import { AutoStepper, Button, Card, Field, Segmented, StepperRow, Text } from '@/ui/components/primitives';
import { goBack, NotFoundScreen, Screen } from '@/ui/components/Screen';
import { INTENTION_LABEL } from '@/ui/labels';
import { family, radius, space, useTheme } from '@/ui/theme';
import { useLive } from '@/ui/useLive';

function TemplateExerciseEditor({ te, exercise, onClose }: { te: TemplateExercise; exercise: Exercise; onClose: () => void }) {
  const save = (patch: Partial<TemplateExercise>) => updateTemplateExercise({ ...te, ...patch });
  const strength = (te.progressionType ?? exercise.progressionType) === 'top_set_backoff';
  return (
    <View style={{ gap: space.md, paddingTop: space.md }}>
      <View style={{ gap: space.xs }}>
        <Text variant="label" tone="secondary">
          Progression dans cette séance
        </Text>
        <Segmented<'auto' | ProgressionType>
          options={[
            { value: 'auto', label: `Exo (${exercise.progressionType === 'top_set_backoff' ? 'top set' : 'double'})` },
            { value: 'top_set_backoff', label: 'Top set' },
            { value: 'double_progression', label: 'Double' },
          ]}
          value={te.progressionType ?? 'auto'}
          onChange={(v) => save({ progressionType: v === 'auto' ? null : v })}
        />
      </View>
      <View style={{ gap: space.xs }}>
        <Text variant="label" tone="secondary">
          Intention (règle le repos)
        </Text>
        <Segmented<Intention>
          options={[
            { value: 'power', label: INTENTION_LABEL.power },
            { value: 'strength', label: INTENTION_LABEL.strength },
            { value: 'hypertrophy', label: 'Hypertro.' },
          ]}
          value={te.intention}
          onChange={(intention) => save({ intention })}
        />
      </View>
      {strength ? (
        <>
          <View style={{ flexDirection: 'row', gap: space.md }}>
            <View style={{ flex: 1 }}>
              <AutoStepper label="Top sets" value={te.topSets} fallback={1} min={1} max={5} onChange={(topSets) => save({ topSets })} />
            </View>
            <View style={{ flex: 1 }}>
              <AutoStepper label="Backoffs" value={te.backoffSets} fallback={3} min={0} max={8} onChange={(backoffSets) => save({ backoffSets })} />
            </View>
          </View>
          <Text variant="caption" tone="muted">
            Reps et charges (% du 1RM) : réglées dans le cycle, semaine par semaine (Planning → Programme → cycle).
          </Text>
        </>
      ) : (
        <>
          <StepperRow label="Séries" value={te.targetSets} min={1} max={10} onChange={(targetSets) => save({ targetSets })} />
          <View style={{ flexDirection: 'row', gap: space.md }}>
            <View style={{ flex: 1 }}>
              <AutoStepper label="Reps min" value={te.repMin} fallback={exercise.repRangeMin} min={1} max={50} onChange={(repMin) => save({ repMin })} />
            </View>
            <View style={{ flex: 1 }}>
              <AutoStepper label="Reps max" value={te.repMax} fallback={exercise.repRangeMax} min={1} max={50} onChange={(repMax) => save({ repMax })} />
            </View>
          </View>
        </>
      )}
      <Button label="OK" variant="secondary" size="sm" onPress={onClose} />
    </View>
  );
}

function summary(te: TemplateExercise, ex: Exercise): string {
  if ((te.progressionType ?? ex.progressionType) === 'top_set_backoff') {
    if (te.topSets === null && te.backoffSets === null) return 'Top set + backoff, selon le cycle';
    const top = te.topSets === null ? 'top set du cycle' : `${te.topSets} top set${te.topSets > 1 ? 's' : ''}`;
    const back = te.backoffSets === null ? 'backoffs du cycle' : `${te.backoffSets} backoff${te.backoffSets > 1 ? 's' : ''}`;
    return `${top} + ${back} · ${INTENTION_LABEL[te.intention]}`;
  }
  return `${te.targetSets}×${te.repMin ?? ex.repRangeMin}\u2011${te.repMax ?? ex.repRangeMax} · ${INTENTION_LABEL[te.intention]}`;
}

export default function TemplateEditor() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const openPicker = usePicker((s) => s.open);
  const [open, setOpen] = useState<string | null>(null);
  const data = useLive(() => {
    const exercises = new Map(listExercises(true).map((e) => [e.id, e]));
    return { template: getTemplate(id), items: listTemplateExercises(id), exercises };
  }, [id]);
  const [name, setName] = useState(data.template?.name ?? '');

  if (data.template === null) return <NotFoundScreen title="Séance type introuvable" />;

  const move = (index: number, dir: -1 | 1) => {
    const ids = data.items.map((i) => i.id);
    const other = index + dir;
    const a = ids[index];
    const b = ids[other];
    if (a === undefined || b === undefined) return;
    ids[index] = b;
    ids[other] = a;
    reorderTemplateExercises(ids);
  };

  return (
    <Screen
      stack
      title={name.trim() === '' ? 'Séance type' : name}
      mood="planning"
      maxWidth={760}
      footer={data.items.length > 0 ? <Button label="Démarrer cette séance" icon="play" size="lg" onPress={() => beginWorkout({ templateId: id })} /> : undefined}>
      <Field
        value={name}
        onChangeText={setName}
        onBlur={() => name.trim() !== '' && renameTemplate(id, name)}
        onSubmitEditing={() => name.trim() !== '' && renameTemplate(id, name)}
        returnKeyType="done"
        multiline
        submitBehavior="blurAndSubmit"
        style={{ fontSize: 22, fontFamily: family.display, minHeight: 54, paddingVertical: space.sm + 2 }}
        placeholder="Nom de la séance"
      />

      <View style={{ gap: space.sm, marginTop: space.lg }}>
        {data.items.map((te, index) => {
          const ex = data.exercises.get(te.exerciseId);
          if (ex === undefined) return null;
          const expanded = open === te.id;
          return (
            <Card key={te.id} style={{ paddingVertical: space.md }}>
              <Pressable onPress={() => setOpen(expanded ? null : te.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <View style={{ width: 26, height: 26, borderRadius: radius.pill, backgroundColor: t.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
                  <Text variant="caption" tone="secondary">
                    {index + 1}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong">{ex.name}</Text>
                  <Text variant="small" tone="secondary" numberOfLines={1}>
                    {summary(te, ex)}
                  </Text>
                </View>
                <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={t.textMuted} />
              </Pressable>
              {expanded && (
                <>
                  <TemplateExerciseEditor te={te} exercise={ex} onClose={() => setOpen(null)} />
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm }}>
                    {index > 0 && <Button label="Monter" icon="arrow-up" variant="ghost" size="sm" onPress={() => move(index, -1)} />}
                    {index < data.items.length - 1 && <Button label="Descendre" icon="arrow-down" variant="ghost" size="sm" onPress={() => move(index, 1)} />}
                    <Button
                      label="Remplacer"
                      icon="swap-horizontal"
                      variant="ghost"
                      size="sm"
                      onPress={() =>
                        openPicker('Remplacer par…', (exerciseId) =>
                          updateTemplateExercise({ ...te, exerciseId, repMin: null, repMax: null, backoffPercent: null }),
                        )
                      }
                    />
                    <Button
                      label="Retirer"
                      icon="trash-outline"
                      variant="ghost"
                      size="sm"
                      onPress={() => {
                        const undo = removeTemplateExerciseUndoable(te.id);
                        setOpen(null);
                        showToast({ message: `${ex.name} retiré de la séance type`, actionLabel: 'Annuler', onAction: undo });
                      }}
                    />
                  </View>
                </>
              )}
            </Card>
          );
        })}
      </View>

      <Button
        label="Ajouter un exercice"
        icon="add"
        variant="ghost"
        style={{ marginTop: space.md }}
        onPress={() =>
          openPicker('Ajouter à la séance', (exerciseId) => {
            const ex = getExercise(exerciseId);
            if (ex !== null) addTemplateExercise(id, ex);
          })
        }
      />

      <Button
        label="Archiver la séance type"
        icon="archive-outline"
        variant="danger"
        size="sm"
        style={{ marginTop: space.xl, alignSelf: 'center' }}
        onPress={() => {
          const undo = archiveTemplateUndoable(id);
          showToast({ message: 'Séance type archivée — l’historique est conservé', actionLabel: 'Annuler', onAction: undo }, 6000);
          goBack();
        }}
      />
    </Screen>
  );
}
