import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { formatShortDate, parseDate, today } from '@/domain/dates';
import { formatWeight } from '@/domain/math';
import { getExercise } from '@/db/repos/exercises';
import { exerciseSubtitle } from '@/features/exercises/ExerciseList';
import { LoadTableCard } from '@/features/stats/LoadTable';
import { ReferenceCard } from '@/features/stats/ReferenceCard';
import { useSettings } from '@/state/settingsStore';
import { exerciseStats } from '@/services/statsService';
import { nextSessionFor, type NextSession } from '@/services/workoutService';
import { ColumnChart, LineChart } from '@/ui/components/charts';
import { Badge, Button, Card, Disclosure, EmptyState, IconButton, SectionTitle, Text } from '@/ui/components/primitives';
import { NotFoundScreen, Screen } from '@/ui/components/Screen';
import { SET_TYPE_SHORT } from '@/ui/labels';
import { radius, space, useTheme } from '@/ui/theme';
import { useLive } from '@/ui/useLive';

const kg = (v: number) => `${formatWeight(Math.round(v * 10) / 10)} kg`;

/** Double progression made explicit: what to load next time and when the load goes up. */
function NextSessionCard({ next, lest }: { next: NextSession; lest: boolean }) {
  const t = useTheme();
  const load = (w: number) => (lest && w === 0 ? 'PDC' : `${lest ? '+' : ''}${formatWeight(w)} kg`);
  const up = next.hint?.kind === 'increase';
  return (
    <Card tone={up ? 'accent' : undefined} style={{ marginTop: space.lg, gap: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Ionicons name={up ? 'trending-up' : 'repeat'} size={18} color={up ? t.accent : t.textSecondary} />
        <Text variant="label" tone={up ? 'accent' : 'muted'}>
          Prochaine séance
        </Text>
      </View>
      <Text variant="title">
        {next.weight === null ? '' : load(next.weight)} · {next.label.replace(/^Deload · /, 'deload · ').replace(/(\d)-(\d)/g, '$1\u2011$2')}
      </Text>
      <Text variant="small" tone="secondary">
        {next.label.startsWith('Deload')
          ? 'Semaine de deload : charge et volume réduits, on ne cherche pas à progresser cette semaine.'
          : up && next.hint !== null
          ? `Charge en hausse : toutes les séries ont atteint ${next.repMax} reps la dernière fois (${load(next.hint.from)} → ${load(next.hint.to)}).`
          : `Double progression : vise ${next.repMax} reps sur toutes les séries, la charge montera alors de ${formatWeight(next.increment)} kg.`}
      </Text>
    </Card>
  );
}

export default function ExerciseDetail() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const exercise = useLive(() => getExercise(id), [id]);
  const stats = useLive(() => exerciseStats(id, today()), [id]);
  const next = useLive(() => nextSessionFor(id, today()), [id]);
  const [visibleSessions, setVisibleSessions] = useState(5);
  const increment = useSettings((st) => st.settings.increment);

  if (exercise === null) return <NotFoundScreen title="Exercice introuvable" />;
  const lest = exercise.loadType === 'bodyweight';
  const main = exercise.progressionType === 'top_set_backoff';
  const bwNote = lest ? ' (lest)' : '';
  const best = stats.prs.bestE1rm;

  return (
    <Screen
      stack
      title={exercise.name}
      mood="library"
      right={
        <View style={{ flexDirection: 'row' }}>
          <IconButton
            icon="sparkles-outline"
            label="Demander au coach"
            color={t.accent}
            onPress={() =>
              router.push({ pathname: '/coach', params: { q: `Analyse ma progression sur ${exercise.name} : tendance, séries récentes et ce que tu ajusterais pour la suite.` } })
            }
          />
          <IconButton icon="create-outline" label="Modifier l’exercice" color={t.text} onPress={() => router.push({ pathname: '/exercise-edit', params: { id } })} />
        </View>
      }>
      <Text variant="large">{exercise.name}</Text>
      <Text tone="secondary" style={{ marginTop: 2 }}>
        {exerciseSubtitle(exercise)}
        {exercise.progressionType === 'top_set_backoff' ? '' : ` · ${exercise.repRangeMin}\u2011${exercise.repRangeMax} reps`}
      </Text>
      {(exercise.archived || stats.stagnation.stagnant) && (
        <View style={{ flexDirection: 'row', gap: 6, marginTop: space.sm, flexWrap: 'wrap' }}>
          {exercise.archived && <Badge label="Archivé" color={t.textMuted} />}
          {stats.stagnation.stagnant && <Badge label={`Stagnation · ${stats.stagnation.cycles} cycles`} color={t.warning} icon="pause-circle" />}
        </View>
      )}

      {/* 1. What drives the next session: the reference 1RM (main lifts) or the next load (accessories). */}
      {main ? (
        <>
          <SectionTitle title="Base des charges" />
          <ReferenceCard exerciseId={exercise.id} lest={lest} />
          {stats.reference !== null && (
            <Disclosure title="Table de charges" summary="par reps et par %">
              <LoadTableCard reference={stats.reference.value} bodyweight={stats.bodyweight ?? 0} lest={lest} increment={exercise.weightIncrement ?? increment} />
            </Disclosure>
          )}
        </>
      ) : (
        next !== null && next.weight !== null && <NextSessionCard next={next} lest={lest} />
      )}

      {/* 2. History: one chart, the records, then the details folded. */}
      {stats.series.length === 0 ? (
        <Card style={{ marginTop: space.lg }}>
          <EmptyState icon="stats-chart-outline" title="Pas encore d’historique" body="Les stats apparaissent dès la première série validée." />
        </Card>
      ) : (
        <>
          <SectionTitle title={`Progression · e1RM${bwNote}`} />
          <Card>
            <LineChart
              points={stats.series.map((p) => ({
                x: parseDate(p.date).getTime(),
                y: p.e1rm,
                label: `${formatShortDate(p.date)} · ${formatWeight(p.weight)}×${p.reps}`,
                weak: !p.reliable,
              }))}
              formatY={kg}
            />
            {stats.reliableMaxReps !== null && stats.series.some((p) => !p.reliable) && (
              <Text variant="caption" tone="muted" style={{ marginTop: space.xs }}>
                Cercles orange : séance sans série ≤ {stats.reliableMaxReps} reps, estimation peu fiable.
              </Text>
            )}
          </Card>

          <SectionTitle title="Records" />
          <Card style={{ gap: space.md }}>
            <View style={{ flexDirection: 'row', gap: space.md }}>
              <View style={{ flex: 1 }}>
                <Text variant="caption" tone="secondary">
                  Meilleur e1RM{stats.reliableMaxReps !== null && best?.reliable === true ? ` (≤ ${stats.reliableMaxReps} reps)` : ''}
                </Text>
                <Text variant="title">{best === null ? '–' : kg(best.e1rm)}</Text>
                {best !== null && (
                  <Text variant="caption" tone="muted">
                    {formatWeight(best.weight)}×{best.reps} · {formatShortDate(best.date)}
                    {stats.reliableMaxReps !== null && !best.reliable ? ' · peu fiable' : ''}
                  </Text>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="caption" tone="secondary">
                  Plus lourd
                </Text>
                <Text variant="title">{stats.prs.heaviest === null ? '–' : kg(stats.prs.heaviest.weight)}</Text>
                {stats.prs.heaviest !== null && (
                  <Text variant="caption" tone="muted">
                    ×{stats.prs.heaviest.reps} · {formatShortDate(stats.prs.heaviest.date)}
                  </Text>
                )}
              </View>
            </View>
            {stats.prs.repMaxes.length > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {stats.prs.repMaxes.map((r) => (
                  <View key={r.reps} style={{ backgroundColor: t.surfaceAlt, borderRadius: radius.sm, paddingHorizontal: space.sm, paddingVertical: 6, minWidth: 64 }}>
                    <Text variant="caption" tone="secondary">
                      {r.reps}RM
                    </Text>
                    <Text variant="bodyStrong" numeric>
                      {formatWeight(r.weight)}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </Card>

          {stats.cycles.length > 0 && (
            <Disclosure title="e1RM par mésocycle" summary={`${stats.cycles.length} cycle${stats.cycles.length > 1 ? 's' : ''}`}>
              <Card>
                <ColumnChart data={stats.cycles.map((c) => ({ label: c.name, value: c.e1rm }))} formatValue={(v) => formatWeight(Math.round(v))} />
              </Card>
            </Disclosure>
          )}

          {stats.topSets.length > 0 && (
            <Disclosure title="Top sets par semaine" summary={`${Math.min(10, stats.topSets.length)} sem.`}>
              <Card style={{ gap: 6 }}>
                {stats.topSets
                  .slice(-10)
                  .reverse()
                  .map((ts) => (
                    <View key={ts.week} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text tone="secondary">Sem. {formatShortDate(ts.week)}</Text>
                      <Text variant="bodyStrong" numeric>
                        {formatWeight(ts.weight)} kg × {ts.reps}
                      </Text>
                    </View>
                  ))}
              </Card>
            </Disclosure>
          )}

          <SectionTitle title="Séances" />
          <Card style={{ paddingVertical: space.xs }}>
            {stats.sessions.slice(0, visibleSessions).map((s, i) => (
              <Pressable key={s.workoutId} onPress={() => router.push(`/workout/${s.workoutId}`)} accessibilityRole="button">
                {({ pressed }) => (
                  <View style={{ gap: 3, paddingVertical: space.sm + 2, borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth, borderTopColor: t.border, opacity: pressed ? 0.6 : 1 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text variant="bodyStrong">{formatShortDate(s.date)}</Text>
                      <Text variant="small" tone="muted" numeric>
                        e1RM {kg(s.bestE1rm)}
                      </Text>
                    </View>
                    <Text variant="small" tone="secondary" numeric>
                      {s.sets
                        .map((x) => `${SET_TYPE_SHORT[x.setType] === '' ? '' : `${SET_TYPE_SHORT[x.setType]}\u00A0`}${formatWeight(x.weight)}×${x.reps}`)
                        .join('  ·  ')}
                    </Text>
                    {s.sets
                      .filter((x) => x.note !== '')
                      .map((x, j) => (
                        <View key={j} style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
                          <Ionicons name="chatbubble-ellipses" size={12} color={t.gold} style={{ marginTop: 3 }} />
                          <Text variant="small" tone="secondary" style={{ flex: 1, fontStyle: 'italic' }}>
                            {formatWeight(x.weight)}×{x.reps} : {x.note}
                          </Text>
                        </View>
                      ))}
                  </View>
                )}
              </Pressable>
            ))}
          </Card>
          {stats.sessions.length > visibleSessions && (
            <Button label={`Voir plus (${stats.sessions.length - visibleSessions})`} variant="ghost" onPress={() => setVisibleSessions(visibleSessions + 20)} style={{ marginTop: space.sm }} />
          )}
        </>
      )}
    </Screen>
  );
}
