import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { addDays, formatShortDate, startOfWeek } from '@/domain/dates';
import { formatDecimal, formatWeight } from '@/domain/math';
import { muscleColor } from '@/features/exercises/ExerciseList';
import { ConsistencyCard } from '@/features/stats/Consistency';
import { VolumeTargets } from '@/features/stats/VolumeTargets';
import { syncCloud } from '@/services/cloud';
import { statsOverview, weekVolume, type MainLift } from '@/services/statsService';
import { useSettings } from '@/state/settingsStore';
import { BarList, Sparkline } from '@/ui/components/charts';
import { Glass } from '@/ui/components/Glass';
import { Columns, Metric } from '@/ui/components/layout';
import { Button, Card, Disclosure, EmptyState, Group, IconButton, Row, SectionTitle, Tap, Text } from '@/ui/components/primitives';
import { Reveal, Screen } from '@/ui/components/Screen';
import { SkeletonCard, useAfterTransition } from '@/ui/components/Skeleton';
import { MUSCLE_LABEL } from '@/ui/labels';
import { useBreakpoint } from '@/ui/responsive';
import { family, radius, space, useTheme } from '@/ui/theme';
import { useLive } from '@/ui/useLive';
import { useToday } from '@/ui/useToday';

const fmtSets = (v: number) => formatDecimal(v);
const kg = (v: number, lest: boolean) => (lest && v === 0 ? 'PDC' : `${lest ? '+' : ''}${formatWeight(Math.round(v * 10) / 10)}`);

