import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { Image, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

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
/** Grain très fin (la matière du verre), une petite texture répétée. */
const GRAIN = require('../../../assets/images/grain.png') as number;

/**
 * Verre optique : l'arête est biseautée (bords haut et gauche qui accrochent la lumière, bas et
 * droite plus sombres, avec un reflet faible en bas à droite), une lumière d'angle éclaire l'intérieur
 * en haut à gauche, une ombre douce l'assombrit en bas à droite, et un grain très fin lui donne sa matière.
 */
function edges(dark: boolean) {
  return dark
    ? { hi: 'rgba(255,255,255,0.34)', side: 'rgba(255,255,255,0.16)', lo: 'rgba(255,255,255,0.07)', light: 'rgba(255,255,255,0.075)', shade: 'rgba(0,0,0,0.18)', depth: 'rgba(0,0,0,0.34)', grain: 0.11 }
    : { hi: 'rgba(255,255,255,1)', side: 'rgba(255,255,255,0.7)', lo: 'rgba(22,16,50,0.08)', light: 'rgba(255,255,255,0.55)', shade: 'rgba(22,16,50,0.035)', depth: 'rgba(22,16,50,0.06)', grain: 0.07 };
}
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
  const e = edges(t.scheme === 'dark');
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
        <LinearGradient colors={[e.light, 'transparent', e.shade]} locations={[0, 0.5, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        {/* Grain : sur Android, seulement sur les plaques surélevées et flottantes (une image de moins par carte de liste). */}
        {(!ANDROID || level !== 'pane') && <Image source={GRAIN} resizeMode="repeat" style={[StyleSheet.absoluteFill, { width: '100%', height: '100%', opacity: e.grain }]} />}
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
            borderWidth: 1,
            // Arête biseautée : lumière en haut et à gauche, ombre en bas et à droite.
            borderColor: glow ? `${t.accent}66` : toneColor !== null ? `${toneColor}44` : spec.rim,
            ...(glow || toneColor !== null ? {} : { borderTopColor: e.hi, borderLeftColor: e.side, borderRightColor: e.lo, borderBottomColor: e.lo }),
            boxShadow: ANDROID ? undefined : `inset 0px 1px 0px ${spec.specular}, inset 0px -1px 0px ${e.depth}`,
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
