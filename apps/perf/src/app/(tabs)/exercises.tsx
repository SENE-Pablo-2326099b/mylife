import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { regionById, type RegionId } from '@/domain/bodyMap';
import { listExercises } from '@/db/repos/exercises';
import { exerciseActivity } from '@/db/repos/history';
import { BodyLegend, BodyMap } from '@/features/exercises/BodyMap';
import { ExerciseList } from '@/features/exercises/ExerciseList';
import { MuscleDetail } from '@/features/exercises/MuscleDetail';
import { bodyMapData, regionDetail } from '@/services/muscleService';
import { Columns } from '@/ui/components/layout';
import { Card, Chip, Segmented, Tap, Text } from '@/ui/components/primitives';
import { Screen } from '@/ui/components/Screen';
import { radius, shade, space, useTheme } from '@/ui/theme';
import { useLive } from '@/ui/useLive';
import { useToday } from '@/ui/useToday';
import { Tilt } from '@/ui/components/Tilt';

type Mode = 'body' | 'list';
const WINDOWS = [7, 28] as const;

function AddButton() {
  const t = useTheme();
  return (
    <Tap
      onPress={() => router.push('/exercise-edit')}
      accessibilityLabel="Créer un exercice"
      magnetic
      scaleTo={0.9}
      highlightRadius={radius.pill}
      style={{ width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: t.accent, boxShadow: shade(`0px 8px 22px ${t.accentGlow}, inset 0px 1px 0px ${t.highlight}`) }}>
      <Ionicons name="add" size={26} color={t.onAccent} />
    </Tap>
  );
}

/** Muscles ranked by weekly sets: a quick way to pick one without hunting on the drawing. */
function Ranking({ loads, onSelect }: { loads: ReturnType<typeof bodyMapData>; onSelect: (id: RegionId) => void }) {
  const sorted = [...loads].sort((a, b) => b.perWeek - a.perWeek);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {sorted.map((l) => (
        <Chip key={l.region} small label={`${regionById(l.region).label} ${Math.round(l.perWeek)}`} onPress={() => onSelect(l.region)} />
      ))}
    </View>
  );
}

export default function ExercisesScreen() {
  const t = useTheme();
  const date = useToday();
  const [mode, setMode] = useState<Mode>('list');
  const [windowDays, setWindowDays] = useState<number>(28);
  const [selected, setSelected] = useState<RegionId | null>(null);
  const [listMuscle, setListMuscle] = useState<RegionId | null>(null);
  const exercises = useLive(() => listExercises(), []);
  const lastDates = useLive(() => (mode === 'list' ? new Map(exerciseActivity().map((a) => [a.exerciseId, a.lastDate])) : null), [mode]);
  const loads = useLive(() => (mode === 'body' ? bodyMapData(date, windowDays) : []), [mode, date, windowDays]);
  const detail = useLive(() => (mode === 'body' && selected !== null ? regionDetail(selected, date, windowDays) : null), [mode, selected, date, windowDays]);

  const toggle = (
    <Segmented<Mode>
      options={[
        { value: 'list', label: 'Liste' },
        { value: 'body', label: 'Corps' },
      ]}
      value={mode}
      onChange={(m) => {
        setListMuscle(null);
        setMode(m);
      }}
    />
  );

  if (mode === 'list') {
    const initial = listMuscle === null ? null : (regionById(listMuscle).muscles[0] ?? null);
    return (
      <Screen title="Exercices" subtitle="Bibliothèque" mood="library" scroll={false} right={<AddButton />}>
        <ExerciseList key={listMuscle ?? 'all'} exercises={exercises} lastDates={lastDates ?? undefined} initialMuscle={initial} header={toggle} onPress={(e) => router.push(`/exercise/${e.id}`)} />
      </Screen>
    );
  }

  const map = (
    <Tilt><Card style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
        <Text variant="label" tone="muted" style={{ flex: 1 }}>
          Volume moyen
        </Text>
        {WINDOWS.map((w) => (
          <Chip key={w} small label={`${w} jours`} selected={windowDays === w} onPress={() => setWindowDays(w)} />
        ))}
      </View>
      <BodyMap loads={loads} selected={selected} onSelect={(id) => setSelected(id === selected ? null : id)} />
      {selected === null ? (
        <BodyLegend />
      ) : (
        // Immediate feedback right under the drawing (the details follow below on phones).
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: t.gold }} />
          <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
            {regionById(selected).label} · {loads.find((l) => l.region === selected)?.perWeek ?? 0} séries / sem.
          </Text>
          <Tap onPress={() => setSelected(null)} accessibilityLabel="Désélectionner" scaleTo={0.85} highlightRadius={14} style={{ padding: 4, borderRadius: 14 }}>
            <Ionicons name="close-circle" size={20} color={t.textMuted} />
          </Tap>
        </View>
      )}
    </Card></Tilt>
  );

  const side =
    detail === null ? (
      <Card style={{ gap: space.md }}>
        <Text variant="small" tone="secondary">
          Touche un muscle sur le dessin, ou choisis-le (séries par semaine) :
        </Text>
        <Ranking loads={loads} onSelect={setSelected} />
      </Card>
    ) : (
      <MuscleDetail
        detail={detail}
        today={date}
        windowDays={windowDays}
        onShowAll={() => {
          setListMuscle(detail.region);
          setMode('list');
        }}
      />
    );

  return (
    <Screen title="Exercices" subtitle="Carte musculaire" mood="library" right={<AddButton />}>
      <View style={{ gap: space.md }}>
        {toggle}
        <Columns weights={[1, 1]}>
          {map}
          {side}
        </Columns>
      </View>
    </Screen>
  );
}
