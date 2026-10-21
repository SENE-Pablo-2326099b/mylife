import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { memo, useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text as RNText, useWindowDimensions, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';

import { estimate1RM, formatPercent, formatWeight } from '@/domain/math';
import type { BarSpeed, WorkoutSet } from '@/domain/types';
import { useEntry, type EntryFocus } from '@/state/entryStore';
import { useSetMenu } from '@/state/setNoteStore';
import { useWorkoutStore, type SetField } from '@/state/workoutStore';
import { Text } from '@/ui/components/primitives';
import { SET_TYPE_SHORT, SPEED_LABEL } from '@/ui/labels';
import { springs } from '@/ui/motion';
import { family, radius, shade, useTheme } from '@/ui/theme';

export const ROW_HEIGHT = 56;

/** Fixed-size chrome (cells, badges, chips) caps system font scaling so it never spills its box. */
export const CHROME_FONT_SCALE = 1.2;

/** Column widths of a set row, shared with the column header. Phones first: narrow screens get tighter wells. */
export interface SetMetrics {
  pad: number;
  gap: number;
  badge: number;
  weight: number;
  reps: number;
  check: number;
  font: number;
  /** Room for the previous-session column (hidden on foldable cover screens). */
  ghost: boolean;
  /** Room for secondary labels on a row (e.g. « Barre : » before the speed choice). */
  note: boolean;
}

export function useSetMetrics(): SetMetrics {
  const { width } = useWindowDimensions();
  if (width < 300)
    return {
      pad: 8,
      gap: 6,
      badge: 32,
      weight: 64,
      reps: 50,
      check: 40,
      font: 16,
      ghost: false,
      note: false,
    };
  if (width < 360)
    return {
      pad: 8,
      gap: 6,
      badge: 32,
      weight: 64,
      reps: 50,
      check: 40,
      font: 16,
      ghost: true,
      note: false,
    };
  if (width < 410)
    return {
      pad: 10,
      gap: 7,
      badge: 34,
      weight: 72,
      reps: 54,
      check: 42,
      font: 17,
      ghost: true,
      note: true,
    };
  return {
    pad: 10,
    gap: 8,
    badge: 36,
    weight: 80,
    reps: 60,
    check: 44,
    font: 18,
    ghost: true,
    note: true,
  };
}

/**
 * Validate = switch on a light. Unchecked: an etched glass well. Checked: an orb of accent light
 * that pops (spring overshoot) and glows.
 */
function CheckOrb({ done, onPress, size }: { done: boolean; onPress: () => void; size: number }) {
  const t = useTheme();
  const pop = useSharedValue(1);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (done) pop.value = withSequence(withTiming(0.82, { duration: 70 }), withSpring(1, springs.liquid));
  }, [done, pop]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  return (
    <Pressable onPress={onPress} hitSlop={6} accessibilityRole="checkbox" accessibilityState={{ checked: done }} accessibilityLabel="Valider la série">
      <Animated.View
        style={[
          {
            width: size,
            height: 42,
            borderRadius: radius.sm + 2,
            overflow: 'hidden',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: done ? 'transparent' : t.well,
            borderWidth: done ? 0 : 1,
            borderColor: t.glass.pane.rim,
            boxShadow: shade(done ? `0px 0px 18px ${t.accentGlow}, inset 0px 1px 0px ${t.highlight}` : `inset 0px 1px 3px ${t.wellShade}`, true),
          },
          style,
        ]}>
        {done && <LinearGradient colors={t.accentGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />}
        <Ionicons name="checkmark" size={done ? 24 : 21} color={done ? t.onAccent : t.textMuted} />
      </Animated.View>
    </Pressable>
  );
}

interface Props {
  workoutId: string;
  host: EntryFocus['host'];
  set: WorkoutSet;
  /** 1-based number among non-warmup sets, shown for plain working sets. */
  number: number;
  ghost: WorkoutSet | undefined;
  /** Main lifts: the set's % of the 1RM, shown instead of last time's set. */
  percent?: number | null;
  showSpeed: boolean;
  bodyweightExercise: boolean;
  /** e1RM to beat for a PR (null = no history, no PR badge). */
  prThreshold: number | null;
  bodyweight: number | null;
  onLayoutY?: (setId: string, y: number) => void;
}

const SPEEDS: readonly BarSpeed[] = ['fast', 'normal', 'slow'];

/**
 * One set = one compact line: type badge · previous · kg · reps · ✓.
 * Grey values are the prescription (or last time); ✓ accepts them as-is → 1 tap when on plan.
 */
export const SetRow = memo(function SetRow(p: Props) {
  const t = useTheme();
  const { set } = p;
  // Primitive selector: only the focused row re-renders while typing.
  const focusKey = useEntry((s) => (s.focus?.setId === set.id ? `${s.focus.field}|${s.fresh ? '1' : '0'}|${s.buffer}` : null));
  const [focusField, fresh, buffer] = focusKey === null ? [null, true, ''] : focusKey.split('|');
  const open = useEntry((s) => s.open);
  const toggleComplete = useWorkoutStore((s) => s.toggleComplete);
  const setBarSpeed = useWorkoutStore((s) => s.setBarSpeed);
  const m = useSetMetrics();

  const typeColor = t.setType[set.setType];
  const badge = set.setType === 'working' ? String(p.number) : SET_TYPE_SHORT[set.setType];
  const isPr =
    set.completed &&
    set.setType !== 'warmup' &&
    p.prThreshold !== null &&
    set.weight !== null &&
    set.reps !== null &&
    estimate1RM(set.weight, set.reps, p.bodyweight) > p.prThreshold + 1e-6;

  const onCheck = () => {
    const r = toggleComplete(p.workoutId, set.id);
    if (r === 'need-weight')
      open({
        workoutId: p.workoutId,
        setId: set.id,
        field: 'weight',
        host: p.host,
      });
    if (r === 'need-reps')
      open({
        workoutId: p.workoutId,
        setId: set.id,
        field: 'reps',
        host: p.host,
      });
    // Validated from the row while the keypad edits it: same as the keypad's ✓ (close, show the rest).
    if (r === 'completed' && useEntry.getState().focus?.setId === set.id) useEntry.getState().close();
  };

  const cell = (field: SetField) => {
    const focused = focusField === field;
    const value = field === 'weight' ? set.weight : set.reps;
    const target = field === 'weight' ? set.targetWeight : set.targetReps;
    let text: string;
    let placeholder = false;
    if (focused && fresh === '0') text = (buffer ?? '').replace('.', ',');
    else if (value !== null) text = field === 'weight' ? formatWeight(value) : String(value);
    else if (target !== null) {
      placeholder = true;
      text =
        field === 'reps' && set.targetRepsMax !== null && set.targetRepsMax !== target
          ? `${target}-${set.targetRepsMax}`
          : field === 'weight'
            ? formatWeight(target)
            : String(target);
    } else {
      placeholder = true;
      text = '–';
    }
    if (field === 'weight' && p.bodyweightExercise && !placeholder && text === '0') text = 'PDC';
    return (
      <Pressable
        onPress={() => open({ workoutId: p.workoutId, setId: set.id, field, host: p.host })}
        accessibilityRole="button"
        accessibilityLabel={field === 'weight' ? `Poids ${text}` : `Répétitions ${text}`}
        style={{
          width: field === 'weight' ? m.weight : m.reps,
          height: 42,
          borderRadius: radius.sm,
          alignItems: 'center',
          justifyContent: 'center',
          // Etched glass: a well cut into the pane; it lights up when focused.
          backgroundColor: focused ? t.accentSoft : set.completed ? 'transparent' : t.well,
          borderWidth: 1,
          borderColor: focused ? `${t.focus}CC` : set.completed ? 'transparent' : t.glass.pane.rim,
          boxShadow: shade(
            focused ? `0px 0px 18px ${t.accentGlow}` : set.completed ? undefined : `inset 0px 1px 3px ${t.wellShade}`,
            true,
          ),
        }}>
        <RNText
          numberOfLines={1}
          maxFontSizeMultiplier={CHROME_FONT_SCALE}
          adjustsFontSizeToFit
          style={{
            // Rep ranges ("12-20") are wider than a value: step the size down instead of letting
            // the cell truncate them (adjustsFontSizeToFit does nothing on the web).
            fontSize: text.length > 4 ? Math.round(m.font * 0.74) : text.length > 3 ? Math.round(m.font * 0.86) : m.font,
            fontFamily: placeholder ? family.medium : family.displaySemi,
            letterSpacing: -0.3,
            color: placeholder ? t.ghost : t.text,
            fontVariant: ['tabular-nums'],
          }}>
          {text}
          {focused && fresh === '0' ? <RNText style={{ color: t.accent }}>|</RNText> : null}
        </RNText>
      </Pressable>
    );
  };

  const ghostText =
    p.percent !== undefined
      ? p.percent === null
        ? ''
        : formatPercent(p.percent)
      : p.ghost !== undefined && p.ghost.weight !== null && p.ghost.reps !== null
      ? `${p.bodyweightExercise && p.ghost.weight === 0 ? 'PDC' : formatWeight(p.ghost.weight)}×${p.ghost.reps}`
      : '';

  return (
    <View onLayout={p.onLayoutY === undefined ? undefined : (e) => p.onLayoutY?.(set.id, e.nativeEvent.layout.y)} style={{ overflow: 'hidden' }}>
      {set.completed && (
        <LinearGradient
          pointerEvents="none"
          colors={[t.completedRow, 'rgba(0,0,0,0)']}
          start={{ x: 1, y: 0 }}
          end={{ x: 0, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      )}
      <View
        style={{
          height: ROW_HEIGHT,
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: m.pad,
          gap: m.gap,
        }}>
        <Pressable
          onPress={() => useSetMenu.getState().open(p.workoutId, set.id, 'menu')}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={`Série ${badge || p.number} : type, vitesse, note…`}
          style={{
            width: m.badge,
            height: 44,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <RNText
            maxFontSizeMultiplier={CHROME_FONT_SCALE}
            style={{
              color: set.setType === 'working' ? t.textMuted : typeColor,
              fontFamily: family.display,
              fontSize: 14,
            }}>
            {badge}
          </RNText>
        </Pressable>
        <Pressable
          style={{
            flex: 1,
            minWidth: 0,
            height: '100%',
            justifyContent: 'center',
          }}
          onLongPress={() => useSetMenu.getState().open(p.workoutId, set.id, 'menu')}
          delayLongPress={400}
          accessibilityHint="Appui long : options de la série">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            {m.ghost && (
              <Text
                variant="small"
                numeric
                // Long previous sets ("102,5×10") step down rather than truncate in the narrow column.
                style={{
                  color: t.ghost,
                  flexShrink: 1,
                  fontSize: ghostText.length > 5 ? 11.5 : 13,
                }}
                numberOfLines={1}
                maxFontSizeMultiplier={CHROME_FONT_SCALE}>
                {ghostText}
              </Text>
            )}
            {isPr && <Ionicons name="trophy" size={13} color={t.gold} />}
            <View style={{ flex: 1 }} />
            {set.barSpeed !== null && (
              <Text variant="caption" numeric style={{ color: set.barSpeed === 'fast' ? t.success : set.barSpeed === 'slow' ? t.warning : t.textMuted }} numberOfLines={1} maxFontSizeMultiplier={CHROME_FONT_SCALE}>
                {SPEED_LABEL[set.barSpeed]}
              </Text>
            )}
            {set.isTest && <Ionicons name="flask" size={12} color={t.warning} accessibilityLabel="Série test" />}
            <View style={{ flex: 1 }} />
          </View>
        </Pressable>
        {cell('weight')}
        {cell('reps')}
        <CheckOrb done={set.completed} onPress={onCheck} size={m.check} />
      </View>
      {set.note !== '' && (
        <Pressable
          onPress={() => useSetMenu.getState().open(p.workoutId, set.id, 'note')}
          accessibilityLabel={`Modifier la note : ${set.note}`}
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: 6,
            paddingLeft: m.pad + m.badge + m.gap,
            paddingRight: m.pad,
            paddingBottom: 8,
            marginTop: -6,
          }}>
          <Ionicons name="chatbubble-ellipses" size={12} color={t.gold} style={{ marginTop: 2 }} />
          <Text variant="small" tone="secondary" style={{ flex: 1, fontStyle: 'italic' }}>
            {set.note}
          </Text>
        </Pressable>
      )}
      {p.showSpeed && set.completed && set.barSpeed === null && (
        // Asked once, right after the top set: a fast bar adds a step next session.
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingLeft: m.pad + m.badge + m.gap,
            paddingRight: m.pad,
            paddingBottom: 10,
            marginTop: -4,
          }}>
          {m.note && (
            <Text variant="caption" tone="muted" numberOfLines={1} maxFontSizeMultiplier={CHROME_FONT_SCALE}>
              Barre :
            </Text>
          )}
          {SPEEDS.map((speed) => (
            <Pressable
              key={speed}
              onPress={() => setBarSpeed(p.workoutId, set.id, speed)}
              hitSlop={{ top: 10, bottom: 10, left: 2, right: 2 }}
              accessibilityRole="button"
              accessibilityLabel={`Vitesse de barre : ${SPEED_LABEL[speed]}`}
              style={{ height: 28, paddingHorizontal: 12, borderRadius: radius.pill, justifyContent: 'center', backgroundColor: t.surfaceAlt }}>
              <RNText maxFontSizeMultiplier={CHROME_FONT_SCALE} style={{ fontSize: 12, fontFamily: family.semibold, color: t.textSecondary }}>
                {SPEED_LABEL[speed]}
              </RNText>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
});
