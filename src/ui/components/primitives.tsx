import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { Children, useState, type ComponentProps, type ReactNode } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text as RNText,
  TextInput,
  View,
  type LayoutChangeEvent,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { springs } from '../motion';
import { family, font, HIT, radius, shade, space, useTheme } from '../theme';
import { Glass, type GlassTone } from './Glass';

export type IconName = ComponentProps<typeof Ionicons>['name'];

// ---------------------------------------------------------------- style split

const OUTER_KEYS = new Set([
  'margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'marginHorizontal', 'marginVertical',
  'flex', 'flexGrow', 'flexShrink', 'flexBasis', 'alignSelf', 'position', 'top', 'left', 'right', 'bottom',
  'zIndex', 'width', 'minWidth', 'maxWidth',
]);

/** Splits a style between the outer shell (placement in the parent) and the inner body (look, layout). */
export function splitStyle(style: StyleProp<ViewStyle>): { outer: ViewStyle; inner: ViewStyle } {
  const flat: Record<string, unknown> = { ...(StyleSheet.flatten(style) ?? {}) };
  const outer: Record<string, unknown> = {};
  const inner: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(flat)) (OUTER_KEYS.has(k) ? outer : inner)[k] = v;
  return { outer, inner };
}

// ---------------------------------------------------------------- typography

type TextVariant = 'hero' | 'large' | 'title' | 'headline' | 'body' | 'bodyStrong' | 'small' | 'caption' | 'label' | 'number';
type TextTone = 'default' | 'secondary' | 'muted' | 'accent' | 'danger' | 'warning' | 'onAccent' | 'info' | 'gold';

const VARIANTS: Record<TextVariant, TextStyle> = {
  hero: { fontFamily: family.display, fontSize: font.hero, lineHeight: 46, letterSpacing: -1.2 },
  large: { fontFamily: family.display, fontSize: font.large, lineHeight: 36, letterSpacing: -0.8 },
  title: { fontFamily: family.displaySemi, fontSize: font.title, lineHeight: 26, letterSpacing: -0.3 },
  headline: { fontFamily: family.semibold, fontSize: 17, lineHeight: 22, letterSpacing: -0.2 },
  body: { fontFamily: family.regular, fontSize: font.body, lineHeight: 21 },
  bodyStrong: { fontFamily: family.semibold, fontSize: font.body, lineHeight: 21 },
  small: { fontFamily: family.regular, fontSize: font.small, lineHeight: 18 },
  caption: { fontFamily: family.medium, fontSize: font.caption, lineHeight: 16 },
  label: { fontFamily: family.medium, fontSize: 12, lineHeight: 16, letterSpacing: 0.1 },
  number: { fontFamily: family.number, fontSize: font.input, letterSpacing: -0.3 },
};

export function Text({
  variant = 'body',
  tone = 'default',
  numeric = false,
  style,
  // System font size is honoured up to +30 %: beyond that, layouts built for phones break
  // (Android goes to ×2 and more). Constrained chrome passes a lower cap.
  maxFontSizeMultiplier = 1.3,
  ...rest
}: TextProps & { variant?: TextVariant; tone?: TextTone; numeric?: boolean }) {
  const t = useTheme();
  const color: Record<TextTone, string> = {
    default: t.text,
    secondary: t.textSecondary,
    muted: t.textMuted,
    accent: t.accent,
    danger: t.danger,
    warning: t.warning,
    onAccent: t.onAccent,
    info: t.info,
    gold: t.gold,
  };
  // A custom size without a custom line height inherits a line height proportional to it
  // (otherwise big numbers keep the variant's 21px and collide with what is above).
  const flat = StyleSheet.flatten(style);
  const autoLine = flat?.fontSize !== undefined && flat.lineHeight === undefined ? { lineHeight: Math.round(flat.fontSize * 1.22) } : null;
  return <RNText {...rest} maxFontSizeMultiplier={maxFontSizeMultiplier} style={[VARIANTS[variant], { color: color[tone] }, numeric && { fontVariant: ['tabular-nums'] }, style, autoLine]} />;
}

