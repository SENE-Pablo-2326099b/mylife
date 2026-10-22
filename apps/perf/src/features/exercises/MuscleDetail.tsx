import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { View } from 'react-native';

import { diffDays, formatShortDate } from '@/domain/dates';
import { formatDecimal, formatWeight } from '@/domain/math';
import type { RegionDetail } from '@/services/muscleService';
import { Sparkline } from '@/ui/components/charts';
import { Button, Card, Group, Row, Text } from '@/ui/components/primitives';
import { radius, space, useTheme } from '@/ui/theme';

const fmt = (v: number) => formatDecimal(v);

function lastLabel(lastDate: string | null, today: string): string {
  if (lastDate === null) return 'Jamais travaillé';
  const d = diffDays(lastDate, today);
  return d === 0 ? 'Travaillé aujourd’hui' : d === 1 ? 'Travaillé hier' : `Il y a ${d} jours`;
}

/** Weekly sets, last 8 weeks, as small columns (current week outlined). */
function WeekColumns({ weekly, target }: { weekly: readonly number[]; target: number | null }) {
  const t = useTheme();
  const max = Math.max(1, target ?? 0, ...weekly);
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 54 }}>
        {weekly.map((v, i) => (
          <View key={i} style={{ flex: 1, height: '100%', justifyContent: 'flex-end' }}>
            <View
              style={{
                height: `${Math.max(4, (v / max) * 100)}%`,
                borderRadius: 3,
                backgroundColor: v === 0 ? t.surfaceAlt : target !== null && v >= target * 0.9 ? t.accent : `${t.accent}88`,
                borderWidth: i === weekly.length - 1 ? 1 : 0,
                borderColor: t.gold,
              }}
            />
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text variant="caption" tone="muted">
          il y a 8 sem.
        </Text>
        <Text variant="caption" tone="muted">
          cette sem.
        </Text>
      </View>
    </View>
  );
}

/** The selected muscle: training load, trend and its exercises (with their progress). */
export function MuscleDetail({ detail, today, windowDays, onShowAll }: { detail: RegionDetail; today: string; windowDays: number; onShowAll: () => void }) {
  const t = useTheme();
  const { load, target } = detail;
  const thisWeek = load.weekly[load.weekly.length - 1] ?? 0;
  const primary = detail.exercises.filter((e) => e.role === 'primary');
  const secondary = detail.exercises.filter((e) => e.role === 'secondary');
  const row = (x: RegionDetail['exercises'][number]) => (
    <Row
      key={x.exercise.id}
      title={x.exercise.name}
      subtitle={
        x.sessions === 0
          ? 'Jamais fait'
          : `${x.sessions} séance${x.sessions > 1 ? 's' : ''} · ${x.lastDate === null ? '' : formatShortDate(x.lastDate)}${x.e1rm === null ? '' : ` · e1RM ${formatWeight(Math.round(x.e1rm * 10) / 10)} kg`}`
      }
      right={x.trend.length > 1 ? <Sparkline values={x.trend} width={64} /> : undefined}
      onPress={() => router.push(`/exercise/${x.exercise.id}`)}
    />
  );

  return (
    <View style={{ gap: space.md }}>
      <Card style={{ gap: space.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: t.gold }} />
          <Text variant="title" style={{ flex: 1 }}>
            {detail.label}
          </Text>
          <Text variant="small" tone="secondary">
            {lastLabel(load.lastDate, today)}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <View style={{ flex: 1, padding: space.md, borderRadius: radius.md, backgroundColor: t.surfaceAlt, gap: 2 }}>
            <Text variant="label" tone="muted" numberOfLines={1}>
              Cette semaine
            </Text>
            <Text variant="title" numeric>
              {fmt(thisWeek)}
              {target !== null && <Text variant="small" tone="secondary"> / {target} séries</Text>}
              {target === null && <Text variant="small" tone="secondary"> séries</Text>}
            </Text>
          </View>
          <View style={{ flex: 1, padding: space.md, borderRadius: radius.md, backgroundColor: t.surfaceAlt, gap: 2 }}>
            <Text variant="label" tone="muted" numberOfLines={1}>
              Moyenne {windowDays} j
            </Text>
            <Text variant="title" numeric>
              {fmt(load.perWeek)}
              <Text variant="small" tone="secondary"> / sem.</Text>
            </Text>
          </View>
        </View>
        {load.weekly.length > 0 && <WeekColumns weekly={load.weekly} target={target} />}
        {load.indirectPerWeek > 0 && (
          <Text variant="small" tone="secondary" numeric>
            + {fmt(load.indirectThisWeek)} en indirect cette semaine (composés : dips, tirages, développés), {fmt(load.indirectPerWeek)} / sem. en moyenne. Non comptées dans la cible.
          </Text>
        )}
        <Text variant="caption" tone="muted">
          Séries effectives (hors échauffement) ; un exercice où ce muscle est secondaire compte ½.{load.indirectPerWeek > 0 || ['biceps', 'triceps', 'forearms'].includes(detail.region) ? ' Bras : seules les isolations comptent en direct.' : ''}
          {target === null ? ' Fixe un objectif dans Réglages → Volume visé par muscle.' : ''}
        </Text>
      </Card>

      {primary.length > 0 && (
        <View style={{ gap: space.sm }}>
          <Text variant="label" tone="muted">
            Exercices ciblés ({primary.length})
          </Text>
          <Group>{primary.map(row)}</Group>
        </View>
      )}
      {secondary.length > 0 && (
        <View style={{ gap: space.sm }}>
          <Text variant="label" tone="muted">
            Le sollicitent aussi ({secondary.length})
          </Text>
          <Group>{secondary.slice(0, 6).map(row)}</Group>
        </View>
      )}
      {detail.exercises.length === 0 && (
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Ionicons name="information-circle-outline" size={18} color={t.textMuted} />
          <Text tone="secondary" style={{ flex: 1 }}>
            Aucun exercice de ta bibliothèque ne cible ce muscle.
          </Text>
        </Card>
      )}
      <Button label="Voir la liste filtrée" icon="list-outline" variant="secondary" size="sm" onPress={onShowAll} />
    </View>
  );
}
