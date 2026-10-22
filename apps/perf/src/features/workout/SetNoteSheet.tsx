import { useState } from 'react';
import { View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';

import { formatWeight } from '@/domain/math';
import { setTypesFor } from '@/domain/sets';
import type { BarSpeed, SetType } from '@/domain/types';
import { useSetMenu } from '@/state/setNoteStore';
import { useWorkoutStore } from '@/state/workoutStore';
import { Button, Chip, Field, Text, Toggle } from '@/ui/components/primitives';
import { ActionList, Sheet } from '@/ui/components/Sheet';
import { SPEED_LABEL } from '@/ui/labels';
import { space } from '@/ui/theme';

const TYPE_SHORT: Record<SetType, string> = { top_set: 'Top set', backoff: 'Backoff', working: 'Série', drop: 'Drop', warmup: 'Échauff.' };
const SPEEDS: readonly BarSpeed[] = ['fast', 'normal', 'slow'];

/** Quick notes athletes actually write on a set. */
const QUICK = ['Douleur', 'Gêne articulaire', 'Prise large', 'Prise serrée', 'Sangles', 'Pause en bas', 'Tempo lent', 'Rep ratée', 'Avec aide', 'Très facile'];

function useTargetSet(target: { workoutId: string; setId: string } | null) {
  return useWorkoutStore(
    useShallow((s) => {
      if (target === null) return null;
      const item = s.docs[target.workoutId]?.items.find((i) => i.sets.some((x) => x.id === target.setId));
      const set = item?.sets.find((x) => x.id === target.setId);
      if (item === undefined || set === undefined) return null;
      const n = item.sets.filter((x) => x.setType !== 'warmup').indexOf(set) + 1;
      const load = set.weight ?? set.targetWeight;
      const reps = set.reps ?? set.targetReps;
      return {
        title: `${item.exercise.name} · ${set.setType === 'warmup' ? 'échauffement' : `série ${n}`}${load === null ? '' : ` · ${formatWeight(load)} kg`}${reps === null ? '' : ` × ${reps}`}`,
        note: set.note,
        setType: set.setType,
        barSpeed: set.barSpeed,
        isTest: set.isTest,
        progression: item.we.progressionType,
      };
    }),
  );
}

function NoteEditor({ workoutId, setId, initial, onClose }: { workoutId: string; setId: string; initial: string; onClose: () => void }) {
  const [text, setText] = useState(initial);
  const save = (value: string) => {
    useWorkoutStore.getState().setNote(workoutId, setId, value);
    onClose();
  };
  return (
    <View style={{ paddingHorizontal: space.lg, gap: space.md }}>
      <Field value={text} onChangeText={setText} placeholder="Ex. genou gauche sensible, prise large…" multiline autoFocus maxLength={240} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {QUICK.map((q) => (
          <Chip key={q} label={q} small onPress={() => setText((t) => (t.trim() === '' ? q : `${t.trim()}, ${q.toLowerCase()}`))} />
        ))}
      </View>
      <Button label="Enregistrer la note" icon="checkmark" onPress={() => save(text)} />
      {initial !== '' && <Button label="Supprimer la note" variant="ghost" size="sm" onPress={() => save('')} />}
    </View>
  );
}

/** Small section label inside the set sheet. */
function Label({ children }: { children: string }) {
  return (
    <Text variant="label" tone="muted">
      {children}
    </Text>
  );
}

/**
 * One sheet for the whole session: everything rare about a set (type, bar speed, test, note,
 * delete), opened by a tap on its number or a long press on the row. The note editor has its own
 * mode. Notes stay attached to that set in the history.
 */
export function SetNoteSheet() {
  const target = useSetMenu((s) => s.target);
  const open = useSetMenu((s) => s.open);
  const close = useSetMenu((s) => s.close);
  const info = useTargetSet(target);
  if (target === null || info === null) return null;
  const { workoutId, setId } = target;
  const store = useWorkoutStore.getState();
  if (target.mode === 'menu') {
    const strength = info.progression === 'top_set_backoff';
    return (
      <Sheet visible onClose={close} title={info.title}>
        <View style={{ paddingHorizontal: space.lg, gap: space.lg, paddingBottom: space.sm }}>
          <View style={{ gap: space.sm }}>
            <Label>Type de série</Label>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {setTypesFor(info.progression).map((type) => (
                <Chip key={type} label={TYPE_SHORT[type]} selected={info.setType === type} onPress={() => store.setSetType(workoutId, setId, type)} />
              ))}
            </View>
          </View>
          {strength && info.setType !== 'warmup' && (
            <View style={{ gap: space.sm }}>
              <Label>Vitesse de barre</Label>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                {SPEEDS.map((speed) => (
                  <Chip key={speed} label={SPEED_LABEL[speed]} selected={info.barSpeed === speed} onPress={() => store.setBarSpeed(workoutId, setId, speed)} />
                ))}
              </View>
            </View>
          )}
          {strength && info.setType !== 'warmup' && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong">Série test</Text>
                <Text variant="caption" tone="muted">
                  Effort maximal : sert à recaler le 1RM de référence.
                </Text>
              </View>
              <Toggle value={info.isTest} onValueChange={() => store.toggleTest(workoutId, setId)} label="Série test" />
            </View>
          )}
        </View>
        <ActionList
          onClose={close}
          actions={[
            { label: info.note === '' ? 'Ajouter une note' : 'Modifier la note', icon: 'chatbubble-ellipses-outline', onPress: () => setTimeout(() => open(workoutId, setId, 'note'), 250) },
            { label: 'Supprimer la série', icon: 'trash-outline', destructive: true, onPress: () => store.removeSet(workoutId, setId) },
          ]}
        />
      </Sheet>
    );
  }
  return (
    <Sheet visible onClose={close} title="Note sur la série">
      <Text variant="small" tone="secondary" style={{ paddingHorizontal: space.lg, marginBottom: space.sm }}>
        {info.title}
      </Text>
      <NoteEditor key={setId} workoutId={workoutId} setId={setId} initial={info.note} onClose={close} />
    </Sheet>
  );
}