export function Icon({ name, size = 20, color, style }: { name: IconName; size?: number; color?: string; style?: StyleProp<TextStyle> }) {
  const t = useTheme();
  return <Ionicons name={name} size={size} color={color ?? t.text} style={style} />;
}

// ---------------------------------------------------------------- Tap: the physical press

/**
 * Every pressable thing: sinks under the finger (spring), lights up on hover (web),
 * and — when `magnetic` — leans toward the pointer.
 */
export function Tap({
  children,
  style,
  scaleTo = 0.965,
  magnetic = false,
  highlight = true,
  highlightRadius,
  disabled,
  ...props
}: Omit<PressableProps, 'style' | 'children'> & {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  scaleTo?: number;
  magnetic?: boolean;
  highlight?: boolean;
  highlightRadius?: number;
}) {
  const t = useTheme();
  const press = useSharedValue(1);
  const hover = useSharedValue(0);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const { outer, inner } = splitStyle(style);
  const r = highlightRadius ?? (typeof inner.borderRadius === 'number' ? inner.borderRadius : radius.md);

  const body = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: press.value }],
  }));
  const glow = useAnimatedStyle(() => ({ opacity: hover.value }));

  return (
    <Pressable
      {...props}
      disabled={disabled}
      style={[outer, disabled === true && { opacity: 0.4 }]}
      onPressIn={(e) => {
        press.set(withSpring(scaleTo, springs.snappy));
        props.onPressIn?.(e);
      }}
      onPressOut={(e) => {
        press.set(withSpring(1, springs.liquid));
        props.onPressOut?.(e);
      }}
      onHoverIn={(e) => {
        hover.set(withTiming(1, { duration: 160 }));
        props.onHoverIn?.(e);
      }}
      onHoverOut={(e) => {
        hover.set(withTiming(0, { duration: 220 }));
        tx.set(withSpring(0, springs.soft));
        ty.set(withSpring(0, springs.soft));
        props.onHoverOut?.(e);
      }}
      onLayout={magnetic ? (e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height }) : props.onLayout}
      onPointerMove={
        magnetic && Platform.OS === 'web'
          ? (e) => {
              const { offsetX, offsetY } = e.nativeEvent;
              if (size.w === 0) return;
              tx.set(withSpring(((offsetX - size.w / 2) / size.w) * 8, springs.soft));
              ty.set(withSpring(((offsetY - size.h / 2) / size.h) * 6, springs.soft));
            }
          : undefined
      }>
      <Animated.View style={[inner, body]}>
        {children}
        {highlight && (
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { borderRadius: r, backgroundColor: t.surfacePressed }, glow]}
          />
        )}
      </Animated.View>
    </Pressable>
  );
}

// ---------------------------------------------------------------- buttons

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  size = 'md',
  disabled,
  style,
  onLongPress,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  onLongPress?: () => void;
}) {
  const t = useTheme();
  const height = size === 'lg' ? 58 : size === 'sm' ? 38 : 48;
  const r = size === 'lg' ? radius.lg : radius.md;
  const fg: Record<ButtonVariant, string> = { primary: t.onAccent, secondary: t.text, ghost: t.accent, danger: t.danger };
  const content = (
    <View style={{ height, paddingHorizontal: size === 'sm' ? space.md : space.lg + 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm }}>
      {icon !== undefined && <Ionicons name={icon} size={size === 'sm' ? 16 : 19} color={fg[variant]} />}
      <RNText
        numberOfLines={2}
        maxFontSizeMultiplier={1.25}
        style={{ color: fg[variant], fontFamily: family.semibold, fontSize: size === 'lg' ? 17 : size === 'sm' ? 14 : 15, letterSpacing: -0.1, flexShrink: 1, textAlign: 'center' }}>
        {label}
      </RNText>
    </View>
  );
  const { outer, inner } = splitStyle(style);

  return (
    <Tap
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      magnetic={variant === 'primary' && size === 'lg'}
      accessibilityRole="button"
      accessibilityLabel={label}
      highlightRadius={r}
      style={[outer, inner]}>
      {variant === 'primary' ? (
        // Liquid light: a lit gradient body with a bright upper edge and an aura.
        <View style={{ borderRadius: r, boxShadow: shade(`0px 10px 28px ${t.accentGlow}, inset 0px 1px 0px ${t.highlight}`) }}>
          <LinearGradient colors={t.accentGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: r }}>
            <LinearGradient colors={['rgba(255,255,255,0.35)', 'rgba(255,255,255,0)']} locations={[0, 0.55]} style={{ borderRadius: r }}>
              {content}
            </LinearGradient>
          </LinearGradient>
        </View>
      ) : variant === 'ghost' ? (
        content
      ) : (
        <Glass level="raised" radius={r} tone={variant === 'danger' ? 'danger' : 'neutral'}>
          {content}
        </Glass>
      )}
    </Tap>
  );
}

