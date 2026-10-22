import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useWindowDimensions, View } from 'react-native';

import { formatShortDate } from '@/domain/dates';
import { formatPercent, formatWeight } from '@/domain/math';
import { BACKOFF_REPS, TOP_REPS } from '@/domain/mesocycle';
import type { StrengthWeek, WeekOverride } from '@/domain/types';
import { getMesocycle } from '@/db/repos/cycles';
import { emptyOverride, saveWeekOverride, weekOverrides } from '@/db/repos/cyclePlans';
import { getExercise } from '@/db/repos/exercises';
import { ReferenceCard } from '@/features/stats/ReferenceCard';
import { cyclePlanPreview, type WeekPreview } from '@/services/workoutService';
import { useSettings } from '@/state/settingsStore';
import { AutoStepper, Badge, Button, Card, IconButton, Text } from '@/ui/components/primitives';
import { NotFoundScreen, Screen } from '@/ui/components/Screen';
import { space, useTheme } from '@/ui/theme';
import { useLive } from '@/ui/useLive';

const pct = formatPercent;

/** Current effective values of a week, read back from its prescription. */
function effective(p: WeekPreview) {
  const tops = p.prescription.sets.filter((s) => s.setType === 'top_set');
  const backs = p.prescription.sets.filter((s) => s.setType === 'backoff');
  return {
    topSets: tops.length,
    topRepsMin: tops[0]?.targetReps ?? 5,
    topRepsMax: tops[0]?.targetRepsMax ?? tops[0]?.targetReps ?? 5,
    topWeight: tops[0]?.targetWeight ?? null,
    backoffSets: backs.length,
    backoffReps: backs[0]?.targetReps ?? 5,
    backoffWeight: backs[0]?.targetWeight ?? null,
  };
}

