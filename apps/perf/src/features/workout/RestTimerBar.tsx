import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withTiming, ZoomIn, ZoomOut, ReduceMotion } from 'react-native-reanimated';

import { formatClock } from '@/domain/dates';
import { useRestTimer } from '@/state/restTimerStore';
import { Glass } from '@/ui/components/Glass';
import { Tap, Text } from '@/ui/components/primitives';
import { flowAnim } from '@/ui/motion';
import { family, radius, shade, space, useTheme } from '@/ui/theme';

/**
 * "4:59" with every character in a fixed-width cell: the display font has proportional digits on
 * Android, so a plain text jiggled sideways at every second.
 */
function Clock({ text, color }: { text: string; color: string }) {
  return (
    <View style={{ flexDirection: 'row' }} accessibilityLabel={text}>
      {text.split('').map((ch, i) => (
        <Text
          key={i}
          maxFontSizeMultiplier={1.15}
          style={{ width: ch === ':' ? 7 : 13.5, textAlign: 'center', fontFamily: family.display, fontSize: 21, color }}>
          {ch}
        </Text>
      ))}
    </View>
  );
}

/**
 * Rest timer as a floating glass capsule filled by a liquid of light that rises with time.
 * Lives above the dock (phones) or in the sidebar (desktop): always there, never a screen.
 * The fill runs on the UI thread; the clock ticks on each second of the countdown.
 */
export function RestTimerBar({ compact = false }: { compact?: boolean }) {
  const t = useTheme();
  const endAt = useRestTimer((s) => s.endAt);
  const duration = useRestTimer((s) => s.duration);
  const label = useRestTimer((s) => s.label);
  const { adjust, stop, finish } = useRestTimer.getState();
  const [now, setNow] = useState(() => Date.now());
  const progress = useSharedValue(0);

  useEffect(() => {
    if (endAt === null) return;
    // Ticks land just after each second boundary of the countdown: every second is shown once,
    // for a full second, even when the JS thread is busy (a fixed 250 ms interval drifted and
    // could skip or repeat a second on Android).
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const n = Date.now();
      setNow(n);
      if (n >= endAt) {
        finish();
        return;
      }
      const left = endAt - n;
      timer = setTimeout(tick, (left % 1000 || 1000) + 15);
    };
    tick();
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active') return;
      if (timer !== undefined) clearTimeout(timer);
      tick();
    });
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      sub.remove();
    };
  }, [endAt, finish]);

  useEffect(() => {
    cancelAnimation(progress);
    if (endAt === null) return;
    const total = Math.max(1, duration * 1000);
    const remaining = Math.max(0, endAt - Date.now());
    progress.value = 1 - remaining / total;
    progress.value = withTiming(1, { duration: remaining, easing: Easing.linear });
  }, [endAt, duration, progress]);

  const fill = useAnimatedStyle(() => ({ width: `${Math.min(100, progress.value * 100)}%` }));

  if (endAt === null) return null;
  const remaining = (endAt - now) / 1000;
  const almost = remaining <= 10;

  const control = (text: string, onPress: () => void, a11y: string) => (
    <Tap onPress={onPress} hitSlop={4} scaleTo={0.85} accessibilityLabel={a11y} highlightRadius={14} style={{ paddingHorizontal: 9, height: 36, justifyContent: 'center', borderRadius: 14 }}>
      <Text variant="bodyStrong" tone="secondary" maxFontSizeMultiplier={1.15}>
        {text}
      </Text>
    </Tap>
  );

  return (
    <Animated.View
      entering={flowAnim(ZoomIn.springify().damping(16).stiffness(200).reduceMotion(ReduceMotion.System))}
      exiting={flowAnim(ZoomOut.duration(160).reduceMotion(ReduceMotion.System))}>
      <Glass level="float" radius={radius.pill} glow={almost} contentStyle={{ overflow: 'hidden', borderRadius: radius.pill }}>
        <Animated.View style={[StyleSheet.absoluteFill, { right: undefined }, fill]}>
          <LinearGradient colors={[`${t.accent}10`, `${t.accent}38`]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
          <View style={{ position: 'absolute', right: 0, top: 6, bottom: 6, width: 2, borderRadius: 1, backgroundColor: t.accent, boxShadow: shade(`0px 0px 10px ${t.accent}`) }} />
        </Animated.View>
        <View style={{ flexDirection: 'row', alignItems: 'center', height: compact ? 48 : 52, paddingLeft: space.md + 2, paddingRight: space.xs }}>
          <Ionicons name="timer-outline" size={19} color={t.accent} />
          <View style={{ marginLeft: space.sm, minWidth: 58 }}>
            <Clock text={formatClock(remaining)} color={t.text} />
          </View>
          <Text variant="small" tone="secondary" numberOfLines={1} style={{ flex: 1 }} maxFontSizeMultiplier={1.2}>
            {compact ? '' : label}
          </Text>
          {control('−30', () => adjust(-30), 'Retirer 30 secondes')}
          {control('+30', () => adjust(30), 'Ajouter 30 secondes')}
          <Tap onPress={stop} hitSlop={4} scaleTo={0.85} accessibilityLabel="Arrêter le repos" highlightRadius={14} style={{ paddingHorizontal: 10, height: 36, justifyContent: 'center', borderRadius: 14 }}>
            <Ionicons name="close" size={19} color={t.textSecondary} />
          </Tap>
        </View>
      </Glass>
    </Animated.View>
  );
}
