import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { bodyTrend, dailyValues } from '@/domain/bodyTrend';
import { addDays, formatLongDate, formatShortDate, parseDate, today } from '@/domain/dates';
import { formatWeight } from '@/domain/math';
import type { BodyMetric } from '@/domain/types';
import { addBodyEntry, deleteBodyEntry, latestPerMetric, listBodyEntries } from '@/db/repos/body';
import { BODY_METRICS } from '@/db/parse';
import { useSettings } from '@/state/settingsStore';
import { showToast } from '@/state/toastStore';
import { LineChart } from '@/ui/components/charts';
import { Button, Card, Chip, Field, SectionTitle, Text } from '@/ui/components/primitives';
import { Screen } from '@/ui/components/Screen';
import { BODY_METRIC_LABEL, BODY_METRIC_UNIT } from '@/ui/labels';
import { space, useTheme } from '@/ui/theme';
import { useLive } from '@/ui/useLive';

const PERIODS: readonly { label: string; days: number | null }[] = [
  { label: '1 mois', days: 30 },
  { label: '3 mois', days: 90 },
  { label: 'Tout', days: null },
];

export default function BodyScreen() {
  const t = useTheme();
  const [metric, setMetric] = useState<BodyMetric>('bodyweight');
  const [value, setValue] = useState('');
  const entries = useLive(() => listBodyEntries(metric), [metric]);
  const latest = useLive(() => latestPerMetric(), []);
  const unit = BODY_METRIC_UNIT[metric];
  const goal = useSettings((st) => st.settings.bodyweightGoal);
  const trend = metric === 'bodyweight' ? bodyTrend(entries, goal) : null;
  const [period, setPeriod] = useState<number | null>(90);
  const days = dailyValues(entries);
  const lastDay = days[days.length - 1];
  const from = period === null || lastDay === undefined ? null : addDays(lastDay.date, -period);
  const shown = from === null ? days : days.filter((e) => e.date >= from);
  const parsed = Number.parseFloat(value.replace(',', '.'));
  const valid = Number.isFinite(parsed) && parsed > 0 && parsed < 500;

  const add = () => {
    if (!valid) return;
    addBodyEntry(metric, today(), Math.round(parsed * 10) / 10);
    setValue('');
  };

  return (
    <Screen stack title="Suivi corporel" mood="stats" maxWidth={760}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {BODY_METRICS.map((m) => {
          const last = latest.get(m);
          return (
            <Chip
              key={m}
              label={last === undefined ? BODY_METRIC_LABEL[m] : `${BODY_METRIC_LABEL[m]} · ${formatWeight(last.value)}`}
              selected={metric === m}
              onPress={() => setMetric(m)}
            />
          );
        })}
      </View>

      <Card style={{ marginTop: space.lg, gap: space.md }}>
        <Text variant="label" tone="secondary">
          Nouvelle mesure · aujourd’hui
        </Text>
        <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Field
              value={value}
              onChangeText={setValue}
              keyboardType="decimal-pad"
              placeholder={unit}
              returnKeyType="done"
              onSubmitEditing={add}
              style={{ fontSize: 18 }}
            />
          </View>
          <Button label="Ajouter" onPress={add} disabled={!valid} />
        </View>
        {metric === 'bodyweight' && (
          <Text variant="small" tone="muted">
            Utilisé pour les e1RM et backoffs des exercices lestés (tractions, dips…).
          </Text>
        )}
      </Card>

      {metric === 'bodyweight' && trend !== null && lastDay !== undefined && (
        <Card style={{ marginTop: space.md, gap: space.xs }}>
          <Text variant="label" tone="secondary">
            Dernière pesée · {formatShortDate(lastDay.date)}
          </Text>
          <Text variant="title" numeric>
            {formatWeight(lastDay.value)} kg
          </Text>
          <Text variant="small" tone="secondary" numeric>
            Moyenne 7 j {formatWeight(Math.round(trend.average * 10) / 10)} kg
            {trend.ratePerWeek === null
              ? ' · pèse-toi au moins une fois par semaine pendant 2 semaines pour voir ton rythme.'
              : ` · ${trend.ratePerWeek >= 0 ? '+' : '−'}${formatWeight(Math.abs(Math.round(trend.ratePerWeek * 100) / 100))} kg / semaine (4 sem.)`}
          </Text>
          {goal !== null && (
            <Text variant="small" tone={trend.goalReached ? 'gold' : 'secondary'}>
              {trend.goalReached
                ? `Objectif ${formatWeight(goal)} kg atteint`
                : trend.goalDate !== null
                  ? `Objectif ${formatWeight(goal)} kg vers le ${formatLongDate(trend.goalDate)} à ce rythme`
                  : `Objectif ${formatWeight(goal)} kg (réglable dans Réglages)`}
            </Text>
          )}
        </Card>
      )}

      {days.length > 1 && (
        <>
          <SectionTitle
            title={`${BODY_METRIC_LABEL[metric]} (${unit})`}
            action={
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {PERIODS.map((p) => (
                  <Chip key={p.label} label={p.label} small selected={period === p.days} onPress={() => setPeriod(p.days)} />
                ))}
              </View>
            }
          />
          <Card>
            {shown.length > 1 ? (
              <LineChart
                points={shown.map((e) => ({
                  x: parseDate(e.date).getTime(),
                  y: e.value,
                  label: formatShortDate(e.date),
                }))}
                dots
                target={metric === 'bodyweight' && goal !== null ? { y: goal, label: `objectif ${formatWeight(goal)}` } : undefined}
                formatY={(v) => `${formatWeight(Math.round(v * 10) / 10)} ${unit}`}
              />
            ) : (
              <Text variant="small" tone="muted">
                Une seule mesure sur cette période : élargis la période.
              </Text>
            )}
          </Card>
        </>
      )}

      <SectionTitle title="Historique" />
      {entries.length === 0 ? (
        <Text tone="muted">Aucune mesure.</Text>
      ) : (
        <Card style={{ paddingVertical: space.xs }}>
          {[...entries].reverse().map((e) => (
            <Pressable
              key={e.id}
              onLongPress={() => {
                deleteBodyEntry(e.id);
                showToast({
                  message: 'Mesure supprimée',
                  actionLabel: 'Annuler',
                  onAction: () => addBodyEntry(e.metric, e.date, e.value),
                });
              }}
              style={({ pressed }) => ({
                flexDirection: 'row',
                justifyContent: 'space-between',
                paddingVertical: space.sm,
                backgroundColor: pressed ? t.surfacePressed : 'transparent',
              })}>
              <Text tone="secondary">{formatShortDate(e.date)}</Text>
              <Text variant="bodyStrong" numeric>
                {formatWeight(e.value)} {unit}
              </Text>
            </Pressable>
          ))}
        </Card>
      )}
      <Text variant="caption" tone="muted" style={{ marginTop: space.sm }}>
        Appui long sur une mesure pour la supprimer.
      </Text>
    </Screen>
  );
}
