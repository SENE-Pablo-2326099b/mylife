import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { memo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';

import { formatShortDate } from '@/domain/dates';
import { formatWeight } from '@/domain/math';
import type { SetType, WorkoutSet } from '@/domain/types';
import type { EntryFocus } from '@/state/entryStore';
import { useWorkoutStore } from '@/state/workoutStore';
import type { ExerciseItem } from '@/services/workoutService';
import { Glass } from '@/ui/components/Glass';
import { IconButton, Tap, Text } from '@/ui/components/primitives';
import { ActionSheet } from '@/ui/components/Sheet';
import { family, radius, shade, space, useTheme } from '@/ui/theme';

import { CHROME_FONT_SCALE, SetRow, useSetMetrics } from './SetRow';
import { SwapSheet } from './SwapSheet';

interface Props {
  workoutId: string;
  host: EntryFocus['host'];
  item: ExerciseItem;
  index: number;
  count: number;
  bodyweight: number | null;
  /** The exercise to do now: raised, lit glass. */
  current?: boolean;
  /** Session in progress: only the current exercise is unfolded, the others are one line. */
  live?: boolean;
  onLayoutY?: (weId: string, y: number) => void;
  onRowLayoutY?: (weId: string, setId: string, y: number) => void;
}

/** Ghost for a set: the n-th set of the same type last time (falls back to position). */
function ghostFor(item: ExerciseItem, set: WorkoutSet): WorkoutSet | undefined {
  const sameType = (type: SetType) => item.sets.filter((s) => s.setType === type);
  const n = sameType(set.setType).indexOf(set);
  const ghosts = item.ghost.filter((g) => g.setType === set.setType);
  return ghosts[n] ?? (n === -1 ? undefined : item.ghost[item.sets.indexOf(set)]);
}

/** "100×5 · 80×6 ×3": a finished exercise read in one line. */
function summarize(item: ExerciseItem): string {
  const lest = item.exercise.loadType === 'bodyweight';
  const parts: { text: string; n: number }[] = [];
  for (const s of item.sets.filter((x) => x.completed && x.setType !== 'warmup')) {
    const w = s.weight === null ? '?' : lest && s.weight === 0 ? 'PDC' : `${lest ? '+' : ''}${formatWeight(s.weight)}`;
    const text = `${w}×${s.reps ?? '?'}`;
    const last = parts[parts.length - 1];
    if (last !== undefined && last.text === text) last.n += 1;
    else parts.push({ text, n: 1 });
  }
  return parts.map((p) => (p.n > 1 ? `${p.text} ×${p.n}` : p.text)).join('  ·  ');
}

export const ExerciseCard = memo(function ExerciseCard({ workoutId, host, item, index, count, bodyweight, current = false, live = false, onLayoutY, onRowLayoutY }: Props) {
  const t = useTheme();
  const [menu, setMenu] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const store = useWorkoutStore.getState;
  const { exercise, we } = item;
  const isStrength = we.progressionType === 'top_set_backoff';
  const m = useSetMetrics();
  const { width } = useWindowDimensions();
  const narrow = width < 400;
  const bodyweightExercise = exercise.loadType === 'bodyweight';
  const bw = bodyweightExercise ? bodyweight : null;
  const done = item.sets.filter((s) => s.completed).length;
  const finished = item.sets.length > 0 && done === item.sets.length;
  const [expanded, setExpanded] = useState<boolean | null>(null);
  // In a live session the exercise to do now is unfolded and the rest folded; editing a past
  // session unfolds what is not finished. A tap on the header overrides either.
  const open = expanded ?? (live ? current : !finished);

  let number = 0;
  const numbers = item.sets.map((s) => (s.setType === 'warmup' ? 0 : ++number));

  const header = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: narrow ? space.md : space.lg - 2,
        paddingTop: open ? space.md + 2 : space.sm + 2,
        paddingBottom: open ? 0 : space.sm + 2,
        paddingRight: 0,
        gap: narrow ? space.sm : space.md,
      }}>
      <View
        style={{
          width: open ? 32 : 26,
          height: open ? 32 : 26,
          borderRadius: 16,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: finished ? t.success : current ? t.accentSoft : t.surfaceAlt,
          borderWidth: current && !finished ? 1 : 0,
          borderColor: `${t.accent}88`,
          boxShadow: shade(current && !finished ? `0px 0px 14px ${t.accentGlow}` : undefined),
        }}>
        {finished ? (
          <Ionicons name="checkmark" size={open ? 18 : 15} color={t.onSuccess} />
        ) : (
          <Text style={{ fontFamily: family.display, fontSize: 13, color: current ? t.accent : t.textSecondary }}>{index + 1}</Text>
        )}
      </View>
      <Pressable
        style={{ flex: 1, gap: 3, paddingVertical: 2 }}
        onPress={() => setExpanded(!open)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${exercise.name}, ${open ? 'replier' : 'déplier'}`}>
        <Text variant="title" numberOfLines={open ? 2 : 1} style={{ fontSize: open ? (narrow ? 17 : 18.5) : narrow ? 15.5 : 16.5, color: !open && finished ? t.textSecondary : t.text }}>
          {exercise.name}
        </Text>
        {item.replaces !== null && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Ionicons name="swap-horizontal" size={12} color={t.textMuted} />
            <Text variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
              à la place de {item.replaces}
            </Text>
          </View>
        )}
        {open || !finished ? (
          <>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
            <Text variant="small" tone="secondary" numeric numberOfLines={1}>
              {item.label}
              {!open && done > 0 ? ` · ${done}/${item.sets.length}` : ''}
            </Text>
            {open && item.hint !== null && (
              <Text variant="small" numeric style={{ color: t.success }}>
                ↑ {formatWeight(item.hint.to)} kg
              </Text>
            )}
          </View>
          {open && isStrength && item.reference !== null && (
            // Where the loads come from: % of the week × the reference 1RM (total mass for weighted lifts).
            <Text variant="caption" tone="muted" numeric numberOfLines={2}>
              {bodyweightExercise && bw !== null
                ? `% du 1RM ${formatWeight(Math.round(item.reference.value * 10) / 10)} kg = +${formatWeight(Math.round((item.reference.value - bw) * 10) / 10)} lest + ${formatWeight(bw)} PDC`
                : `% du 1RM ${formatWeight(Math.round(item.reference.value * 10) / 10)} kg`}
              {item.reference.basis.kind === 'manual' ? ' (ton 1RM)' : ' (estimé)'}
            </Text>
          )}
          </>
        ) : (
          <Text variant="small" tone="muted" numeric numberOfLines={1}>
            {summarize(item)}
          </Text>
        )}
      </Pressable>
      <IconButton icon="ellipsis-horizontal" label={`Options ${exercise.name}`} onPress={() => setMenu(true)} size={20} hitSize={48} />
    </View>
  );

  return (
    <View onLayout={onLayoutY === undefined ? undefined : (e) => onLayoutY(we.id, e.nativeEvent.layout.y)}>
      <Glass level={current && open ? 'raised' : 'pane'} glow={current && open} radius={radius.lg} contentStyle={{ overflow: 'hidden', borderRadius: radius.lg }}>
        {header}

        {open && (
          <>
            {(we.notes !== '' || editingNotes) && (
              <TextInput
                value={we.notes}
                onChangeText={(text) => store().setExerciseNotes(workoutId, we.id, text)}
                onBlur={() => setEditingNotes(false)}
                autoFocus={editingNotes}
                placeholder="Note (réglage siège, prise, sensation…)"
                placeholderTextColor={t.textMuted}
                multiline
                style={{
                  marginHorizontal: space.lg - 4,
                  marginTop: space.md,
                  paddingHorizontal: space.md,
                  paddingVertical: space.sm,
                  borderRadius: radius.sm,
                  backgroundColor: t.surfaceAlt,
                  color: t.text,
                  fontSize: 14,
                  fontFamily: family.regular,
                  fontStyle: 'italic',
                }}
              />
            )}

            <View style={{ flexDirection: 'row', paddingHorizontal: m.pad, marginTop: space.md, marginBottom: 2, gap: m.gap }}>
              <View style={{ width: m.badge }} />
              <Text variant="label" tone="muted" style={{ flex: 1, fontSize: 10 }} numberOfLines={1} maxFontSizeMultiplier={CHROME_FONT_SCALE}>
                {!m.ghost ? '' : item.percents !== null ? '% 1RM' : item.ghostDate === null || narrow ? 'Préc.' : `Préc. · ${formatShortDate(item.ghostDate)}`}
              </Text>
              <Text variant="label" tone="muted" style={{ width: m.weight, textAlign: 'center', fontSize: 10 }} maxFontSizeMultiplier={CHROME_FONT_SCALE}>
                {bodyweightExercise ? '+kg' : 'kg'}
              </Text>
              <Text variant="label" tone="muted" style={{ width: m.reps, textAlign: 'center', fontSize: 10 }} maxFontSizeMultiplier={CHROME_FONT_SCALE}>
                reps
              </Text>
              <View style={{ width: m.check }} />
            </View>

            {item.sets.map((s, i) => (
              <SetRow
                key={s.id}
                workoutId={workoutId}
                host={host}
                set={s}
                number={numbers[i] ?? 0}
                ghost={ghostFor(item, s)}
                percent={item.percents === null ? undefined : s.setType === 'top_set' ? item.percents.top : s.setType === 'backoff' ? item.percents.backoff : null}
                showSpeed={isStrength && s.setType === 'top_set'}
                bodyweightExercise={bodyweightExercise}
                prThreshold={item.historicBest}
                bodyweight={bw}
                onLayoutY={onRowLayoutY === undefined ? undefined : (setId, y) => onRowLayoutY(we.id, setId, y)}
              />
            ))}

            <View style={{ flexDirection: 'row', gap: space.sm, padding: space.md, paddingTop: space.sm }}>
              <Tap
                onPress={() => store().addSet(workoutId, we.id)}
                scaleTo={0.96}
                highlightRadius={radius.md}
                accessibilityLabel="Ajouter une série"
                style={{
                  flex: 1,
                  height: 40,
                  borderRadius: radius.md,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  borderWidth: StyleSheet.hairlineWidth * 2,
                  borderStyle: 'dashed',
                  borderColor: t.glass.raised.rim,
                }}>
                <Ionicons name="add" size={18} color={t.textSecondary} />
                <Text variant="bodyStrong" tone="secondary">
                  Série
                </Text>
              </Tap>
            </View>
          </>
        )}
      </Glass>

      <SwapSheet visible={swapping} onClose={() => setSwapping(false)} workoutId={workoutId} item={item} />
      <ActionSheet
        visible={menu}
        onClose={() => setMenu(false)}
        title={exercise.name}
        actions={[
          { label: 'Remplacer l’exercice', icon: 'swap-horizontal', onPress: () => setSwapping(true) },
          { label: 'Ajouter un échauffement', icon: 'flame-outline', onPress: () => (setExpanded(true), store().addWarmup(workoutId, we.id)) },
          { label: we.notes === '' ? 'Ajouter une note' : 'Modifier la note', icon: 'create-outline', onPress: () => (setExpanded(true), setEditingNotes(true)) },
          { label: 'Monter', icon: 'arrow-up', onPress: () => store().moveExercise(workoutId, we.id, -1), hidden: index === 0 },
          { label: 'Descendre', icon: 'arrow-down', onPress: () => store().moveExercise(workoutId, we.id, 1), hidden: index === count - 1 },
          { label: 'Historique et stats', icon: 'stats-chart', onPress: () => router.push(`/exercise/${exercise.id}`) },
          { label: 'Retirer de la séance', icon: 'trash-outline', destructive: true, onPress: () => store().removeExercise(workoutId, we.id) },
        ]}
      />
    </View>
  );
});
