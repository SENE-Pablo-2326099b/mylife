import { Children, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, LinearGradient as SvgGradient, Stop } from 'react-native-svg';

import { useBreakpoint } from '../responsive';
import { family, space, useTheme } from '../theme';
import { Text } from './primitives';
import { Rolling } from './Rolling';

/**
 * Side-by-side columns on desktop, stacked elsewhere. `weights` sets each column's share.
 */
export function Columns({ children, weights, gap = space.xl, style }: { children: ReactNode; weights?: number[]; gap?: number; style?: StyleProp<ViewStyle> }) {
  const wide = useBreakpoint() === 'expanded';
  const items = Children.toArray(children);
  if (!wide) return <View style={style}>{items}</View>;
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'flex-start', gap }, style]}>
      {items.map((child, i) => (
        <View key={i} style={{ flex: weights?.[i] ?? 1, minWidth: 0 }}>
          {child}
        </View>
      ))}
    </View>
  );
}

/** Responsive grid: `min` is the narrowest a cell may get before wrapping to fewer columns. */
export function Grid({ children, columns, gap = space.md }: { children: ReactNode; columns: Partial<Record<'compact' | 'medium' | 'expanded', number>>; gap?: number }) {
  const bp = useBreakpoint();
  const n = columns[bp] ?? columns.compact ?? 1;
  const items = Children.toArray(children);
  const rows: ReactNode[][] = [];
  items.forEach((c, i) => {
    const r = Math.floor(i / n);
    (rows[r] ??= []).push(c);
  });
  return (
    <View style={{ gap }}>
      {rows.map((row, r) => (
        <View key={r} style={{ flexDirection: 'row', gap }}>
          {Array.from({ length: n }, (_, i) => (
            <View key={i} style={{ flex: 1, minWidth: 0 }}>
              {row[i] ?? null}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

/**
 * A ring of light: the track is etched glass, the arc is lit (gradient + glow).
 * Used for cycle week, session completion.
 */
export function ProgressRing({
  value,
  size = 72,
  stroke = 7,
  label,
  caption,
}: {
  value: number;
  size?: number;
  stroke?: number;
  label?: string;
  caption?: string;
}) {
  const t = useTheme();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Defs>
          <SvgGradient id="ring" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={t.accentGradient[0]} />
            <Stop offset="1" stopColor={t.gold} />
          </SvgGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={t.surfaceAlt} strokeWidth={stroke} fill="none" />
        {v > 0 && (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke="url(#ring)"
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${c} ${c}`}
            strokeDashoffset={c * (1 - v)}
          />
        )}
      </Svg>
      {label !== undefined && <Text style={{ fontFamily: family.display, fontSize: size * 0.28, letterSpacing: -0.5, color: t.text }}>{label}</Text>}
      {caption !== undefined && (
        <Text variant="caption" tone="muted" style={{ fontSize: Math.max(9, size * 0.12), marginTop: -2 }}>
          {caption}
        </Text>
      )}
    </View>
  );
}

/** Big number with a label, for KPI bands. */
export function Metric({ label, value, unit, hint, tone }: { label: string; value: string; unit?: string; hint?: string; tone?: 'accent' | 'default' }) {
  const t = useTheme();
  return (
    <View style={{ gap: 2, flex: 1, minWidth: 0 }}>
      <Text variant="label" tone="muted" numberOfLines={2}>
        {label}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
        {value.length <= 7 ? (
          // Chiffres courts : ils roulent jusqu'à leur valeur (à l'ouverture et à chaque changement).
          <Rolling text={value} lineHeight={36} style={{ fontFamily: family.display, fontSize: 30, letterSpacing: -1, color: tone === 'accent' ? t.accent : t.text }} />
        ) : (
          <Text style={{ fontFamily: family.display, fontSize: 30, letterSpacing: -1, color: tone === 'accent' ? t.accent : t.text }} numberOfLines={1} adjustsFontSizeToFit>
            {value}
          </Text>
        )}
        {unit !== undefined && (
          <Text variant="small" tone="secondary">
            {unit}
          </Text>
        )}
      </View>
      {hint !== undefined && (
        <Text variant="caption" tone="muted">
          {hint}
        </Text>
      )}
    </View>
  );
}