export function IconButton({
  icon,
  onPress,
  label,
  color,
  size = 22,
  style,
  hitSize = HIT,
  glass = false,
}: {
  icon: IconName;
  onPress: () => void;
  label: string;
  color?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
  hitSize?: number;
  /** Sits on its own glass bead (for floating controls). */
  glass?: boolean;
}) {
  const t = useTheme();
  const glyph = <Ionicons name={icon} size={size} color={color ?? t.textSecondary} />;
  return (
    <Tap onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={6} scaleTo={0.88} highlightRadius={hitSize / 2} style={style}>
      {glass ? (
        <Glass level="raised" radius={hitSize / 2} style={{ width: hitSize, height: hitSize }} contentStyle={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          {glyph}
        </Glass>
      ) : (
        <View style={{ width: hitSize, height: hitSize, alignItems: 'center', justifyContent: 'center' }}>{glyph}</View>
      )}
    </Tap>
  );
}

// ---------------------------------------------------------------- surfaces

export function Card({
  children,
  style,
  onPress,
  level = 'pane',
  glow = false,
  tone,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  level?: 'pane' | 'raised' | 'float';
  glow?: boolean;
  tone?: GlassTone;
}) {
  const { outer, inner } = splitStyle(style);
  const glass = (
    <Glass level={level} glow={glow} tone={tone} contentStyle={[{ padding: space.lg }, inner]} style={onPress === undefined ? outer : undefined}>
      {children}
    </Glass>
  );
  if (onPress === undefined) return glass;
  return (
    <Tap onPress={onPress} style={outer} highlightRadius={radius.lg} scaleTo={0.985}>
      {glass}
    </Tap>
  );
}

export function Chip({
  label,
  selected = false,
  onPress,
  tone,
  small = false,
  icon,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  tone?: string;
  small?: boolean;
  icon?: IconName;
}) {
  const t = useTheme();
  const color = tone ?? t.accent;
  const h = small ? 30 : 36;
  return (
    <Tap
      onPress={onPress}
      disabled={onPress === undefined}
      accessibilityRole={onPress === undefined ? 'text' : 'button'}
      accessibilityState={{ selected }}
      hitSlop={small ? 6 : 0}
      scaleTo={0.92}
      highlightRadius={h / 2}
      style={{
        height: h,
        maxWidth: '100%',
        paddingHorizontal: small ? space.md - 2 : space.md + 2,
        borderRadius: h / 2,
        borderWidth: StyleSheet.hairlineWidth * 1.5,
        borderColor: selected ? `${color}88` : t.glass.pane.rim,
        backgroundColor: selected ? `${color}24` : t.glass.pane.fill,
        boxShadow: shade(selected ? `0px 0px 16px ${color}40, inset 0px 1px 0px ${t.highlight}` : `inset 0px 1px 0px ${t.glass.pane.specular}`, true),
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
      }}>
      {icon !== undefined && <Ionicons name={icon} size={small ? 13 : 15} color={selected ? color : t.textSecondary} />}
      <RNText numberOfLines={1} maxFontSizeMultiplier={1.2} style={{ color: selected ? color : t.textSecondary, fontSize: small ? 12.5 : 13.5, fontFamily: family.semibold, flexShrink: 1 }}>
        {label}
      </RNText>
    </Tap>
  );
}

export function Badge({ label, color, icon }: { label: string; color: string; icon?: IconName }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 9,
        minHeight: 22,
        maxWidth: '100%',
        flexShrink: 1,
        borderRadius: radius.pill,
        backgroundColor: `${color}22`,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: `${color}55`,
      }}>
      {icon !== undefined ? (
        <Ionicons name={icon} size={11} color={color} />
      ) : (
        <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: color, boxShadow: shade(`0px 0px 6px ${color}`, true) }} />
      )}
      <RNText numberOfLines={1} maxFontSizeMultiplier={1.2} style={{ color, fontSize: 11.5, fontFamily: family.semibold, flexShrink: 1 }}>
        {label}
      </RNText>
    </View>
  );
}

