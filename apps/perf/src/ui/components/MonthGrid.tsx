import { Pressable, useWindowDimensions, View } from 'react-native';

import { addDays, addMonths, daysInMonth, formatMonth, startOfMonth, weekday, weekdayShort } from '@/domain/dates';

import { family, radius, shade, space, useTheme } from '../theme';
import { IconButton, Text } from './primitives';

export interface DayMarks {
  planned: number;
  done: number;
  deload?: boolean;
  /** The block / cycle the day belongs to: a band of its colour under the days (lighter on deload). */
  cycle?: { color: string; start: boolean; end: boolean; light?: boolean };
}

/**
 * Month calendar: Monday-first grid; dots = planned (outline) / done (filled). Under the days, a
 * band in the colour of the running block or cycle (rounded where it starts and ends; lighter
 * during its deload week), so the program reads at a glance.
 */
export function MonthGrid({
  month,
  onMonthChange,
  selected,
  onSelect,
  marks,
  today,
}: {
  month: string;
  onMonthChange: (month: string) => void;
  selected: string | null;
  onSelect: (date: string) => void;
  marks: ReadonlyMap<string, DayMarks>;
  today: string;
}) {
  const t = useTheme();
  const narrow = useWindowDimensions().width < 340;
  const first = startOfMonth(month);
  const offset = weekday(first);
  const count = daysInMonth(first);
  const cells: (string | null)[] = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: count }, (_, i) => addDays(first, i)),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: space.sm }}>
        <IconButton icon="chevron-back" label="Mois précédent" onPress={() => onMonthChange(addMonths(first, -1))} />
        <Text variant="title" style={{ flex: 1, textAlign: 'center', fontSize: narrow ? 17 : undefined }} numberOfLines={1} adjustsFontSizeToFit>
          {formatMonth(first)}
        </Text>
        <IconButton icon="chevron-forward" label="Mois suivant" onPress={() => onMonthChange(addMonths(first, 1))} />
      </View>
      <View style={{ flexDirection: 'row' }}>
        {Array.from({ length: 7 }, (_, i) => (
          <Text key={i} variant="caption" tone="muted" style={{ flex: 1, textAlign: 'center' }}>
            {weekdayShort(i)}
          </Text>
        ))}
      </View>
      {weeks.map((week, wi) => (
        <View key={wi} style={{ flexDirection: 'row', marginTop: 6 }}>
          {week.map((date, di) => {
            if (date === null) return <View key={di} style={{ flex: 1, height: 50, marginHorizontal: 3 }} />;
            const m = marks.get(date);
            const isSelected = date === selected;
            const isToday = date === today;
            return (
              <Pressable
                key={date}
                onPress={() => onSelect(date)}
                accessibilityRole="button"
                accessibilityLabel={`${date}${m !== undefined && m.done > 0 ? ', séance faite' : ''}${m !== undefined && m.planned > 0 ? ', séance prévue' : ''}`}
                style={({ hovered }) => ({
                  flex: 1,
                  height: 50,
                  marginHorizontal: 3,
                  borderRadius: radius.sm + 2,
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                  backgroundColor: isSelected ? t.accentSoft : hovered === true ? t.surfaceAlt : 'transparent',
                  borderWidth: isSelected || isToday ? 1 : 0,
                  borderColor: isSelected ? `${t.accent}AA` : t.glass.raised.rim,
                  boxShadow: shade(isSelected ? `0px 0px 18px ${t.accentGlow}` : undefined, true),
                })}>
                <Text variant="bodyStrong" tone={isSelected ? 'accent' : isToday ? 'default' : 'secondary'} style={{ fontSize: 14.5, fontFamily: family.displaySemi }}>
                  {Number(date.slice(8))}
                </Text>
                {m?.cycle !== undefined && (
                  // Highlighter over the whole week, continuous across the gaps between days.
                  <View
                    pointerEvents="none"
                    style={{
                      position: 'absolute',
                      top: 0,
                      bottom: 0,
                      left: m.cycle.start ? 0 : -3,
                      right: m.cycle.end ? 0 : -3,
                      borderTopLeftRadius: m.cycle.start ? radius.sm + 2 : 0,
                      borderBottomLeftRadius: m.cycle.start ? radius.sm + 2 : 0,
                      borderTopRightRadius: m.cycle.end ? radius.sm + 2 : 0,
                      borderBottomRightRadius: m.cycle.end ? radius.sm + 2 : 0,
                      backgroundColor: m.cycle.color,
                      opacity: (m.deload === true ? 0.07 : 0.18) * (m.cycle.light === true ? 0.6 : 1),
                    }}
                  />
                )}
                {m?.cycle !== undefined && (
                  <View
                    pointerEvents="none"
                    style={{
                      position: 'absolute',
                      bottom: 0,
                      left: m.cycle.start ? 6 : -3,
                      right: m.cycle.end ? 6 : -3,
                      height: 3,
                      borderRadius: m.cycle.start || m.cycle.end ? 2 : 0,
                      backgroundColor: m.cycle.color,
                      opacity: (m.deload === true ? 0.35 : 0.95) * (m.cycle.light === true ? 0.55 : 1),
                    }}
                  />
                )}
                <View style={{ flexDirection: 'row', gap: 3, height: 6 }}>
                  {m !== undefined && m.done > 0 && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.accent, boxShadow: shade(`0px 0px 6px ${t.accent}`, true) }} />}
                  {m !== undefined && m.planned > 0 && (
                    <View style={{ width: 6, height: 6, borderRadius: 3, borderWidth: 1.5, borderColor: t.accent }} />
                  )}
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}
