import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';

import type { Consistency } from '@/domain/analytics';
import { formatShortDate } from '@/domain/dates';
import { Card, Text } from '@/ui/components/primitives';
import { radius, space, useTheme } from '@/ui/theme';

/**
 * Weekly streak + the last 12 weeks as a strip of cells (one per week, filled by session count).
 * A week "counts" when it reaches the weekly goal.
 */
export function ConsistencyCard({ data, goal }: { data: Consistency; goal: number }) {
  const t = useTheme();
  const max = Math.max(goal, ...data.weeks.map((w) => w.sessions));
  return (
    <Card style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <View
          style={{
            width: 46,
            height: 46,
            borderRadius: 23,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: data.streak > 0 ? t.goldSoft : t.surfaceAlt,
          }}>
          <Ionicons name="flame" size={24} color={data.streak > 0 ? t.gold : t.textMuted} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="title" numeric>
            {data.streak} semaine{data.streak > 1 ? 's' : ''}
          </Text>
          <Text variant="small" tone="secondary">
            d’affilée à {goal} séances ou plus · objectif tenu {data.hit} semaine{data.hit > 1 ? 's' : ''} sur 12
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 4, alignItems: 'flex-end', height: 44 }} accessibilityLabel={`Séances par semaine : ${data.weeks.map((w) => w.sessions).join(', ')}`}>
        {data.weeks.map((w, i) => {
          const hit = w.sessions >= goal;
          const current = i === data.weeks.length - 1;
          return (
            <View
              key={w.start}
              style={{
                flex: 1,
                height: Math.max(6, (w.sessions / max) * 44),
                borderRadius: radius.xs / 2,
                backgroundColor: hit ? t.accent : w.sessions > 0 ? `${t.accent}55` : t.surfaceAlt,
                borderWidth: current ? 1 : 0,
                borderColor: t.gold,
              }}
            />
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text variant="caption" tone="muted">
          Sem. {formatShortDate(data.weeks[0]?.start ?? '')}
        </Text>
        <Text variant="caption" tone="muted">
          Cette semaine
        </Text>
      </View>
    </Card>
  );
}
