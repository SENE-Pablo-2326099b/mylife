import { View } from 'react-native';

import { formatWeight } from '@/domain/math';
import { loadTable } from '@/domain/reference';
import { Card, Text } from '@/ui/components/primitives';
import { space, useTheme } from '@/ui/theme';

function Column({ title, rows, lest }: { title: string; rows: { label: string; load: number }[]; lest: boolean }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
      <Text variant="label" tone="muted">
        {title}
      </Text>
      {rows.map((r, i) => (
        <View key={r.label} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, borderTopWidth: i === 0 ? 0 : 1, borderColor: t.border }}>
          <Text variant="small" tone="secondary">
            {r.label}
          </Text>
          <Text variant="small" numeric>
            {lest ? (r.load === 0 ? 'PDC' : `+${formatWeight(r.load)}`) : formatWeight(r.load)} kg
          </Text>
        </View>
      ))}
    </View>
  );
}

/** Loads derived from the reference 1RM, per rep count and per % (lest for weighted lifts). */
export function LoadTableCard({ reference, bodyweight, lest, increment }: { reference: number; bodyweight: number; lest: boolean; increment: number }) {
  const table = loadTable(reference, lest ? bodyweight : 0, increment);
  return (
    <Card style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', gap: space.lg }}>
        <Column title="Par reps" rows={table.byReps} lest={lest} />
        <Column title="% du 1RM" rows={table.byPercent} lest={lest} />
      </View>
      <Text variant="caption" tone="muted">
        Depuis le 1RM de référence{lest ? ' (masse totale, rendu en lest)' : ''}, arrondi à {formatWeight(increment)} kg. Indicatif : les charges du cycle restent celles du plan.
      </Text>
    </Card>
  );
}
