import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, ReduceMotion, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatDuration } from '@/domain/dates';
import { Keypad } from '@/features/workout/Keypad';
import { RestTimerBar } from '@/features/workout/RestTimerBar';
import { useEntry } from '@/state/entryStore';
import { useWorkoutStore } from '@/state/workoutStore';
import { Glass } from '@/ui/components/Glass';
import { Tap, Text, type IconName } from '@/ui/components/primitives';
import { flowAnim, springs } from '@/ui/motion';
import { DOCK_HEIGHT, DOCK_MARGIN, SIDEBAR_WIDTH } from '@/ui/responsive';
import { family, radius, shade, space, useTheme } from '@/ui/theme';

export const TABS: { name: string; label: string; icon: IconName; active: IconName }[] = [
  { name: 'index', label: 'Accueil', icon: 'flash-outline', active: 'flash' },
  { name: 'planning', label: 'Planning', icon: 'calendar-clear-outline', active: 'calendar-clear' },
  { name: 'exercises', label: 'Exercices', icon: 'barbell-outline', active: 'barbell' },
  { name: 'stats', label: 'Stats', icon: 'pulse-outline', active: 'pulse' },
  { name: 'settings', label: 'Réglages', icon: 'options-outline', active: 'options' },
];

function useActiveSession(): { name: string; startedAt: number } | null {
  // Primitive selector (stable between renders); decoded below.
  const key = useWorkoutStore((s) => {
    const doc = Object.values(s.docs).find((d) => d.workout.status === 'active');
    return doc === undefined ? null : `${doc.workout.startedAt}|${doc.workout.name}`;
  });
  if (key === null) return null;
  const cut = key.indexOf('|');
  return { startedAt: Number(key.slice(0, cut)), name: key.slice(cut + 1) };
}

/** Same press semantics as the stock tab bar (events, re-press to top). */
function usePressTab({ state, navigation }: BottomTabBarProps) {
  return (index: number) => {
    const route = state.routes[index];
    if (route === undefined) return;
    const focused = state.index === index;
    const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
    void Haptics.selectionAsync();
    if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
  };
}

/** A soft breathing dot: a session is running. */
function LiveDot() {
  const t = useTheme();
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = withRepeat(withSequence(withTiming(1.6, { duration: 900 }), withTiming(1, { duration: 900 })), -1);
  }, [pulse]);
  const halo = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }], opacity: 2 - pulse.value }));
  return (
    <View style={{ width: 8, height: 8 }}>
      <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: 4, backgroundColor: t.accent }, halo]} />
      <View style={[StyleSheet.absoluteFill, { borderRadius: 4, backgroundColor: t.accent }]} />
    </View>
  );
}

/**
 * The liquid indicator: two edges on different springs — the leading edge darts ahead, the
 * trailing one catches up — so the bead stretches like a drop sliding along the glass.
 */
function useLiquidEdges(index: number, slot: number, pad: number) {
  const left = useSharedValue(index * slot + pad);
  const right = useSharedValue((index + 1) * slot - pad);
  const prev = useRef(index);
  useEffect(() => {
    const toRight = index >= prev.current;
    const lead = { ...springs.liquid, stiffness: 420, damping: 24 };
    const trail = { ...springs.soft, stiffness: 150 };
    left.value = withSpring(index * slot + pad, toRight ? trail : lead);
    right.value = withSpring((index + 1) * slot - pad, toRight ? lead : trail);
    prev.current = index;
  }, [index, slot, pad, left, right]);
  return { left, right };
}