export function SectionTitle({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        columnGap: space.md,
        marginTop: space.xl + 4,
        marginBottom: space.sm + 2,
        minHeight: 28,
        paddingHorizontal: 2,
      }}>
      <Text variant="headline" style={{ flexShrink: 0 }}>
        {title}
      </Text>
      {action}
    </View>
  );
}

/**
 * A folded section: a quiet row (title, optional one-line summary, chevron) that unfolds its
 * content. For what is useful but rare — the essential stays visible, the rest one tap away.
 */
export function Disclosure({ title, summary, children, initiallyOpen = false }: { title: string; summary?: string; children: ReactNode; initiallyOpen?: boolean }) {
  const t = useTheme();
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <View style={{ marginTop: space.lg }}>
      <Tap
        onPress={() => setOpen(!open)}
        scaleTo={0.99}
        highlightRadius={radius.md}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={title}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 48, paddingHorizontal: 2 }}>
        <Text variant="label" tone="muted" style={{ flexShrink: 0 }}>
          {title}
        </Text>
        <Text variant="small" tone="muted" numberOfLines={1} style={{ flex: 1, textAlign: 'right' }}>
          {open ? '' : (summary ?? '')}
        </Text>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={18} color={t.textMuted} />
      </Tap>
      {open && <View style={{ marginTop: space.xs }}>{children}</View>}
    </View>
  );
}

export function Row({
  title,
  subtitle,
  right,
  onPress,
  icon,
  style,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onPress?: () => void;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const body = (
    <View style={[{ minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.sm + 2 }, style]}>
      {icon !== undefined && (
        <View style={{ width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: t.surfaceAlt, boxShadow: shade(`inset 0px 1px 0px ${t.glass.pane.specular}`, true) }}>
          <Ionicons name={icon} size={18} color={t.textSecondary} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong" numberOfLines={2}>
          {title}
        </Text>
        {subtitle !== undefined && subtitle !== '' && (
          <Text variant="small" tone="secondary" numberOfLines={2}>
            {subtitle}
          </Text>
        )}
      </View>
      {right}
      {onPress !== undefined && right === undefined && <Ionicons name="chevron-forward" size={17} color={t.textMuted} />}
    </View>
  );
  if (onPress === undefined) return body;
  return (
    <Tap onPress={onPress} scaleTo={0.985} highlightRadius={0}>
      {body}
    </Tap>
  );
}

/** A glass pane holding rows, separated by hairlines of light. */
export function Group({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  const items = Children.toArray(children);
  return (
    <Glass style={style} contentStyle={{ overflow: 'hidden' }}>
      {items.map((child, i) => (
        <View key={i}>
          {i > 0 && <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.border, marginLeft: space.lg }} />}
          {child}
        </View>
      ))}
    </Glass>
  );
}

export function Divider() {
  const t = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.border }} />;
}

// ---------------------------------------------------------------- inputs

