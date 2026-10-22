import Ionicons from '@expo/vector-icons/Ionicons';
import { useKeepAwake } from 'expo-keep-awake';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, TextInput, View, type NativeScrollEvent, type NativeSyntheticEvent, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatDuration, formatLongDate } from '@/domain/dates';
import { restSeconds } from '@/domain/rest';
import type { ExerciseItem } from '@/services/workoutService';
import { useEntry } from '@/state/entryStore';
import { usePicker } from '@/state/pickerStore';
import { useRestTimer } from '@/state/restTimerStore';
import { useSettings } from '@/state/settingsStore';
import { useSessionSummary } from '@/state/summaryStore';
import { useWorkoutStore } from '@/state/workoutStore';
import { backdropScroll, setMood } from '@/ui/components/Backdrop';
import { Glass } from '@/ui/components/Glass';
import { Button, Field, IconButton, Tap, Text } from '@/ui/components/primitives';
import { useGutter } from '@/ui/components/Screen';
import { ActionSheet, Sheet } from '@/ui/components/Sheet';
import { useBreakpoint, useDockInset } from '@/ui/responsive';
import { family, radius, space, useTheme } from '@/ui/theme';
import { useToday } from '@/ui/useToday';

import { ExerciseCard } from './ExerciseCard';
import { Keypad } from './Keypad';
import { RestTimerBar } from './RestTimerBar';
import { SetNoteSheet } from './SetNoteSheet';

function KeepAwake() {
  useKeepAwake();
  return null;
}

function Elapsed({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return (
    <Text variant="small" tone="secondary" numeric>
      {formatDuration(now - startedAt)}
    </Text>
  );
}

/** The exercise to do now: the first one with a set left. */
function currentIndex(items: readonly ExerciseItem[]): number {
  return items.findIndex((i) => i.sets.some((s) => !s.completed));
}

/** Desktop: the plan of the session at a glance, each line jumps to its card. */
function SessionPlan({ items, onJump }: { items: readonly ExerciseItem[]; onJump: (weId: string) => void }) {
  const t = useTheme();
  const cur = currentIndex(items);
  return (
    <View style={{ gap: 2 }}>
      {items.map((item, i) => {
        const done = item.sets.filter((s) => s.completed).length;
        const total = item.sets.length;
        const finished = total > 0 && done === total;
        return (
          <Tap
            key={item.we.id}
            onPress={() => onJump(item.we.id)}
            scaleTo={0.98}
            highlightRadius={radius.sm}
            style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 8, paddingHorizontal: space.sm, borderRadius: radius.sm, backgroundColor: i === cur ? t.accentSoft : 'transparent' }}>
            <Ionicons name={finished ? 'checkmark-circle' : i === cur ? 'radio-button-on' : 'ellipse-outline'} size={16} color={finished || i === cur ? t.accent : t.textMuted} />
            <Text variant="small" style={{ flex: 1, color: finished ? t.textSecondary : t.text }} numberOfLines={1}>
              {item.exercise.name}
            </Text>
            <Text variant="caption" tone="muted" numeric>
              {done}/{total}
            </Text>
          </Tap>
        );
      })}
    </View>
  );
}

/**
 * The logging screen. Used for the active workout (Today tab) and for editing a past workout
 * (pushed screen). Phones: one column, keypad in the dock (or docked at the bottom when pushed).
 * Desktop: cards on the left, a floating session panel on the right (plan, timer, keypad).
 */
