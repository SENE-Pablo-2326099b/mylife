import { LinearGradient as Fill } from 'expo-linear-gradient';
import { useState } from 'react';
import { View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';

import { monotonePath } from '../curve';
import { family, shade, space, useTheme } from '../theme';
import { Glass } from './Glass';
import { Text } from './primitives';

/**
 * Charts drawn with light. Single-series each: the series is a beam (lime → cyan gradient) with a
 * soft halo, the area beneath is a faint wash, the grid is barely etched. No legend — the section
 * title names the series. Touch-and-drag on a line chart scrubs a crosshair with the exact value.
 */

export interface LinePoint {
  /** Any monotonic x (timestamp, index…). */
  x: number;
  y: number;
  label: string;
  /** Unreliable estimate (e.g. e1RM from a set above 6 reps): drawn as a hollow amber ring. */
  weak?: boolean;
}

function niceBounds(min: number, max: number): [number, number] {
  if (min === max) return [min - 1, max + 1];
  const pad = (max - min) * 0.14;
  return [min - pad, max + pad];
}

let uid = 0;
const nextId = () => `c${(uid += 1)}`;

export function LineChart({
  points,
  height = 190,
  formatY = (v: number) => v.toFixed(1).replace('.', ','),
  target,
  dots = false,
}: {
  points: readonly LinePoint[];
  height?: number;
  formatY?: (v: number) => string;
  /** A goal drawn as a dashed gold line (kept inside the scale). */
  target?: { y: number; label: string };
  /** Mark every point (real measurements, e.g. daily weigh-ins). */
  dots?: boolean;
}) {
  const t = useTheme();
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const [ids] = useState(() => ({ stroke: nextId(), area: nextId() }));
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  if (points.length === 0) return null;
  const padX = 6;
  const padT = 14;
  const padB = 10;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
  const scaleYs = target === undefined ? ys : [...ys, target.y];
  const [minY, maxY] = niceBounds(Math.min(...scaleYs), Math.max(...scaleYs));
  const sx = (x: number) => (maxX === minX ? width / 2 : padX + ((x - minX) / (maxX - minX)) * (width - padX * 2));
  const sy = (y: number) => padT + (1 - (y - minY) / (maxY - minY)) * (height - padT - padB);

  // Smooth but faithful: monotone cubic (Fritsch–Carlson). The curve never overshoots a point nor
  // loops back, even with uneven gaps or two points close together (the old Catmull-Rom did).
  const pts: [number, number][] = points.map((p) => [sx(p.x), sy(p.y)]);
  const d = monotonePath(pts);
  const first = pts[0];
  const last = pts[pts.length - 1];
  const area = first === undefined || last === undefined ? '' : `${d} L${last[0].toFixed(1)},${height - padB} L${first[0].toFixed(1)},${height - padB} Z`;

  const nearest = (e: GestureResponderEvent) => {
    const x = e.nativeEvent.locationX;
    let best = 0;
    let bestDist = Infinity;
    pts.forEach(([px], i) => {
      const dist = Math.abs(px - x);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    });
    setActive(best);
  };

  const shownIndex = active ?? points.length - 1;
  const shown = points[shownIndex];
  const shownPt = pts[shownIndex];
  const gridYs = [0.25, 0.5, 0.75].map((f) => padT + f * (height - padT - padB));

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: space.sm, rowGap: 2, minHeight: 30 }}>
        {shown !== undefined && (
          <>
            <Text style={{ fontFamily: family.display, fontSize: 24, letterSpacing: -0.6, color: t.text, flexShrink: 0 }} numberOfLines={1}>
              {formatY(shown.y)}
            </Text>
            <Text variant="small" tone="secondary">
              {shown.label}
            </Text>
            {shown.weak === true && (
              <Text variant="caption" style={{ color: t.warning }}>
                estimation peu fiable
              </Text>
            )}
          </>
        )}
      </View>
      <View
        onLayout={onLayout}
        style={{ height }}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={nearest}
        onResponderMove={nearest}
        onResponderRelease={() => setActive(null)}
        onResponderTerminate={() => setActive(null)}
        accessible
        accessibilityLabel={`Courbe, ${points.length} points, dernier ${points[points.length - 1] === undefined ? '' : formatY(points[points.length - 1]?.y ?? 0)}`}>
        {width > 0 && (
          <Svg width={width} height={height}>
            <Defs>
              <LinearGradient id={ids.stroke} x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={t.gold} />
                <Stop offset="1" stopColor={t.accent} />
              </LinearGradient>
              <LinearGradient id={ids.area} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={t.accent} stopOpacity={0.22} />
                <Stop offset="1" stopColor={t.accent} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            {gridYs.map((y) => (
              <Line key={y} x1={0} x2={width} y1={y} y2={y} stroke={t.border} strokeWidth={1} />
            ))}
            {target !== undefined && (
              <Line x1={0} x2={width} y1={sy(target.y)} y2={sy(target.y)} stroke={t.gold} strokeWidth={1.5} strokeDasharray="5 5" opacity={0.8} />
            )}
            {points.length > 1 && <Path d={area} fill={`url(#${ids.area})`} />}
            {points.length > 1 && <Path d={d} stroke={`url(#${ids.stroke})`} strokeOpacity={0.25} strokeWidth={9} fill="none" strokeLinejoin="round" strokeLinecap="round" />}
            <Path d={d} stroke={`url(#${ids.stroke})`} strokeWidth={2.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
            {dots && pts.length <= 120 && pts.map(([x, y], i) => <Circle key={`d${i}`} cx={x} cy={y} r={2.5} fill={t.accent} opacity={0.9} />)}
            {pts.map(([x, y], i) =>
              points[i]?.weak === true ? <Circle key={i} cx={x} cy={y} r={3.5} fill={t.bg} stroke={t.warning} strokeWidth={1.5} /> : null,
            )}
            {active !== null && shownPt !== undefined && <Line x1={shownPt[0]} x2={shownPt[0]} y1={0} y2={height} stroke={t.textMuted} strokeWidth={1} />}
            {shownPt !== undefined && (
              <>
                <Circle cx={shownPt[0]} cy={shownPt[1]} r={11} fill={t.accent} opacity={0.18} />
                <Circle cx={shownPt[0]} cy={shownPt[1]} r={5} fill={t.accent} stroke={t.bg} strokeWidth={2} />
              </>
            )}
          </Svg>
        )}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
        <Text variant="caption" tone="muted">
          {points[0]?.label}
        </Text>
        <Text variant="caption" tone="muted">
          {target !== undefined ? `${target.label} · ` : ''}min {formatY(Math.min(...ys))} · max {formatY(Math.max(...ys))}
        </Text>
      </View>
    </View>
  );
}