/** A main lift on one line: name and trend on the left, reference 1RM and its curve on the right. */
function LiftRow({ lift, first }: { lift: MainLift; first: boolean }) {
  const t = useTheme();
  const roomy = useWindowDimensions().width >= 360;
  const up = lift.delta !== null && lift.delta > 0.05;
  const down = lift.delta !== null && lift.delta < -0.05;
  const trend =
    lift.provisional
      ? 'référence provisoire'
      : lift.delta === null
        ? '1er cycle'
        : `${up ? '+' : ''}${formatWeight(Math.round(lift.delta * 10) / 10)} kg / cycle`;
  return (
    <Tap
      onPress={() => router.push(`/exercise/${lift.exerciseId}`)}
      scaleTo={0.985}
      highlightRadius={radius.md}
      accessibilityLabel={`${lift.name}, 1RM de référence ${lift.reference === null ? 'inconnu' : `${kg(lift.reference, lift.lest)} kg`}, ${trend}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 68, paddingVertical: space.sm, borderTopWidth: first ? 0 : StyleSheet.hairlineWidth, borderTopColor: t.border }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {lift.name}
        </Text>
        <Text variant="small" numberOfLines={1} style={{ color: lift.provisional ? t.warning : up ? t.success : down ? t.warning : t.textSecondary }}>
          {trend}
        </Text>
      </View>
      {roomy && <Sparkline values={lift.values} width={64} height={30} />}
      <View style={{ alignItems: 'flex-end', minWidth: 72 }}>
        <Text style={{ fontFamily: family.display, fontSize: 22, letterSpacing: -0.6, color: t.text }} numberOfLines={1}>
          {lift.reference === null ? '–' : kg(lift.reference, lift.lest)}
        </Text>
        <Text variant="caption" tone="muted">
          1RM réf. (kg)
        </Text>
      </View>
    </Tap>
  );
}

export default function StatsScreen() {
  const t = useTheme();
  const bp = useBreakpoint();
  const date = useToday();
  const ready = useAfterTransition();
  const [week, setWeek] = useState(() => startOfWeek(date));
  const overview = useLive(() => (ready ? statsOverview(date) : null), [date, ready]);
  const volume = useLive(() => (ready ? weekVolume(week) : null), [week, ready]);
  const isCurrentWeek = week === startOfWeek(date);
  const volumeTargets = useSettings((st) => st.settings.volumeTargets);

  if (overview === null || volume === null) {
    return (
      <Screen title="Stats" subtitle="Progression" mood="stats">
        <View style={{ gap: space.md }}>
          <SkeletonCard lines={1} tall />
          <SkeletonCard tall />
          <SkeletonCard tall />
          <SkeletonCard lines={5} />
        </View>
      </Screen>
    );
  }

  const totalSets = volume.reduce((n, v) => n + v.sets, 0);
  const indirect = volume.filter((v) => v.indirect > 0);

  const left = (
    <View>
      <SectionTitle title="Lifts principaux" />
      {overview.mainLifts.length === 0 ? (
        <Card>
          <EmptyState icon="barbell-outline" title="Pas encore de lift principal" body="Les lifts en top set + backoff de tes séances types apparaîtront ici." />
        </Card>
      ) : (
        <Reveal index={1}>
          <Card style={{ paddingVertical: space.xs }}>
            {overview.mainLifts.map((l, i) => (
              <LiftRow key={l.exerciseId} lift={l} first={i === 0} />
            ))}
          </Card>
        </Reveal>
      )}

      {overview.stagnant.length > 0 && (
        <Card tone="warning" style={{ gap: space.sm, marginTop: space.md }}>
          {overview.stagnant.map((s) => (
            <View key={s.exerciseId} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Ionicons name="pause-circle" size={18} color={t.warning} />
              <Text style={{ flex: 1 }} onPress={() => router.push(`/exercise/${s.exerciseId}`)}>
                <Text variant="bodyStrong">{s.name}</Text> — e1RM stable depuis {s.cycles} cycles
              </Text>
            </View>
          ))}
          <Button
            label="Demander au coach"
            icon="sparkles-outline"
            variant="secondary"
            size="sm"
            onPress={() =>
              router.push({
                pathname: '/coach',
                params: { q: `Mon e1RM stagne sur ${overview.stagnant.map((s) => s.name).join(', ')}. Analyse les derniers cycles et propose des ajustements.` },
              })
            }
          />
        </Card>
      )}

      <SectionTitle
        title="Volume"
        action={
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <IconButton icon="chevron-back" label="Semaine précédente" size={18} onPress={() => setWeek(addDays(week, -7))} />
            <Text variant="small" tone="secondary" style={{ minWidth: 96, textAlign: 'center' }}>
              {isCurrentWeek ? 'Cette semaine' : `Sem. ${formatShortDate(week)}`}
            </Text>
            <IconButton icon="chevron-forward" label="Semaine suivante" size={18} onPress={() => !isCurrentWeek && setWeek(addDays(week, 7))} color={isCurrentWeek ? t.border : undefined} />
          </View>
        }
      />
      <Reveal index={2}>
        <Card style={{ gap: space.md }}>
          <VolumeTargets volume={volume} targets={volumeTargets} />
          {volume.length === 0 && (
            <Text variant="small" tone="muted" style={{ textAlign: 'center' }}>
              {isCurrentWeek ? 'Pas encore de série effective cette semaine.' : 'Aucune série effective cette semaine-là.'}
            </Text>
          )}
        </Card>
      </Reveal>
      {volume.length > 0 && (
        <Disclosure title="Tous les muscles" summary={`${fmtSets(totalSets)} séries`}>
          <Card style={{ gap: space.md }}>
            <BarList
              data={volume.filter((v) => v.sets > 0).map((v) => ({ label: MUSCLE_LABEL[v.muscle], value: v.sets, color: muscleColor(v.muscle, t) }))}
              formatValue={fmtSets}
            />
            {indirect.length > 0 && (
              <Text variant="small" tone="secondary">
                En indirect (composés) : {indirect.map((v) => `${MUSCLE_LABEL[v.muscle].toLowerCase()} ${fmtSets(v.indirect)}`).join(' · ')}
              </Text>
            )}
            <Text variant="caption" tone="muted">
              Séries effectives (hors échauffement) · muscle secondaire = ½ série · bras : seules les isolations comptent en direct
            </Text>
          </Card>
        </Disclosure>
      )}
    </View>
  );

  const right = (
    <View>
      <Disclosure title="Régularité" summary={`${overview.consistency.streak} sem. d’affilée`}>
        <ConsistencyCard data={overview.consistency} goal={overview.weeklyGoal} />
      </Disclosure>
      {overview.recentRecords.length > 0 && (
        <Disclosure title="Derniers records" summary={`${overview.recentRecords.length}`}>
          <Group>
            {overview.recentRecords.map((r) => (
              <Row
                key={`${r.exerciseId}-${r.workoutId}`}
                icon="trophy-outline"
                title={r.name}
                subtitle={`${kg(r.weight, r.lest)}${r.lest && r.weight === 0 ? '' : ' kg'} × ${r.reps} · e1RM +${formatWeight(Math.round(r.gain * 10) / 10)} kg · ${formatShortDate(r.date)}`}
                onPress={() => router.push(`/exercise/${r.exerciseId}`)}
              />
            ))}
          </Group>
        </Disclosure>
      )}
      <Disclosure title="Tous les exercices" summary={overview.progress.length === 0 ? '' : `${overview.progress.length}`}>
        {overview.progress.length === 0 ? (
          <Card>
            <EmptyState icon="trending-up" title="Pas encore de données" body="Les courbes apparaissent après tes premières séances." />
          </Card>
        ) : (
          <Group>
            {overview.progress.map((p) => (
              <Row
                key={p.exerciseId}
                title={p.name}
                subtitle={`e1RM ${formatWeight(Math.round(p.last * 10) / 10)} kg · ${p.sessions} séance${p.sessions > 1 ? 's' : ''}`}
                onPress={() => router.push(`/exercise/${p.exerciseId}`)}
                right={<Sparkline values={p.values} />}
              />
            ))}
          </Group>
        )}
      </Disclosure>
      <SectionTitle title="Corps" />
      <Group>
        <Row icon="body-outline" title="Suivi corporel" subtitle="Poids de corps et mensurations" onPress={() => router.push('/body')} />
      </Group>
    </View>
  );

  return (
    <Screen title="Stats" subtitle="Progression" mood="stats" onRefresh={() => syncCloud()}>
      <Reveal index={0}>
        <Glass level="raised" radius={radius.xl} contentStyle={{ flexDirection: 'row', padding: space.lg, gap: space.md }}>
          <Metric label="Séances" value={String(overview.workouts30)} hint="30 jours" />
          <Metric label="Séries" value={String(overview.sets7)} tone="accent" hint="7 jours" />
          {bp !== 'compact' && <Metric label="Séries" value={fmtSets(totalSets)} hint="cette semaine" />}
          <Metric label="Semaines" value={String(overview.consistency.streak)} hint="d’affilée" />
        </Glass>
      </Reveal>
      <Columns weights={[1.25, 1]}>
        {left}
        {right}
      </Columns>
    </Screen>
  );
}
