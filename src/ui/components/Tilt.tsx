import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { interpolate, SensorType, useAnimatedSensor, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';

/**
 * Verre en relief : la carte suit l'inclinaison du téléphone (gyroscope, sur le thread UI) de
 * quelques degrés, et un reflet glisse à sa surface dans le sens opposé. Natif seulement ; sur le web
 * la carte reste à plat. Comme dans MyFinances.
 */
const MAX = 5;

function NativeTilt({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const sensor = useAnimatedSensor(SensorType.ROTATION, { interval: 33 });
  const base = useSharedValue<{ p: number; r: number } | null>(null);
  const card = useAnimatedStyle(() => {
    const { pitch, roll } = sensor.sensor.value;
    if (base.value === null) base.value = { p: pitch, r: roll };
    const dx = Math.max(-1, Math.min(1, (roll - base.value.r) / 0.35));
    const dy = Math.max(-1, Math.min(1, (pitch - base.value.p) / 0.35));
    return {
      transform: [{ perspective: 900 }, { rotateY: withSpring(`${dx * MAX}deg`, { damping: 18, stiffness: 140 }) }, { rotateX: withSpring(`${-dy * MAX}deg`, { damping: 18, stiffness: 140 }) }],
    };
  });
  const glare = useAnimatedStyle(() => {
    const { roll } = sensor.sensor.value;
    const dx = base.value === null ? 0 : Math.max(-1, Math.min(1, (roll - base.value.r) / 0.35));
    return { transform: [{ translateX: interpolate(dx, [-1, 1], [60, -60]) }], opacity: 0.6 + Math.abs(dx) * 0.4 };
  });
  return (
    <Animated.View style={[style, card]}>
      {children}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'hidden', borderRadius: 28 }, glare]}>
        <LinearGradient colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.08)', 'rgba(255,255,255,0)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      </Animated.View>
    </Animated.View>
  );
}

export function Tilt({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduce = useReducedMotion();
  if (Platform.OS === 'web' || reduce) return <View style={style}>{children}</View>;
  return <NativeTilt style={style}>{children}</NativeTilt>;
}
