import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { LIVE_BLUR, radius as radii, useTheme, type GlassLevel } from '../theme';

/**
 * A piece of glass. Not "blur + rgba": each level is a stack of physical cues —
 *   shadow (lift) · optional live blur (what is behind, softened) · tinted body ·
 *   sheen (light caught by the upper half) · tint wash (colour of what it holds) ·
 *   hairline rim + specular top edge (the edge catching light) · glow (it emits light when active).
 * Thicker levels are more opaque, lifted higher and catch more light.
 *
 * Android: blurred shadows are drawn per view and per frame (no caching), so only the floating
 * levels keep them; panes and raised cards rely on their rim, and the specular edge is a plain
 * line instead of an inset shadow. Same look at a fraction of the GPU cost.
 */
const ANDROID = Platform.OS === 'android';
export type GlassTone = 'neutral' | 'accent' | 'danger' | 'info' | 'warning';

export function Glass({
  level = 'pane',
  radius = radii.lg,
  tone = 'neutral',
  glow = false,
  blur,
  style,
  contentStyle,
  children,
  pointerEvents,
  docked = false,
}: {
  level?: GlassLevel;
  radius?: number;
  tone?: GlassTone;
  /** Emits accent light around itself (active / primary). */
  glow?: boolean;
  /** Force live blur on/off (defaults by level: floating layers only). */
  blur?: boolean;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  children?: ReactNode;
  pointerEvents?: 'auto' | 'none' | 'box-none' | 'box-only';
  /** Sits on the bottom edge of the screen: square bottom corners. */
  docked?: boolean;
}) {
  const t = useTheme();
  const spec = t.glass[level];
  const wantsBlur = blur ?? spec.blur > 0;
  const liveBlur = wantsBlur && LIVE_BLUR;
  const toneColor =
    tone === 'accent' ? t.accent : tone === 'danger' ? t.danger : tone === 'info' ? t.info : tone === 'warning' ? t.warning : null;
  const lifted = !ANDROID || level === 'float' || level === 'lens';
  const shadow = glow ? `${lifted ? `${spec.shadow}, ` : ''}0px 0px 32px ${t.accentGlow}` : lifted ? spec.shadow : undefined;
  const corners: ViewStyle = docked
    ? { borderTopLeftRadius: radius, borderTopRightRadius: radius, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }
    : { borderRadius: radius };

  return (
    <View pointerEvents={pointerEvents} style={[corners, { boxShadow: shadow }, style]}>
      <View style={[StyleSheet.absoluteFill, corners, { overflow: 'hidden' }]} pointerEvents="none">
        {liveBlur && <BlurView intensity={spec.blur} tint={t.blurTint} style={StyleSheet.absoluteFill} />}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: wantsBlur && !LIVE_BLUR ? spec.solidFill : spec.fill }]} />
        <LinearGradient colors={spec.sheen} locations={[0, 0.6]} style={StyleSheet.absoluteFill} />
        {toneColor !== null && (
          <LinearGradient
            colors={[`${toneColor}2E`, `${toneColor}08`]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        )}
      </View>
      {/* box-none must reach the content layer too, or it still swallows taps meant for what is underneath. */}
      <View pointerEvents={pointerEvents === 'box-none' ? 'box-none' : undefined} style={[corners, contentStyle]}>
        {children}
      </View>
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          corners,
          {
            borderWidth: StyleSheet.hairlineWidth * 1.5,
            borderColor: glow ? `${t.accent}66` : toneColor !== null ? `${toneColor}44` : spec.rim,
            boxShadow: ANDROID ? undefined : `inset 0px 1px 0px ${spec.specular}`,
          },
        ]}
      />
      {ANDROID && (
        <View
          pointerEvents="none"
          style={{ position: 'absolute', top: StyleSheet.hairlineWidth * 1.5, left: radius * 0.6, right: radius * 0.6, height: 1, backgroundColor: spec.specular }}
        />
      )}
    </View>
  );
}
