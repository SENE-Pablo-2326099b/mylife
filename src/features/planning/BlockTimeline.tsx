import { View } from 'react-native';

import { addDays, formatShortDate } from '@/domain/dates';
import { mesocycleEndOffsetDays, phaseFor, totalWeeks } from '@/domain/mesocycle';
import { mesoKindInfo } from '@/domain/mesoTypes';
import type { Mesocycle } from '@/domain/types';
import { Card, Text } from '@/ui/components/primitives';
import { MESO_KIND_COLOR } from '@/ui/labels';
import { radius, space, useTheme } from '@/ui/theme';

/**
 * The season at a glance: each mesocycle is a segment as long as its weeks, coloured by block
 * type (accumulation → transmutation → réalisation…), the running one outlined.
 */
export function BlockTimeline({ mesos: input, today }: { mesos: readonly Mesocycle[]; today: string }) {
  const t = useTheme();
  // Chronological whatever the caller's order (the Programme list shows the newest first).
  const mesos = [...input].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const last = mesos[mesos.length - 1];
  if (last === undefined) return null;
  const total = mesos.reduce((n, m) => n + totalWeeks(m), 0);
  const kinds = [...new Set(mesos.map((m) => m.kind))];
  return (
    <Card style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', gap: 3, height: 14 }} accessibilityLabel={mesos.map((m) => `${m.name} : ${mesoKindInfo(m.kind).label}`).join(', ')}>
        {mesos.map((m) => {
          const p = phaseFor(m, today);
          const running = p.kind === 'work' || p.kind === 'deload';
          return (
            <View
              key={m.id}
              style={{
                flex: totalWeeks(m) / total,
                borderRadius: radius.pill,
                backgroundColor: MESO_KIND_COLOR[m.kind](t),
                opacity: p.kind === 'over' ? 0.35 : 1,
                borderWidth: running ? 2 : 0,
                borderColor: t.text,
              }}
            />
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space.md, rowGap: 4, alignItems: 'center' }}>
        {kinds.map((k) => (
          <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: MESO_KIND_COLOR[k](t) }} />
            <Text variant="caption" tone="secondary">
              {mesoKindInfo(k).label}
            </Text>
          </View>
        ))}
        <Text variant="caption" tone="muted">
          {total} semaines, jusqu’au {formatShortDate(addDays(last.startDate, mesocycleEndOffsetDays(last)))}
        </Text>
      </View>
    </Card>
  );
}