export function Field(props: TextInputProps & { label?: string }) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  const { label, style, onFocus, onBlur, ...rest } = props;
  return (
    <View style={{ gap: space.xs + 2 }}>
      {label !== undefined && (
        <Text variant="label" tone="muted">
          {label}
        </Text>
      )}
      <TextInput
        placeholderTextColor={t.textMuted}
        selectionColor={t.accent}
        maxFontSizeMultiplier={1.3}
        {...rest}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[
          {
            minHeight: 50,
            borderRadius: radius.md,
            backgroundColor: t.glass.pane.fill,
            borderWidth: 1,
            borderColor: focused ? `${t.accent}AA` : t.glass.pane.rim,
            boxShadow: shade(focused ? `0px 0px 0px 4px ${t.accentSoft}, inset 0px 1px 0px ${t.glass.pane.specular}` : `inset 0px 1px 0px ${t.glass.pane.specular}`),
            color: t.text,
            paddingHorizontal: space.md + 2,
            fontSize: font.body,
            fontFamily: family.medium,
          },
          Platform.OS === 'web' && { outlineWidth: 0, outlineColor: 'transparent' },
          style,
        ]}
      />
    </View>
  );
}

/** Compact − value + control for small integers / decimals (sets, reps, percent…). */
export function Stepper({
  value,
  onChange,
  step = 1,
  min = 0,
  max = 999,
  format = (v: number) => String(v),
  label,
  snap = false,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  format?: (v: number) => string;
  label?: string;
  /** Steps land on multiples of `step` (83 % + 2,5 → 85 %), instead of adding `step` to the value. */
  snap?: boolean;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v * 1000) / 1000));
  const next = (dir: 1 | -1) => {
    if (!snap) return clamp(value + dir * step);
    const k = value / step;
    return clamp((dir === 1 ? Math.floor(k + 1e-6) + 1 : Math.ceil(k - 1e-6) - 1) * step);
  };
  // Narrow slot (grids on small phones): tighter buttons so the value always keeps room.
  const [width, setWidth] = useState(0);
  const tight = width > 0 && width < 150;
  return (
    <View style={{ gap: space.xs + 2 }}>
      {label !== undefined && (
        <Text variant="label" tone="muted" numberOfLines={2} maxFontSizeMultiplier={1.2}>
          {label}
        </Text>
      )}
      <Glass radius={radius.md} contentStyle={{ flexDirection: 'row', alignItems: 'center', height: 50 }}>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
          <IconButton icon="remove" label="Diminuer" onPress={() => onChange(next(-1))} size={tight ? 16 : 18} hitSize={tight ? 34 : HIT} />
          <Text
            variant="number"
            numeric
            style={{ flex: 1, minWidth: 0, textAlign: 'center', fontSize: tight ? 14.5 : 16 }}
            numberOfLines={1}
            adjustsFontSizeToFit
            maxFontSizeMultiplier={1.2}>
            {format(value)}
          </Text>
          <IconButton icon="add" label="Augmenter" onPress={() => onChange(next(1))} size={tight ? 16 : 18} hitSize={tight ? 34 : HIT} />
        </View>
      </Glass>
    </View>
  );
}

/**
 * A setting with a compact stepper on the right: label (and hint) on the left, − value + on the
 * right. Fits any phone width, unlike several steppers side by side.
 */
export function StepperRow({
  label,
  hint,
  ...stepper
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  format?: (v: number) => string;
}) {
  return (
    // Wraps: on very narrow screens the stepper drops under its label instead of squeezing it.
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space.md, rowGap: space.xs, minHeight: 50 }}>
      <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: 120, minWidth: 0 }}>
        <Text variant="bodyStrong">{label}</Text>
        {hint !== undefined && (
          <Text variant="caption" tone="muted">
            {hint}
          </Text>
        )}
      </View>
      <View style={{ flexGrow: 1, flexBasis: 152, maxWidth: 200 }}>
        <Stepper {...stepper} />
      </View>
    </View>
  );
}