function DockTabs(props: BottomTabBarProps) {
  const t = useTheme();
  const [width, setWidth] = useState(0);
  const press = usePressTab(props);
  const live = useActiveSession() !== null;
  const slot = width / TABS.length;
  // Very narrow docks (foldable cover screens): smaller labels so the five tabs never touch.
  const tight = width > 0 && slot < 62;
  const { left, right } = useLiquidEdges(props.state.index, slot, tight ? 3 : 6);
  const bead = useAnimatedStyle(() => ({ left: left.value, width: Math.max(0, right.value - left.value) }));

  return (
    <View style={{ height: DOCK_HEIGHT, flexDirection: 'row' }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 && (
        <Animated.View
          style={[
            {
              position: 'absolute',
              top: 7,
              bottom: 7,
              borderRadius: radius.lg,
              backgroundColor: t.accentSoft,
              borderWidth: StyleSheet.hairlineWidth * 1.5,
              borderColor: `${t.accent}55`,
              boxShadow: shade(`0px 0px 22px ${t.accentGlow}, inset 0px 1px 0px ${t.highlight}`),
            },
            bead,
          ]}
        />
      )}
      {props.state.routes.map((route, i) => {
        const tab = TABS.find((x) => x.name === route.name);
        if (tab === undefined) return null;
        const focused = props.state.index === i;
        return (
          <Pressable
            key={route.key}
            onPress={() => press(i)}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={tab.label}
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3 }}>
            <View>
              <Ionicons name={focused ? tab.active : tab.icon} size={22} color={focused ? t.accent : t.textMuted} />
              {tab.name === 'index' && live && (
                <View style={{ position: 'absolute', top: -2, right: -6 }}>
                  <LiveDot />
                </View>
              )}
            </View>
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              maxFontSizeMultiplier={1.15}
              style={{ fontFamily: family.semibold, fontSize: tight ? 9 : 10.5, letterSpacing: tight ? -0.2 : 0, color: focused ? t.text : t.textMuted, maxWidth: slot - 4 }}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Phones & tablets: a floating glass dock that becomes the numeric keypad while you log a set. */
export function Dock(props: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const keypadOpen = useEntry((s) => s.focus?.host === 'tabs');
  // Typing: the dock becomes the keyboard, docked to the bottom edge like a system keyboard
  // (full width, above the Android navigation bar) so nothing shows underneath.
  if (keypadOpen) {
    return (
      <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' }}>
        <View pointerEvents="box-none" style={{ width: '100%', maxWidth: 600, gap: space.sm }}>
          <View style={{ paddingHorizontal: DOCK_MARGIN }}>
            <RestTimerBar />
          </View>
          <Glass level="float" radius={radius.xl} docked contentStyle={{ overflow: 'hidden', paddingBottom: insets.bottom }}>
            <Animated.View entering={flowAnim(FadeIn.duration(180).reduceMotion(ReduceMotion.System))}>
              <Keypad host="tabs" />
            </Animated.View>
          </Glass>
        </View>
      </View>
    );
  }
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: Math.max(insets.bottom, DOCK_MARGIN), paddingHorizontal: DOCK_MARGIN, alignItems: 'center' }}>
      <View pointerEvents="box-none" style={{ width: '100%', maxWidth: 560, gap: space.sm }}>
        <RestTimerBar />
        <Glass level="float" radius={radius.xl + 2} contentStyle={{ overflow: 'hidden', borderRadius: radius.xl + 2 }}>
          <Animated.View entering={flowAnim(FadeIn.duration(180).reduceMotion(ReduceMotion.System))}>
            <DockTabs {...props} />
          </Animated.View>
        </Glass>
      </View>
    </View>
  );
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

/** Desktop: a tall pane of glass on the left — brand, sections, and what is live right now. */
export function Sidebar(props: BottomTabBarProps) {
  const t = useTheme();
  const press = usePressTab(props);
  const session = useActiveSession();
  const ROW = 48;
  const top = useSharedValue(props.state.index * ROW);
  useEffect(() => {
    top.value = withSpring(props.state.index * ROW, springs.liquid);
  }, [props.state.index, top]);
  const bead = useAnimatedStyle(() => ({ transform: [{ translateY: top.value }] }));

  return (
    <View style={{ width: SIDEBAR_WIDTH + space.lg * 2, padding: space.lg, paddingRight: 0 }}>
      <Glass level="float" radius={radius.xl} style={{ flex: 1 }} contentStyle={{ flex: 1, padding: space.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm + 2, paddingHorizontal: space.sm, paddingTop: space.sm, paddingBottom: space.xl }}>
          <View style={{ width: 34, height: 34, borderRadius: 11, overflow: 'hidden', boxShadow: shade(`0px 0px 22px ${t.accentGlow}`) }}>
            <LinearGradient colors={t.accentGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="flash" size={18} color={t.onAccent} />
            </LinearGradient>
          </View>
          <View>
            <Text variant="title" style={{ fontSize: 18 }}>
              MyPerf
            </Text>
            <Text variant="caption" tone="muted">
              Force · street lifting
            </Text>
          </View>
        </View>

        <View>
          <Animated.View
            style={[
              {
                position: 'absolute',
                left: 0,
                right: 0,
                height: ROW,
                borderRadius: radius.md,
                backgroundColor: t.accentSoft,
                borderWidth: StyleSheet.hairlineWidth * 1.5,
                borderColor: `${t.accent}44`,
                boxShadow: shade(`0px 0px 20px ${t.accentGlow}, inset 0px 1px 0px ${t.highlight}`),
              },
              bead,
            ]}
          />
          {props.state.routes.map((route, i) => {
            const tab = TABS.find((x) => x.name === route.name);
            if (tab === undefined) return null;
            const focused = props.state.index === i;
            return (
              <Tap
                key={route.key}
                onPress={() => press(i)}
                accessibilityRole="tab"
                accessibilityState={{ selected: focused }}
                scaleTo={0.97}
                highlightRadius={radius.md}
                style={{ height: ROW, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, borderRadius: radius.md }}>
                <Ionicons name={focused ? tab.active : tab.icon} size={20} color={focused ? t.accent : t.textSecondary} />
                <Text variant="bodyStrong" style={{ color: focused ? t.text : t.textSecondary, flex: 1 }}>
                  {tab.label}
                </Text>
                {tab.name === 'index' && session !== null && <LiveDot />}
              </Tap>
            );
          })}
        </View>

        <View style={{ flex: 1 }} />

        <View style={{ gap: space.sm }}>
          <RestTimerBar compact />
          {session !== null && (
            <Tap onPress={() => press(0)} scaleTo={0.98} highlightRadius={radius.lg} style={{ borderRadius: radius.lg }}>
              <Glass level="raised" glow radius={radius.lg} contentStyle={{ padding: space.md, gap: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                  <LiveDot />
                  <Text variant="label" tone="accent">
                    Séance en cours
                  </Text>
                </View>
                <Text variant="bodyStrong" numberOfLines={1}>
                  {session.name}
                </Text>
                <Elapsed startedAt={session.startedAt} />
              </Glass>
            </Tap>
          )}
        </View>
      </Glass>
    </View>
  );
}
