import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Platform, RefreshControl, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { springs } from '../motion';
import { CONTENT_MAX, useBreakpoint, useDockInset } from '../responsive';
import { space, useTheme } from '../theme';
import { backdropScroll, setMood, type Mood } from './Backdrop';
import { Glass } from './Glass';
import { Button, EmptyState, IconButton, Text } from './primitives';

/**
 * Entrance of a screen: its blocks rise together, once, on a spring (one orchestrated moment rather
 * than a cascade, same as MyFinances). `index` is kept so existing calls stay readable.
 * Driven by a shared value rather than a layout `entering` animation, which the web build leaves
 * absolutely positioned (out of flow) after it ends.
 * Android: off — fading whole blocks of glass composites them off-screen every frame and slowed
 * every screen opening.
 */
const REVEAL = Platform.OS !== 'android';

export function Reveal({ children, style }: { index?: number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduceMotion = useReducedMotion();
  const reduce = !REVEAL || reduceMotion;
  const p = useSharedValue(reduce ? 1 : 0);
  useEffect(() => {
    if (!reduce) p.set(withSpring(1, springs.soft));
  }, [p, reduce]);
  const anim = useAnimatedStyle(() => ({ opacity: Math.min(1, p.value * 1.4), transform: [{ translateY: (1 - p.value) * 22 }] }));
  return <Animated.View style={[style, anim]}>{children}</Animated.View>;
}

/** Back, or home when there is nothing to go back to (deep link, web reload). */
export function goBack(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

export function useGutter(): number {
  const bp = useBreakpoint();
  return bp === 'compact' ? space.lg : bp === 'medium' ? space.xl : space.xxl;
}

/**
 * Screen shell. Tab screens open on a large title that condenses into a floating glass bar as you
 * scroll; pushed screens wear that bar from the start, with a back button. The light field follows
 * the scroll (parallax) and changes ambience per section (`mood`).
 */
export function Screen({
  title,
  subtitle,
  right,
  children,
  scroll = true,
  contentStyle,
  stack = false,
  mood,
  maxWidth,
  modal = false,
  footer,
  onRefresh,
}: {
  title?: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  /** Pushed screen: glass top bar with a back button. */
  stack?: boolean;
  mood?: Mood;
  maxWidth?: number;
  /** Presented as a modal: close (×) instead of back. */
  modal?: boolean;
  /** The screen's main action, pinned at the bottom under the thumb (edit screens: « Enregistrer »). */
  footer?: ReactNode;
  /** Tirer vers le bas pour actualiser (geste natif). */
  onRefresh?: () => Promise<unknown>;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const bp = useBreakpoint();
  const gutter = useGutter();
  const dockInset = useDockInset();
  const y = useSharedValue(0);
  const barHeight = 56;

  useFocusEffect(
    useCallback(() => {
      if (mood !== undefined) setMood(mood);
      backdropScroll.set(y.get());
    }, [mood, y]),
  );

  // The condensed bar only takes touches once it is shown; at rest taps go through to the large title.
  const [barShown, setBarShown] = useState(stack);
  useAnimatedReaction(
    () => stack || y.value > 24,
    (shown, prev) => {
      if (shown !== prev) scheduleOnRN(setBarShown, shown);
    },
    [stack],
  );

  const onScroll = useAnimatedScrollHandler((e) => {
    y.set(e.contentOffset.y);
    backdropScroll.set(e.contentOffset.y);
  });

  const bar = useAnimatedStyle(() => ({ opacity: stack ? 1 : interpolate(y.value, [24, 64], [0, 1], Extrapolation.CLAMP) }));
  const barTitle = useAnimatedStyle(() => ({
    opacity: stack ? 1 : interpolate(y.value, [40, 80], [0, 1], Extrapolation.CLAMP),
    transform: [{ translateY: stack ? 0 : interpolate(y.value, [40, 80], [8, 0], Extrapolation.CLAMP) }],
  }));
  const largeTitle = useAnimatedStyle(() => ({
    opacity: interpolate(y.value, [0, 60], [1, 0], Extrapolation.CLAMP),
    transform: [
      { translateY: interpolate(y.value, [-100, 0, 100], [30, 0, -24], Extrapolation.CLAMP) },
      { scale: interpolate(y.value, [-120, 0], [1.08, 1], Extrapolation.CLAMP) },
    ],
  }));

  const column: ViewStyle = { width: '100%', maxWidth: maxWidth ?? CONTENT_MAX[bp], alignSelf: 'center', paddingHorizontal: gutter };

  const header =
    title === undefined || stack ? null : (
      <Animated.View style={[{ flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, marginBottom: space.lg }, largeTitle]}>
        <View style={{ flex: 1 }}>
          {subtitle !== undefined && (
            <Text variant="label" tone="gold" style={{ marginBottom: 4 }}>
              {subtitle}
            </Text>
          )}
          <Text variant={bp === 'compact' ? 'large' : 'hero'} numberOfLines={1}>
            {title}
          </Text>
        </View>
        {right}
      </Animated.View>
    );

  const topBar = (
    // At rest (invisible) the bar lets taps through to the large-title row (e.g. the Coach IA
    // button); once shown it takes them, so nothing scrolled underneath is hit by mistake.
    <Animated.View pointerEvents="box-none" style={[{ position: 'absolute', left: 0, right: 0, top: 0 }, bar]}>
      <Glass pointerEvents={barShown ? 'auto' : 'box-none'} level="float" radius={0} style={{ borderRadius: 0 }} contentStyle={{ paddingTop: insets.top }}>
        <View pointerEvents="box-none" style={[column, { height: barHeight, flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: gutter - (stack ? space.sm : 0) }]}>
          {stack &&  <IconButton icon={modal ? 'close' : 'chevron-back'} label={modal ? 'Fermer' : 'Retour'} color={t.text} onPress={goBack} />}
          <Animated.View pointerEvents="none" style={[{ flex: 1 }, barTitle]}>
            <Text variant="headline" numberOfLines={1}>
              {title ?? ''}
            </Text>
          </Animated.View>
          {stack && right}
        </View>
      </Glass>
    </Animated.View>
  );

  const top = insets.top + (stack ? barHeight + space.md : space.lg);

  // Modals float over the app: a full lens of glass blurs what is behind.
  const lens = modal ? <Glass level="lens" radius={0} style={[StyleSheet.absoluteFill, { borderRadius: 0 }]} /> : null;

  if (!scroll) {
    return (
      <View style={{ flex: 1 }}>
        {lens}
        <View style={[{ flex: 1, paddingTop: top }, contentStyle]}>
          <View style={column}>{header}</View>
          {children}
        </View>
        {stack && topBar}
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {lens}
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        style={StyleSheet.absoluteFill}
        contentContainerStyle={{ paddingTop: top, paddingBottom: (footer === undefined ? 0 : 80) + (stack ? insets.bottom + space.xl : dockInset + space.xl) }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={refreshing}
              tintColor={t.accent}
              colors={[t.accent]}
              progressBackgroundColor={t.glass.float.solidFill}
              progressViewOffset={top}
              onRefresh={() => {
                setRefreshing(true);
                void onRefresh().finally(() => setRefreshing(false));
              }}
            />
          ) : undefined
        }>
        <View style={[column, contentStyle]}>
          {header}
          {children}
        </View>
      </Animated.ScrollView>
      {topBar}
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: insets.top, backgroundColor: t.statusVeil }} />
      {footer !== undefined && (
        <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: (stack ? insets.bottom : dockInset - space.lg) + space.sm }}>
          <View pointerEvents="box-none" style={column}>
            {footer}
          </View>
        </View>
      )}
    </View>
  );
}

/**
 * A pushed screen whose record no longer exists (deleted, stale link): says so and offers the way
 * back instead of a blank page.
 */
export function NotFoundScreen({ title, body }: { title: string; body?: string }) {
  return (
    <Screen stack title="" mood="today">
      <EmptyState
        icon="alert-circle-outline"
        title={title}
        body={body ?? 'Il a peut-être été supprimé.'}
        action={<Button label="Retour" variant="secondary" icon="chevron-back" onPress={goBack} />}
      />
    </Screen>
  );
}
