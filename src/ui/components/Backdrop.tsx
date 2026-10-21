import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  makeMutable,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient as SvgLinearGradient, Mask, Pattern, RadialGradient, Rect, Stop } from 'react-native-svg';

import { springs } from '../motion';
import { useTheme } from '../theme';

/**
 * The field of light every glass surface is seen against.
 * Halos drift slowly (life), move with scroll (parallax / depth) and rearrange when you change
 * section (the light follows you). Everything animates transforms only: GPU-cheap.
 *
 * Android: no perpetual drift (it redraws the whole screen every frame, under every glass layer,
 * and made navigation stutter on mid-range phones) and each halo is cached as a GPU texture, so
 * the mood change and the scroll parallax only move bitmaps.
 */
const DRIFT = Platform.OS !== 'android';

/** Section moods: where the light gathers. */
export type Mood = 'today' | 'session' | 'planning' | 'library' | 'stats' | 'settings';
const MOODS: Mood[] = ['today', 'session', 'planning', 'library', 'stats', 'settings'];

/** Shared across the app: screens write, the backdrop reads (UI thread). */
export const backdropScroll = makeMutable(0);
const moodIndex = makeMutable(0);

export function setMood(mood: Mood) {
  moodIndex.value = withSpring(MOODS.indexOf(mood), springs.soft);
}

interface HaloSpec {
  color: 'violet' | 'gold' | 'indigo' | 'orchid';
  /** Diameter relative to the screen's long side. */
  size: number;
  /** Centre per mood, as fractions of the screen (x, y). */
  at: Record<Mood, [number, number]>;
  opacity: number;
  drift: number;
  period: number;
  parallax: number;
}

const HALOS: HaloSpec[] = [
  {
    color: 'violet',
    size: 0.9,
    opacity: 0.32,
    drift: 40,
    period: 19000,
    parallax: 0.25,
    at: { today: [0.85, 0.05], session: [0.5, -0.02], planning: [0.1, 0.1], library: [0.95, 0.35], stats: [0.15, 0.0], settings: [0.9, 0.9] },
  },
  {
    color: 'gold',
    size: 0.8,
    opacity: 0.22,
    drift: 55,
    period: 24000,
    parallax: 0.15,
    at: { today: [0.05, 0.45], session: [0.0, 0.7], planning: [0.95, 0.45], library: [0.05, 0.1], stats: [0.9, 0.45], settings: [0.1, 0.2] },
  },
  {
    color: 'indigo',
    size: 1.0,
    opacity: 0.26,
    drift: 60,
    period: 29000,
    parallax: 0.08,
    at: { today: [0.7, 0.95], session: [0.95, 0.85], planning: [0.4, 1.0], library: [0.3, 0.95], stats: [0.55, 1.0], settings: [0.5, 0.5] },
  },
  {
    color: 'orchid',
    size: 0.55,
    opacity: 0.1,
    drift: 35,
    period: 33000,
    parallax: 0.05,
    at: { today: [0.1, 0.95], session: [0.1, 0.25], planning: [0.85, 0.95], library: [0.9, 0.9], stats: [0.05, 0.75], settings: [0.95, 0.05] },
  },
];

function Halo({ spec, index, width, height }: { spec: HaloSpec; index: number; width: number; height: number }) {
  const t = useTheme();
  const reduce = useReducedMotion();
  const phase = useSharedValue(0);
  const d = Math.max(width, height) * spec.size;
  const xs = MOODS.map((m) => spec.at[m][0] * width - d / 2);
  const ys = MOODS.map((m) => spec.at[m][1] * height - d / 2);
  const inputs = MOODS.map((_, i) => i);

  useEffect(() => {
    if (reduce || !DRIFT) return;
    phase.value = withRepeat(withTiming(1, { duration: spec.period, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, [phase, reduce, spec.period]);

  const style = useAnimatedStyle(() => {
    const p = phase.value;
    return {
      transform: [
        { translateX: interpolate(moodIndex.value, inputs, xs) + Math.sin(p * Math.PI * 2 + index) * spec.drift },
        {
          translateY:
            interpolate(moodIndex.value, inputs, ys) + Math.cos(p * Math.PI * 2 + index) * spec.drift - backdropScroll.value * spec.parallax,
        },
        { scale: 1 + p * 0.12 },
      ],
    };
  });

  const color = t.halos[spec.color];
  const id = `halo-${index}`;
  return (
    <Animated.View renderToHardwareTextureAndroid style={[{ position: 'absolute', left: 0, top: 0, width: d, height: d }, style]}>
      <Svg width={d} height={d}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={color} stopOpacity={spec.opacity * (t.scheme === 'light' ? 1.6 : 1)} />
            <Stop offset="0.45" stopColor={color} stopOpacity={spec.opacity * 0.45 * (t.scheme === 'light' ? 1.6 : 1)} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={d / 2} cy={d / 2} r={d / 2} fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}

export function Backdrop() {
  const t = useTheme();
  const { width, height } = useWindowDimensions();
  return (
    // Clipped: the halos are larger than the screen. Unclipped, a mobile browser widens the page to
    // fit them and zooms the whole app out (content and sheets end up off-screen).
    <View style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]} pointerEvents="none">
      <LinearGradient colors={t.field} style={StyleSheet.absoluteFill} />
      {HALOS.map((h, i) => (
        <Halo key={h.color} spec={h} index={i} width={width} height={height} />
      ))}
      {/* Vignette: keeps edges calm and text legible. */}
      <LinearGradient
        colors={t.veil}
        style={StyleSheet.absoluteFill}
        start={{ x: 0.5, y: 0.35 }}
        end={{ x: 0.5, y: 1 }}
      />
      <DotGrid width={width} height={height} />
    </View>
  );
}

/**
 * Trame de points, nette en haut et qui s'efface vers le bas : sharp around the glass, softened under
 * it — it is what makes the blur read as glass.
 */
function DotGrid({ width, height }: { width: number; height: number }) {
  const t = useTheme();
  const dot = t.scheme === 'dark' ? 'rgba(246,243,255,0.12)' : 'rgba(22,16,50,0.12)';
  return (
    <View renderToHardwareTextureAndroid style={StyleSheet.absoluteFill}>
      <Svg width={width} height={height}>
        <Defs>
          <Pattern id="dots" width={22} height={22} patternUnits="userSpaceOnUse">
            <Circle cx={11} cy={11} r={1.2} fill={dot} />
          </Pattern>
          <SvgLinearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#fff" stopOpacity={1} />
            <Stop offset="0.5" stopColor="#fff" stopOpacity={0.35} />
            <Stop offset="0.9" stopColor="#fff" stopOpacity={0} />
          </SvgLinearGradient>
          <Mask id="grid-mask">
            <Rect width={width} height={height} fill="url(#fade)" />
          </Mask>
        </Defs>
        <Rect width={width} height={height} fill="url(#dots)" mask="url(#grid-mask)" />
      </Svg>
    </View>
  );
}
