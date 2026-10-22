import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, FadeIn, LinearTransition, ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatDuration } from '@/domain/dates';
import { Keypad } from '@/features/workout/Keypad';
import { CommandPalette } from '@/features/navigation/CommandPalette';
import { Orbit } from '@/features/navigation/Orbit';
import { RestTimerBar } from '@/features/workout/RestTimerBar';
import { useEntry } from '@/state/entryStore';
import { useWorkoutStore } from '@/state/workoutStore';
import { Glass } from '@/ui/components/Glass';
import { Tap, Text, type IconName } from '@/ui/components/primitives';
import { flowAnim, springs } from '@/ui/motion';
import { DOCK_HEIGHT, DOCK_MARGIN, SIDEBAR_WIDTH } from '@/ui/responsive';
import { family, radius, shade, space, useTheme } from '@/ui/theme';

export const TABS: { name: string; label: string; icon: IconName; active: IconName }[] = [
  { name: 'index', label: 'Aujourd’hui', icon: 'flash-outline', active: 'flash' },
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
 * The orb at the centre of the dock: a bead of liquid light ringed by a slowly turning halo. Opens
 * the MyLife spaces; a long press opens the coach.
 */
function Orb({ onPress, onLongPress }: { onPress: () => void; onLongPress: () => void }) {
  const t = useTheme();
  const reduce = useReducedMotion();
  const spin = useSharedValue(0);
  useEffect(() => {
    if (reduce || Platform.OS === 'android') return;
    spin.set(withRepeat(withTiming(1, { duration: 7000, easing: Easing.linear }), -1));
  }, [reduce, spin]);
  const ring = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value * 360}deg` }] }));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Chercher, aller, agir (appui long : coach)"
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      onLongPress={() => {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onLongPress();
      }}
      style={({ pressed }) => ({ width: 60, height: 60, marginHorizontal: 2, alignItems: 'center', justifyContent: 'center', transform: [{ scale: pressed ? 0.9 : 1 }] })}>
      <View style={{ position: 'absolute', width: 60, height: 60, borderRadius: 30, overflow: 'hidden', opacity: 0.75 }}>
        <Animated.View style={[StyleSheet.absoluteFill, ring]}>
          <LinearGradient colors={[t.accentGradient[0], 'transparent', t.gold, 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        </Animated.View>
      </View>
      <View style={{ width: 52, height: 52, borderRadius: 26, overflow: 'hidden', boxShadow: shade(`0px 8px 24px ${t.accentGlow}`) }}>
        <LinearGradient colors={t.accentGradient} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <LinearGradient colors={['rgba(255,255,255,0.5)', 'rgba(255,255,255,0)']} locations={[0, 0.5]} start={{ x: 0.2, y: 0 }} end={{ x: 0.5, y: 0.7 }} style={StyleSheet.absoluteFill} />
          <Ionicons name="search" size={23} color={t.onAccent} />
        </LinearGradient>
      </View>
    </Pressable>
  );
}

/**
 * The dock: the active tab stretches into a capsule of light (icon + name), the others stay icons;
 * the orb sits in the middle. Réglages moved to the MyLife spaces (orb), like in MyFinances.
 */
function DockTabs(props: BottomTabBarProps) {
  const t = useTheme();
  const press = usePressTab(props);
  const live = useActiveSession() !== null;
  const [orbit, setOrbit] = useState(false);
  const [palette, setPalette] = useState(false);
  const items = props.state.routes
    .map((route, i) => ({ route, i, tab: TABS.find((x) => x.name === route.name) }))
    .filter((x): x is { route: (typeof props.state.routes)[number]; i: number; tab: (typeof TABS)[number] } => x.tab !== undefined && x.tab.name !== 'settings');
  const half = Math.ceil(items.length / 2);
  const layout = Platform.OS === 'web' ? undefined : LinearTransition.springify().damping(18).stiffness(220);

  const item = ({ route, i, tab }: (typeof items)[number]) => {
    const focused = props.state.index === i;
    return (
      <Pressable key={route.key} onPress={() => press(i)} accessibilityRole="tab" accessibilityState={{ selected: focused }} accessibilityLabel={tab.label}>
        <Animated.View
          layout={layout}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            height: 48,
            paddingHorizontal: focused ? 16 : 13,
            borderRadius: 24,
            ...(focused
              ? { backgroundColor: t.accentSoft, borderWidth: 1, borderColor: `${t.accent}55`, boxShadow: shade(`0px 0px 22px ${t.accentGlow}, inset 0px 1px 0px ${t.highlight}`) }
              : {}),
          }}>
          <View>
            <Ionicons name={focused ? tab.active : tab.icon} size={22} color={focused ? t.accent : t.textSecondary} />
            {tab.name === 'index' && live && (
              <View style={{ position: 'absolute', top: -2, right: -6 }}>
                <LiveDot />
              </View>
            )}
          </View>
          {focused && (
            <Text numberOfLines={1} maxFontSizeMultiplier={1.15} style={{ fontFamily: family.semibold, fontSize: 13, color: t.text }}>
              {tab.label}
            </Text>
          )}
        </Animated.View>
      </Pressable>
    );
  };

  return (
    <View style={{ height: DOCK_HEIGHT, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, gap: 2 }}>
      {items.slice(0, half).map(item)}
      <Orb onPress={() => setPalette(true)} onLongPress={() => router.push('/coach')} />
      {items.slice(half).map(item)}
      <CommandPalette visible={palette} onClose={() => setPalette(false)} onSpaces={() => setOrbit(true)} />
      <Orbit visible={orbit} onClose={() => setOrbit(false)} />
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
        <Glass level="float" radius={DOCK_HEIGHT / 2} style={{ alignSelf: 'center' }} contentStyle={{ overflow: 'hidden', borderRadius: DOCK_HEIGHT / 2 }}>
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
