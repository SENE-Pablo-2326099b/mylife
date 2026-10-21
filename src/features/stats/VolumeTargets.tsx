import { View } from 'react-native';

import { formatDecimal } from '@/domain/math';
import type { Muscle } from '@/domain/types';
import { Text } from '@/ui/components/primitives';
import { MUSCLE_LABEL } from '@/ui/labels';
import { radius, space, useTheme } from '@/ui/theme';

const fmt = (v: number) => formatDecimal(v);

export type VolumeStatus = 'under' | 'on' | 'over';

/** On target = within −10 % / +25 % of it (a little extra is fine, much more is junk volume). */
export function volumeStatus(sets: number, target: number): VolumeStatus {
  if (sets < target * 0.9) return 'under';
  if (sets > target * 1.25) return 'over';
  return 'on';
}

/**
 * Weekly hard sets vs the targets set in Réglages (programme : triceps ~9, biceps ~13). The bar
 * compares the direct sets; for the arms, compound sets (dips, rows, presses) are shown beside it.
 */
export function VolumeTargets({
  volume,
  targets,
}: {
  volume: readonly { muscle: Muscle; sets: number; indirect?: number }[];
  targets: Readonly<Record<string, number>>;
}) {
  const t = useTheme();
  const rows = Object.entries(targets)
    .filter(([, target]) => target > 0)
    .map(([muscle, target]) => {
      const v = volume.find((x) => x.muscle === muscle);
      return { muscle: muscle as Muscle, target, sets: v?.sets ?? 0, indirect: v?.indirect ?? 0 };
    });
  if (rows.length === 0) return null;
  return (
    <View style={{ gap: space.sm }}>
      {rows.map((r) => {
        const status = volumeStatus(r.sets, r.target);
        const color = status === 'on' ? t.accent : status === 'over' ? t.gold : t.warning;
        return (
          <View key={r.muscle} style={{ gap: 4 }} accessibilityLabel={`${MUSCLE_LABEL[r.muscle]} : ${fmt(r.sets)} séries directes sur ${r.target}${r.indirect > 0 ? `, plus ${fmt(r.indirect)} en indirect` : ''}`}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
              <Text variant="bodyStrong" style={{ flex: 1 }}>
                {MUSCLE_LABEL[r.muscle] ?? r.muscle}
              </Text>
              <Text variant="small" numeric style={{ color }}>
                {fmt(r.sets)} / {r.target}
              </Text>
              <Text variant="caption" tone="muted" style={{ marginLeft: space.sm, minWidth: 64, textAlign: 'right' }}>
                {status === 'on' ? 'dans la cible' : status === 'over' ? 'au-dessus' : `encore ${fmt(Math.max(0, r.target - r.sets))}`}
              </Text>
            </View>
            <View style={{ height: 8, borderRadius: radius.pill, backgroundColor: t.surfaceAlt, overflow: 'hidden' }}>
              <View style={{ width: `${Math.min(100, (r.sets / r.target) * 100)}%`, height: '100%', borderRadius: radius.pill, backgroundColor: color }} />
            </View>
            {r.indirect > 0 && (
              <Text variant="caption" tone="muted" numeric>
                + {fmt(r.indirect)} en indirect (composés), hors cible
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
}