function WeekCard({
  preview,
  override,
  base,
  increment,
  lest,
  onChange,
}: {
  preview: WeekPreview;
  override: WeekOverride;
  /** The cycle's week (or deload) shape this exercise inherits. */
  base: StrengthWeek;
  increment: number;
  lest: boolean;
  onChange: (o: WeekOverride) => void;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const e = effective(preview);
  const set = (patch: Partial<WeekOverride>) => onChange({ ...override, ...patch });
  const touched = Object.entries(override).some(([k, v]) => k !== 'weekIndex' && v !== null);
  const kg = (v: number | null) => (v === null ? '? kg' : `${lest && v > 0 ? '+' : ''}${lest && v === 0 ? 'PDC' : `${formatWeight(v)} kg`}`);
  const reps = e.topRepsMin === e.topRepsMax ? `${e.topRepsMin}` : `${e.topRepsMin}-${e.topRepsMax}`;
  const topPct = override.topPercent ?? base.topPercent;
  const backPct = override.backoffPercent ?? base.backoffPercent;
  const pair = { flexDirection: useWindowDimensions().width < 400 ? 'column' : 'row', gap: space.md } as const;

  return (
    <Card style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <Text variant="bodyStrong">
            {preview.isDeload ? 'Deload' : `Semaine ${preview.weekIndex}`} · {formatShortDate(preview.date)}
          </Text>
          <Text tone="secondary" numeric>
            Top {e.topSets} × {reps} @ {kg(e.topWeight)}
          </Text>
          {e.backoffSets > 0 && (
            <Text tone="secondary" numeric>
              Backoffs {e.backoffSets} × {e.backoffReps} @ {kg(e.backoffWeight)}
            </Text>
          )}
          <Text variant="caption" tone="muted" numeric>
            {`Top ${pct(topPct)}`}
            {e.backoffSets > 0 ? ` · backoffs ${pct(backPct)}` : ''} du 1RM
          </Text>
        </View>
        {touched && <Badge label="Ajusté" color={t.accent} />}
        <IconButton icon={open ? 'chevron-up' : 'options-outline'} label="Ajuster la semaine" onPress={() => setOpen(!open)} />
      </View>
      {open && (
        <View style={{ gap: space.md, marginTop: space.sm }}>
          <AutoStepper
            label="Top set (% du 1RM)"
            autoLabel="Valeur du cycle"
            value={override.topPercent}
            fallback={base.topPercent}
            step={0.025}
            snap
            min={0.4}
            max={1}
            format={pct}
            onChange={(topPercent) => set({ topPercent })}
          />
          <View style={pair}>
            <View style={{ flex: 1 }}>
              <AutoStepper label="Top sets" autoLabel="Défaut" value={override.topSets} fallback={e.topSets} min={0} max={5} onChange={(topSets) => set({ topSets })} />
            </View>
            <View style={{ flex: 1 }}>
              <AutoStepper
                label="Reps top"
                autoLabel="Défaut"
                value={override.topRepsMin}
                fallback={e.topRepsMin}
                min={TOP_REPS.min}
                max={TOP_REPS.max}
                onChange={(topRepsMin) => set({ topRepsMin, topRepsMax: topRepsMin })}
              />
            </View>
          </View>
          <View style={pair}>
            <View style={{ flex: 1 }}>
              <AutoStepper label="Backoffs" autoLabel="Défaut" value={override.backoffSets} fallback={e.backoffSets} min={0} max={8} onChange={(backoffSets) => set({ backoffSets })} />
            </View>
            <View style={{ flex: 1 }}>
              <AutoStepper
                label="Reps backoff"
                autoLabel="Défaut"
                value={override.backoffReps}
                fallback={e.backoffReps}
                min={BACKOFF_REPS.min}
                max={BACKOFF_REPS.max}
                onChange={(backoffReps) => set({ backoffReps })}
              />
            </View>
          </View>
          <AutoStepper
            label="Backoffs (% du 1RM)"
            autoLabel="Valeur du cycle"
            value={override.backoffPercent}
            fallback={base.backoffPercent}
            step={0.025}
            snap
            min={0.3}
            max={1}
            format={pct}
            onChange={(backoffPercent) => set({ backoffPercent })}
          />
          {touched && <Button label="Revenir aux valeurs du cycle" variant="ghost" size="sm" onPress={() => onChange(emptyOverride(override.weekIndex))} />}
        </View>
      )}
    </Card>
  );
}

/** Per exercise, per week settings of a mesocycle: nothing is imposed, everything is editable. */
export default function CyclePlanScreen() {
  const { meso: mesoId, exercise: exerciseId } = useLocalSearchParams<{ meso: string; exercise: string }>();
  const increment = useSettings((s) => s.settings.increment);
  const data = useLive(
    () => ({
      meso: getMesocycle(mesoId),
      exercise: getExercise(exerciseId),
      overrides: weekOverrides(mesoId, exerciseId),
      preview: cyclePlanPreview(mesoId, exerciseId),
    }),
    [mesoId, exerciseId],
  );
  if (data.meso === null || data.exercise === null) return <NotFoundScreen title="Introuvable" body="Ce cycle ou cet exercice n’existe plus." />;
  const { meso, exercise } = data;
  const lest = exercise.loadType === 'bodyweight';

  return (
    <Screen stack title={exercise.name} mood="planning" maxWidth={760}>
      <Text variant="title">{meso.name}</Text>
      <Text variant="small" tone="secondary" style={{ marginTop: 2, marginBottom: space.lg }}>
        Charges = % du 1RM de référence{lest ? ' (poids de corps + lest)' : ''}. Ajuste semaine par semaine ; « Auto » revient au calcul.
      </Text>
      <ReferenceCard exerciseId={exercise.id} lest={lest} />
      <View style={{ gap: space.sm, marginTop: space.md }}>
        {data.preview.map((p) => (
          <WeekCard
            key={p.weekIndex}
            preview={p}
            override={data.overrides.get(p.weekIndex) ?? emptyOverride(p.weekIndex)}
            base={p.isDeload ? meso.deload.main : (meso.scheme[p.weekIndex - 1] ?? meso.deload.main)}
            increment={exercise.weightIncrement ?? increment}
            lest={lest}
            onChange={(o) => saveWeekOverride(meso.id, exercise.id, o)}
          />
        ))}
      </View>
    </Screen>
  );
}
