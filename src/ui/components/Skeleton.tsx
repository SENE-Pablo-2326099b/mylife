import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { InteractionManager, StyleSheet, View, type DimensionValue } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { radius, space, useTheme } from '../theme';
import { Glass } from './Glass';

/**
 * True once the navigation transition is over. Heavy screens render skeletons first and compute
 * after, so switching tabs never stutters.
 */
export function useAfterTransition(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => setReady(true));
    return () => task.cancel();
  }, []);
  return ready;
}

/** A glint of light sweeping across glass: "something is coming". */
export function Shimmer({ height, width = '100%', r = radius.sm }: { height: number; width?: DimensionValue; r?: number }) {
  const t = useTheme();
  const reduce = useReducedMotion();
  const x = useSharedValue(-1);
  useEffect(() => {
    if (!reduce) x.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.quad) }), -1);
  }, [reduce, x]);
  const sweep = useAnimatedStyle(() => ({ transform: [{ translateX: `${x.value * 120}%` }] }));
  return (
    <View style={{ height, width, borderRadius: r, overflow: 'hidden', backgroundColor: t.surfaceAlt }}>
      <Animated.View style={[StyleSheet.absoluteFill, sweep]}>
        <LinearGradient colors={['rgba(255,255,255,0)', t.shine, 'rgba(255,255,255,0)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
      </Animated.View>
    </View>
  );
}

/** Placeholder card mimicking a content block. */
export function SkeletonCard({ lines = 3, tall = false }: { lines?: number; tall?: boolean }) {
  return (
    <Glass contentStyle={{ padding: space.lg, gap: space.md }}>
      <Shimmer height={12} width="35%" />
      <Shimmer height={tall ? 34 : 22} width="60%" r={radius.xs} />
      {Array.from({ length: lines }, (_, i) => (
        <Shimmer key={i} height={10} width={`${90 - i * 15}%`} />
      ))}
    </Glass>
  );
}