export function WorkoutView({ workoutId, host }: { workoutId: string; host: 'tabs' | 'screen' }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const bp = useBreakpoint();
  const wide = bp === 'expanded';
  const narrow = useWindowDimensions().width < 400;
  const gutter = useGutter();
  const dockInset = useDockInset();
  const doc = useWorkoutStore((s) => s.docs[workoutId]);
  const keepAwake = useSettings((s) => s.settings.keepAwake);
  const openPicker = usePicker((s) => s.open);
  const focusedSetId = useEntry((s) => (s.focus?.host === host ? s.focus.setId : null));
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const day = useToday();

  const scrollRef = useRef<ScrollView>(null);
  const listY = useRef(0);
  const cardY = useRef(new Map<string, number>());
  const rowY = useRef(new Map<string, { weId: string; y: number }>());

  useFocusEffect(
    useCallback(() => {
      setMood('session');
    }, []),
  );

  useEffect(() => {
    if (useWorkoutStore.getState().docs[workoutId] === undefined) useWorkoutStore.getState().load(workoutId);
  }, [workoutId]);

  // Close the keypad when leaving the screen.
  useEffect(() => () => useEntry.getState().close(), []);

  // Keep the focused row visible above the keypad.
  useEffect(() => {
    if (focusedSetId === null) return;
    const row = rowY.current.get(focusedSetId);
    if (row === undefined) return;
    const y = listY.current + (cardY.current.get(row.weId) ?? 0) + row.y;
    const id = setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, y - 160), animated: true }), 60);
    return () => clearTimeout(id);
  }, [focusedSetId]);

  const onCardLayout = useCallback((weId: string, y: number) => {
    cardY.current.set(weId, y);
  }, []);
  const onRowLayout = useCallback((weId: string, setId: string, y: number) => {
    rowY.current.set(setId, { weId, y });
  }, []);
  const jumpTo = useCallback((weId: string) => {
    scrollRef.current?.scrollTo({ y: Math.max(0, listY.current + (cardY.current.get(weId) ?? 0) - 24), animated: true });
  }, []);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    backdropScroll.value = e.nativeEvent.contentOffset.y;
  }, []);

  if (doc === undefined) return <View style={{ flex: 1 }} />;
  const { workout, items } = doc;
  const isActive = workout.status === 'active';
  const store = useWorkoutStore.getState();
  const doneSets = items.reduce((n, i) => n + i.sets.filter((s) => s.completed).length, 0);
  const totalSets = items.reduce((n, i) => n + i.sets.length, 0);
  const current = currentIndex(items);
  const phaseLabel = workout.weekIndex === null ? null : workout.isDeload ? 'Deload' : `Semaine ${workout.weekIndex}`;
  const keypadHere = focusedSetId !== null && (host === 'screen' || wide);

  const startManualRest = () => {
    const settings = useSettings.getState().settings;
    const last = items
      .flatMap((i) => i.sets.filter((s) => s.completed).map((s) => ({ i, s })))
      .sort((a, b) => (b.s.completedAt ?? 0) - (a.s.completedAt ?? 0))[0];
    const seconds = last === undefined ? settings.rest.byIntention.hypertrophy : restSeconds(settings.rest, last.i.exercise.category, last.i.we.intention, last.s.setType);
    useRestTimer.getState().start(Math.max(seconds, 30), last?.i.exercise.name ?? 'Repos');
  };

  const finish = () => {
    useEntry.getState().close();
    store.finish(workoutId);
    useSessionSummary.getState().show(workoutId);
  };

  const progress = totalSets === 0 ? 0 : doneSets / totalSets;
  const header = (
    <View style={{ gap: space.sm, paddingHorizontal: wide ? 0 : space.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        {host === 'screen' && <IconButton icon="chevron-back" label="Retour" color={t.text} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />}
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text variant="title" numberOfLines={1} onPress={() => (setNameDraft(workout.name), setRenaming(true))} style={{ fontSize: narrow ? 20 : 22 }}>
            {workout.name}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Text variant="small" tone="secondary" numberOfLines={1} style={{ flexShrink: 1 }}>
              {isActive ? (phaseLabel ?? 'Séance libre') : formatLongDate(workout.date)}
              {isActive && phaseLabel !== null && doc.mesoName !== null ? ` · ${doc.mesoName}` : ''}
            </Text>
            {isActive && (
              <>
                <Text variant="small" tone="muted">
                  ·
                </Text>
                <Elapsed startedAt={workout.startedAt} />
              </>
            )}
          </View>
        </View>
        <IconButton icon="ellipsis-horizontal" label="Options de la séance" onPress={() => setMenu(true)} size={22} hitSize={48} color={t.text} />
      </View>
      {/* Session progress: a thin line of light, no numbers. */}
      <View
        accessibilityRole="progressbar"
        accessibilityLabel={`${doneSets} séries sur ${totalSets}`}
        style={{ height: 4, borderRadius: 2, backgroundColor: t.surfaceAlt, overflow: 'hidden' }}>
        <View style={{ width: `${Math.round(progress * 100)}%`, height: '100%', borderRadius: 2, backgroundColor: t.accent }} />
      </View>
      {isActive && workout.date < day && (
        // Forgotten in the gym: the session stays "in progress" until finished. Say so, one tap away.
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.sm + 2, borderRadius: radius.md, backgroundColor: t.warningSoft }}>
          <Ionicons name="time-outline" size={18} color={t.warning} />
          <Text variant="small" style={{ flex: 1 }}>
            Commencée {formatLongDate(workout.date).toLowerCase()}, jamais terminée.
          </Text>
          <Button label="Terminer" size="sm" variant="secondary" onPress={finish} />
        </View>
      )}
    </View>
  );

  const cards = (
    <View style={{ gap: space.md }} onLayout={(e) => (listY.current = e.nativeEvent.layout.y)}>
      {items.map((item, index) => (
        <ExerciseCard
          key={item.we.id}
          workoutId={workoutId}
          host={host}
          item={item}
          index={index}
          count={items.length}
          current={isActive && index === current}
          live={isActive}
          bodyweight={workout.bodyweight}
          onLayoutY={onCardLayout}
          onRowLayoutY={onRowLayout}
        />
      ))}
    </View>
  );

  const footer = (
    <View style={{ gap: space.md }}>
      <Button label="Ajouter un exercice" icon="add" variant="ghost" onPress={() => openPicker('Ajouter un exercice', (id) => useWorkoutStore.getState().addExercise(workoutId, id))} />
      {(showNotes || workout.notes !== '') && (
        <Glass contentStyle={{ padding: space.xs }}>
          <TextInput
            value={workout.notes}
            onChangeText={(text) => store.setWorkoutNotes(workoutId, text)}
            placeholder="Notes de séance (forme, sommeil, douleurs…)"
            placeholderTextColor={t.textMuted}
            multiline
            autoFocus={showNotes && workout.notes === ''}
            style={{ minHeight: 64, color: t.text, padding: space.md, fontSize: 15, fontFamily: family.regular, textAlignVertical: 'top' }}
          />
        </Glass>
      )}
      {isActive && !wide && (
        <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
          <Button label="Repos" icon="timer-outline" variant="secondary" size="lg" onPress={startManualRest} />
          <Button label="Terminer" icon="flag-outline" size="lg" onPress={finish} style={{ flex: 1 }} />
        </View>
      )}
    </View>
  );

  const scrollBottom = wide ? space.xxl : host === 'tabs' ? dockInset + (focusedSetId !== null ? 300 : 0) : keypadHere ? 380 : space.xxl + insets.bottom;

  const list = (
    <ScrollView
      ref={scrollRef}
      onScroll={onScroll}
      scrollEventThrottle={32}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingTop: insets.top + space.md, paddingBottom: scrollBottom, paddingHorizontal: wide ? 0 : gutter, gap: space.md }}>
      <View style={{ width: '100%', maxWidth: 600, alignSelf: 'center', gap: space.md }}>
        {header}
        {cards}
        {footer}
      </View>
    </ScrollView>
  );

  return (
    <View style={{ flex: 1 }}>
      {isActive && keepAwake && <KeepAwake />}
      {wide ? (
        <View style={{ flex: 1, flexDirection: 'row', gap: space.xl, paddingHorizontal: space.xl }}>
          {list}
          <View style={{ width: 380, paddingTop: insets.top + space.md, paddingBottom: space.lg }}>
            <Glass level="float" radius={radius.xl} style={{ flex: 1 }} contentStyle={{ flex: 1, padding: space.md, gap: space.md }}>
              {keypadHere ? (
                <Keypad host={host} />
              ) : (
                <>
                  <Text variant="label" tone="muted" style={{ paddingHorizontal: space.sm, paddingTop: space.sm }}>
                    Plan de la séance
                  </Text>
                  <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
                    <SessionPlan items={items} onJump={jumpTo} />
                  </ScrollView>
                  <View style={{ gap: space.sm }}>
                    <Text variant="caption" tone="muted" style={{ paddingHorizontal: space.sm }}>
                      Clavier : chiffres, ↑↓ ±charge, Tab reps → série suivante, Entrée valide, Échap ferme.
                    </Text>
                    {isActive && <Button label="Terminer la séance" icon="flag-outline" size="lg" onPress={finish} />}
                  </View>
                </>
              )}
            </Glass>
          </View>
        </View>
      ) : (
        list
      )}

      {host === 'screen' && !wide && keypadHere && (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' }}>
          <Glass level="float" radius={radius.xl} docked style={{ width: '100%', maxWidth: 600 }} contentStyle={{ overflow: 'hidden', paddingBottom: insets.bottom }}>
            <Keypad host="screen" />
          </Glass>
        </View>
      )}
      {host === 'screen' && !wide && !keypadHere && (
        <View pointerEvents="box-none" style={{ position: 'absolute', left: space.sm, right: space.sm, bottom: Math.max(insets.bottom, space.sm) }}>
          <RestTimerBar />
        </View>
      )}

      <SetNoteSheet />
      <ActionSheet
        visible={menu}
        onClose={() => setMenu(false)}
        title={workout.name}
        actions={[
          { label: 'Démarrer un repos', icon: 'timer-outline', hidden: !isActive, onPress: startManualRest },
          { label: 'Renommer', icon: 'pencil', onPress: () => (setNameDraft(workout.name), setRenaming(true)) },
          { label: 'Note de séance', icon: 'document-text-outline', onPress: () => setShowNotes(true) },
          { label: 'Bilan de la séance', icon: 'ribbon-outline', hidden: isActive, onPress: () => useSessionSummary.getState().show(workoutId) },
          {
            label: isActive ? 'Abandonner la séance' : 'Supprimer la séance',
            icon: 'trash-outline',
            destructive: true,
            onPress: () => {
              store.discard(workoutId);
              if (host === 'screen') router.back();
            },
          },
        ]}
      />
      <Sheet visible={renaming} onClose={() => setRenaming(false)} title="Renommer la séance">
        <View style={{ padding: space.lg, gap: space.md }}>
          <Field value={nameDraft} onChangeText={setNameDraft} autoFocus selectTextOnFocus returnKeyType="done" onSubmitEditing={() => (store.renameWorkout(workoutId, nameDraft), setRenaming(false))} />
          <Button label="Enregistrer" onPress={() => (store.renameWorkout(workoutId, nameDraft), setRenaming(false))} />
        </View>
      </Sheet>
    </View>
  );
}