/** Options on a glass rail; a raised glass thumb glides to the choice. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const t = useTheme();
  const [w, setW] = useState(0);
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const seg = options.length === 0 ? 0 : w / options.length;
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: withSpring(index * seg, springs.liquid) }] }), [index, seg]);
  return (
    <Glass radius={radius.md + 2} contentStyle={{ padding: 4 }}>
      <View style={{ flexDirection: 'row' }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
        {seg > 0 && (
          <Animated.View
            style={[
              {
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: 0,
                width: seg,
                borderRadius: radius.md - 2,
                backgroundColor: t.glass.raised.solidFill,
                boxShadow: shade(`0px 4px 14px ${t.wellShade}, inset 0px 1px 0px ${t.glass.raised.specular}`),
              },
              thumb,
            ]}
          />
        )}
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <Pressable
              key={o.value}
              onPress={() => onChange(o.value)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={{ flex: 1, minHeight: 36, paddingVertical: 4, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
              <RNText
                numberOfLines={2}
                maxFontSizeMultiplier={1.2}
                style={{ color: selected ? t.text : t.textSecondary, fontFamily: family.semibold, fontSize: seg > 0 && seg < 96 ? 12 : 13, textAlign: 'center' }}>
                {o.label}
              </RNText>
            </Pressable>
          );
        })}
      </View>
    </Glass>
  );
}

/** Glass switch: the thumb is a bead of light sliding in a groove that fills when on. */
export function Toggle({ value, onValueChange, label }: { value: boolean; onValueChange: (v: boolean) => void; label?: string }) {
  const t = useTheme();
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: withSpring(value ? 20 : 0, springs.liquid) }] }), [value]);
  const fill = useAnimatedStyle(() => ({ opacity: withTiming(value ? 1 : 0, { duration: 200 }) }), [value]);
  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      hitSlop={8}
      style={{ width: 50, height: 30, borderRadius: 15, padding: 3, backgroundColor: t.surfaceAlt, boxShadow: shade(`inset 0px 1px 3px ${t.wellShade}`), borderWidth: StyleSheet.hairlineWidth, borderColor: t.border }}>
      <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: 15, overflow: 'hidden' }, fill]}>
        <LinearGradient colors={t.accentGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <Animated.View
        style={[
          { width: 24, height: 24, borderRadius: 12, backgroundColor: t.knob, boxShadow: shade(`0px 2px 6px ${t.wellShade}`) },
          knob,
        ]}
      />
    </Pressable>
  );
}

/** Empty states: a glowing glass orb, a sentence, and the next step. */
export function EmptyState({ icon, title, body, action }: { icon: IconName; title: string; body?: string; action?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: space.xxl, paddingHorizontal: space.xl, gap: space.sm + 2 }}>
      <Glass level="raised" radius={36} style={{ width: 72, height: 72, marginBottom: space.sm, boxShadow: shade(`0px 0px 40px ${t.accentGlow}`) }} contentStyle={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={30} color={t.accent} />
      </Glass>
      <Text variant="title" style={{ textAlign: 'center' }}>
        {title}
      </Text>
      {body !== undefined && (
        <Text tone="secondary" style={{ textAlign: 'center', maxWidth: 360 }}>
          {body}
        </Text>
      )}
      {action}
    </View>
  );
}

/** Kept for existing call sites; prefer Tap. */
export function PressableScale(props: PressableProps & { style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const { style, children, ...rest } = props;
  return (
    <Tap {...rest} style={style}>
      {children}
    </Tap>
  );
}

/** A nullable number: "Auto" follows the cycle / exercise default; a value overrides it. */
export function AutoStepper({
  label,
  value,
  fallback,
  onChange,
  step = 1,
  min = 0,
  max = 20,
  format = (v: number) => String(v),
  autoLabel = 'Suit le cycle',
  snap,
}: {
  label: string;
  value: number | null;
  fallback: number;
  onChange: (v: number | null) => void;
  step?: number;
  min?: number;
  max?: number;
  format?: (v: number) => string;
  autoLabel?: string;
  snap?: boolean;
}) {
  return (
    <View style={{ gap: space.xs + 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="label" tone="muted" numberOfLines={2} style={{ flexShrink: 1 }} maxFontSizeMultiplier={1.2}>
          {label}
        </Text>
        <Chip label="Auto" small selected={value === null} onPress={() => onChange(value === null ? fallback : null)} />
      </View>
      {value === null ? (
        <View style={{ height: 50, justifyContent: 'center' }}>
          <Text variant="small" tone="muted">
            {autoLabel} ({format(fallback)})
          </Text>
        </View>
      ) : (
        <Stepper value={value} step={step} snap={snap} min={min} max={max} format={format} onChange={onChange} />
      )}
    </View>
  );
}
