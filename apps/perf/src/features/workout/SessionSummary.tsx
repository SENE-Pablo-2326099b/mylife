import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { View } from 'react-native';

import { formatWeight } from '@/domain/math';
import { resumeWorkout } from '@/services/workoutService';
import { sessionSummary } from '@/services/summaryService';
import { useSessionSummary } from '@/state/summaryStore';
import { useWorkoutStore } from '@/state/workoutStore';
import { Button, Text } from '@/ui/components/primitives';
import { Sheet } from '@/ui/components/Sheet';
import { radius, space, useTheme } from '@/ui/theme';

const tons = (kg: number) => (kg >= 1000 ? `${formatWeight(Math.round(kg / 100) / 10)} t` : `${kg} kg`);

function Stat({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, minWidth: 0, padding: space.md, borderRadius: radius.md, backgroundColor: t.surfaceAlt, gap: 2 }}>
      <Text variant="label" tone="muted" numberOfLines={1}>
        {label}
      </Text>
      <Text variant="title" numeric numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

/** End-of-session report: shown right after « Terminer », reopenable from the session menu. */
export function SessionSummarySheet() {
  const t = useTheme();
  const workoutId = useSessionSummary((s) => s.workoutId);
  const hide = useSessionSummary((s) => s.hide);
  const summary = workoutId === null ? null : sessionSummary(workoutId);
  const trend =
    summary === null || summary.previousTonnage === null || summary.previousTonnage === 0
      ? null
      : (summary.tonnage - summary.previousTonnage) / summary.previousTonnage;

  return (
    <Sheet visible={workoutId !== null && summary !== null} onClose={hide} title="Séance terminée">
      {summary !== null && (
        <View style={{ paddingHorizontal: space.lg, gap: space.md }}>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Stat label="Durée" value={summary.durationMin === null ? '–' : `${summary.durationMin} min`} />
            <Stat label="Séries" value={String(summary.sets)} />
          </View>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Stat label="Tonnage" value={tons(summary.tonnage)} />
            <Stat label="Reps" value={String(summary.reps)} />
          </View>
          {summary.deload === true && trend === null && (
            <Text variant="small" tone="muted">
              Semaine de deload : volume réduit volontairement, pas de comparaison avec une semaine normale.
            </Text>
          )}
          {trend !== null && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Ionicons name={trend >= 0 ? 'trending-up' : 'trending-down'} size={18} color={trend >= 0 ? t.accent : t.warning} />
              <Text variant="small" tone="secondary" style={{ flex: 1 }}>
                {trend >= 0 ? '+' : '−'}
                {Math.abs(Math.round(trend * 100))} % de tonnage par rapport à la dernière fois ({tons(summary.previousTonnage ?? 0)})
              </Text>
            </View>
          )}
          {summary.records.length > 0 ? (
            <View style={{ gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: t.goldSoft }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <Ionicons name="trophy" size={18} color={t.gold} />
                <Text variant="bodyStrong" tone="gold">
                  {summary.records.length === 1 ? 'Nouveau record' : `${summary.records.length} nouveaux records`}
                </Text>
              </View>
              {summary.records.map((r) => (
                <Text key={r.exerciseId} variant="small" tone="secondary">
                  {r.exerciseName} : {r.lest && r.weight > 0 ? '+' : ''}
                  {r.lest && r.weight === 0 ? 'PDC' : `${formatWeight(r.weight)} kg`} × {r.reps} · e1RM {formatWeight(Math.round(r.e1rm * 10) / 10)} kg
                </Text>
              ))}
            </View>
          ) : (
            <Text variant="small" tone="muted">
              Pas de record aujourd’hui : la régularité fait le travail.
            </Text>
          )}
          <Button label="Fermer" onPress={hide} />
          <Button
            label="Analyser avec le coach"
            icon="sparkles-outline"
            variant="secondary"
            onPress={() => {
              hide();
              router.push({ pathname: '/coach', params: { q: 'Fais le bilan de ma séance du jour : ce qui a bien marché, ce qui a coincé, et quoi ajuster la prochaine fois.' } });
            }}
          />
          <Button
            label="Reprendre la séance"
            variant="ghost"
            size="sm"
            onPress={() => {
              if (workoutId === null) return;
              resumeWorkout(workoutId);
              useWorkoutStore.getState().load(workoutId);
              hide();
            }}
          />
        </View>
      )}
    </Sheet>
  );
}