/** Vertical columns of light with the value on the cap — e.g. max e1RM per mesocycle. */
export function ColumnChart({
  data,
  height = 160,
  formatValue = (v: number) => v.toFixed(0),
  highlightLast = true,
}: {
  data: readonly { label: string; value: number }[];
  height?: number;
  formatValue?: (v: number) => string;
  highlightLast?: boolean;
}) {
  const t = useTheme();
  if (data.length === 0) return null;
  const values = data.map((d) => d.value);
  const max = Math.max(...values);
  // Scale starts near the data so cycle-to-cycle progress is visible; the caption says so.
  const floor = Math.max(0, Math.min(...values) * 0.85);
  const span = Math.max(1e-6, max - floor);
  return (
    <View>
      <View style={{ height, flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, borderBottomWidth: 1, borderBottomColor: t.border }}>
        {data.map((d, i) => {
          const h = 20 + ((d.value - floor) / span) * (height - 44);
          const lit = !highlightLast || i === data.length - 1;
          return (
            <View key={`${d.label}-${i}`} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end' }}>
              <Text variant="caption" tone={lit ? 'default' : 'secondary'} numeric style={{ marginBottom: 4, fontFamily: family.displaySemi }}>
                {formatValue(d.value)}
              </Text>
              <View style={{ width: '64%', maxWidth: 28, height: h, borderTopLeftRadius: 8, borderTopRightRadius: 8, overflow: 'hidden', boxShadow: shade(lit ? `0px 0px 18px ${t.accentGlow}` : undefined, true), opacity: lit ? 1 : 0.45 }}>
                <Fill colors={[t.accentGradient[0], `${t.gold}AA`]} style={{ flex: 1 }} />
              </View>
            </View>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', gap: space.sm, marginTop: 6 }}>
        {data.map((d, i) => (
          <Text key={`${d.label}-${i}`} variant="caption" tone="muted" numberOfLines={1} style={{ flex: 1, textAlign: 'center' }}>
            {d.label}
          </Text>
        ))}
      </View>
      <Text variant="caption" tone="muted" style={{ marginTop: 4 }}>
        Échelle à partir de {formatValue(floor)}
      </Text>
    </View>
  );
}

/** Horizontal bars of light with the value at the tip — weekly sets per muscle. */
export function BarList({
  data,
  formatValue = (v: number) => String(v),
  max,
}: {
  data: readonly { label: string; value: number; color?: string }[];
  formatValue?: (v: number) => string;
  max?: number;
}) {
  const t = useTheme();
  const top = max ?? Math.max(1, ...data.map((d) => d.value));
  return (
    <View style={{ gap: 10 }}>
      {data.map((d) => {
        const color = d.color ?? t.accent;
        return (
          <View key={d.label} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <Text variant="small" tone="secondary" numberOfLines={1} style={{ width: 108 }}>
              {d.label}
            </Text>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <View style={{ flex: 1, height: 10, borderRadius: 5, backgroundColor: t.surfaceAlt, overflow: 'hidden' }}>
                <View style={{ width: `${Math.max(3, (d.value / top) * 100)}%`, height: '100%', borderRadius: 5, overflow: 'hidden', boxShadow: shade(`0px 0px 10px ${color}88`, true) }}>
                  <Fill colors={[`${color}88`, color]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flex: 1 }} />
                </View>
              </View>
              <Text numeric style={{ width: 34, textAlign: 'right', fontFamily: family.displaySemi, fontSize: 14, color: t.text }}>
                {formatValue(d.value)}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

export function Sparkline({ values, width = 84, height = 30 }: { values: readonly number[]; width?: number; height?: number }) {
  const t = useTheme();
  const [id] = useState(nextId);
  if (values.length < 2) return <View style={{ width, height }} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts: [number, number][] = values.map((v, i) => [(i / (values.length - 1)) * (width - 8) + 4, 4 + (1 - (v - min) / span) * (height - 8)]);
  const d = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const end = pts[pts.length - 1];
  const rising = (values[values.length - 1] ?? 0) >= (values[0] ?? 0);
  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={rising ? t.accent : t.textMuted} stopOpacity={rising ? 0.55 : 0.4} />
          <Stop offset="1" stopColor={rising ? t.gold : t.warning} />
        </LinearGradient>
      </Defs>
      <Path d={d} stroke={`url(#${id})`} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      {end !== undefined && <Circle cx={end[0]} cy={end[1]} r={3.2} fill={rising ? t.gold : t.warning} />}
    </Svg>
  );
}

export function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Glass style={{ flex: 1 }} contentStyle={{ padding: space.md + 2, gap: 2 }}>
      <Text variant="label" tone="muted">
        {label}
      </Text>
      <Text style={{ fontFamily: family.display, fontSize: 26, letterSpacing: -0.6 }}>{value}</Text>
      {sub !== undefined && (
        <Text variant="caption" tone="muted">
          {sub}
        </Text>
      )}
    </Glass>
  );
}

