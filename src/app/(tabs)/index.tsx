import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';

import { addDays, formatLongDate, formatShortDate, startOfWeek, weekday, weekdayShort } from '@/domain/dates';
import { mesocycleForDate, phaseFor, totalWeeks } from '@/domain/mesocycle';
import { mesoKindInfo } from '@/domain/mesoTypes';
import { formatWeight } from '@/domain/math';
import { nextPlanned } from '@/domain/planning';
import { listMesocycles } from '@/db/repos/cycles';
import { listExercises } from '@/db/repos/exercises';
import { workoutSummaries } from '@/db/repos/history';
import { listPlanned } from '@/db/repos/planning';
import { listTemplateExercises, listTemplates } from '@/db/repos/templates';
import { getActiveWorkout, listWorkouts } from '@/db/repos/workouts';
import { WorkoutView } from '@/features/workout/WorkoutView';
import { Orbit } from '@/features/navigation/Orbit';
import { syncCloud } from '@/services/cloud';
import { beginWorkout } from '@/services/startFlow';
import { templatePreview, type TemplatePreviewLine } from '@/services/workoutService';
import { Glass } from '@/ui/components/Glass';
import { Columns } from '@/ui/components/layout';
import { Sheet } from '@/ui/components/Sheet';
import { Badge, Button, Card, IconButton, Tap, Text } from '@/ui/components/primitives';
import { Reveal, Screen } from '@/ui/components/Screen';
import { family, radius, shade, space, useTheme } from '@/ui/theme';
import { MESO_KIND_COLOR, splitTemplateName } from '@/ui/labels';
import { useLive } from '@/ui/useLive';
import { useToday } from '@/ui/useToday';
import { setAmbient } from '@/ui/ambient';
import { Tilt } from '@/ui/components/Tilt';
import { useWorkoutStore } from '@/state/workoutStore';

export default function TodayScreen() {
  const activeId = useLive(() => getActiveWorkout()?.id ?? null, []);
  if (activeId !== null) return <WorkoutView workoutId={activeId} host="tabs" />;
  return <TodayOverview />;
}

/** "Mardi — Poussée + triceps" → day + focus. */
const splitName = splitTemplateName;

interface TemplateInfo {
  id: string;
  name: string;
  lines: { name: string; main: boolean }[];
}

function useTodayData(date: string) {
  return useLive(() => {
    const exercises = new Map(listExercises(true).map((e) => [e.id, e]));
    const templates: TemplateInfo[] = listTemplates().map((tp) => ({
      id: tp.id,
      name: tp.name,
      lines: listTemplateExercises(tp.id).flatMap((te) => {
        const ex = exercises.get(te.exerciseId);
        if (ex === undefined) return [];
        const main = (te.progressionType ?? ex.progressionType) === 'top_set_backoff';
        return [{ name: ex.name, main }];
      }),
    }));
    const week = startOfWeek(date);
    return {
      templates,
      planned: listPlanned(addDays(date, -1), addDays(date, 21)),
      weekPlanned: listPlanned(week, addDays(week, 6)),
      weekWorkouts: listWorkouts(week, addDays(week, 6)),
      recent: workoutSummaries(addDays(date, -60), date).slice(0, 5),
      meso: mesocycleForDate(listMesocycles(), date),
    };
  }, [date]);
}

// ---------------------------------------------------------------- hero

function SessionHero({ data, date }: { data: ReturnType<typeof useTodayData>; date: string }) {
  const t = useTheme();
  const short = useWindowDimensions().height < 720;
  const pending = data.planned.filter((p) => p.date === date && p.workoutId === null);
  const doneToday = data.recent.filter((w) => w.date === date);
  const next = pending[0] ?? null;
  const upcoming = next === null ? nextPlanned(data.planned, addDays(date, 1)) : null;
  const target = next ?? upcoming;
  // Phase of the session shown (an upcoming one can fall in another week than today).
  const phase = data.meso === null ? null : phaseFor(data.meso, target?.date ?? date);
  // What starting it will prescribe (same engine): real top set loads, deload volume included.
  const targetTemplate = target?.templateId ?? null;
  const targetDate = target?.date ?? date;
  const preview = useLive(() => (targetTemplate === null ? [] : templatePreview(targetTemplate, targetDate)), [targetTemplate, targetDate]);
  const scheme = (l: TemplatePreviewLine) =>
    // The phase is already on the badge: no « Deload · » prefix per line.
    !l.main ? l.label.replace(/^Deload · /, '') : l.top === null ? 'Top set' : l.lest && l.top.weight === 0 ? `PDC × ${l.top.reps}` : `${l.lest ? '+' : ''}${formatWeight(l.top.weight)} kg × ${l.top.reps}`;

  if (next === null && doneToday.length > 0) {
    const w = doneToday[0];
    return (
      <Card level="raised" glow onPress={() => router.push(`/workout/${w?.id ?? ''}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg, padding: space.xl }}>
        <View style={{ width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: t.accentSoft, boxShadow: shade(`0px 0px 30px ${t.accentGlow}`) }}>
          <Ionicons name="checkmark" size={34} color={t.accent} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label" tone="accent">
            Séance faite
          </Text>
          <Text variant="title">{w?.name ?? ''}</Text>
          <Text variant="small" tone="secondary">
            {doneToday.reduce((n, x) => n + x.setCount, 0)} séries · {doneToday.reduce((n, x) => n + x.exerciseCount, 0)} exercices
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={t.textMuted} />
      </Card>
    );
  }

  if (target === null) {
    return (
      <Card level="raised" style={{ padding: space.xl, gap: space.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <Ionicons name="moon-outline" size={26} color={t.info} />
          <Text variant="title">Repos</Text>
        </View>
        <Text tone="secondary">Rien de prévu. Choisis une séance type ou lance une séance libre.</Text>
      </Card>
    );
  }

  const { day, focus } = splitName(target.title);
  // Small phones: the start button must be on screen without scrolling.
  const lines = preview;
  const shown = short ? lines.slice(0, 3) : lines;
  const hidden = lines.length - shown.length;
  return (
    <Glass level="raised" glow radius={radius.xl} contentStyle={{ padding: short ? space.lg : space.xl, gap: short ? space.md : space.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
        <Text variant="label" tone="accent">
          {next !== null ? 'Prévu aujourd’hui' : `Prochaine séance · ${weekdayShort(weekday(target.date))} ${formatShortDate(target.date)}`}
        </Text>
        {phase?.kind === 'deload' && <Badge label="Deload" color={t.info} />}
        {phase?.kind === 'work' && <Badge label={`Semaine ${phase.week}`} color={t.accent} />}
      </View>
      <View>
        {day !== '' && (
          <Text variant="title" tone="secondary" style={{ fontSize: 18 }}>
            {day}
          </Text>
        )}
        <Text variant="hero" style={short ? { fontSize: 28, lineHeight: 33 } : { fontSize: 36, lineHeight: 42 }}>
          {focus}
        </Text>
      </View>
      {lines.length > 0 && (
        <View style={{ gap: short ? 0 : 2 }}>
          {shown.map((l, i) => (
            <View key={`${l.name}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 7 }}>
              <Text variant={l.main ? 'bodyStrong' : 'body'} tone={l.main ? 'default' : 'secondary'} style={{ flex: 1 }} numberOfLines={2}>
                {l.name}
              </Text>
              <Text variant="small" tone={l.main ? 'accent' : 'muted'} numeric numberOfLines={1} style={l.main ? { fontFamily: family.semibold } : undefined}>
                {scheme(l)}
              </Text>
            </View>
          ))}
          {hidden > 0 && (
            <Text variant="small" tone="muted" style={{ paddingTop: 4 }}>
              + {hidden} autre{hidden > 1 ? 's' : ''} exercice{hidden > 1 ? 's' : ''}
            </Text>
          )}
        </View>
      )}
      <Button
        label={next !== null ? 'Démarrer la séance' : 'Démarrer maintenant'}
        icon="play"
        size="lg"
        variant={next !== null ? 'primary' : 'secondary'}
        // The planned session itself (its week of the cycle, as previewed), even ahead of its day.
        onPress={() => beginWorkout({ plannedId: target.id })}
      />
    </Glass>
  );
}

// ---------------------------------------------------------------- week & cycle

/** This week, day by day: done (filled), planned (ring), today (gold ring), rest (muted). */
function WeekDays({ data, date }: { data: ReturnType<typeof useTodayData>; date: string }) {
  const t = useTheme();
  const narrow = useWindowDimensions().width < 340;
  const size = narrow ? 28 : 32;
  const week = startOfWeek(date);
  return (
    <View style={{ flexDirection: 'row' }}>
      {Array.from({ length: 7 }, (_, i) => {
        const d = addDays(week, i);
        const done = data.weekWorkouts.some((w) => w.date === d && w.status === 'completed');
        const planned = data.weekPlanned.some((p) => p.date === d && p.workoutId === null);
        const isToday = d === date;
        return (
          <Tap
            key={d}
            onPress={() => router.navigate('/planning')}
            scaleTo={0.9}
            highlightRadius={radius.md}
            accessibilityLabel={`${weekdayShort(i)} ${formatShortDate(d)}${done ? ', séance faite' : planned ? ', séance prévue' : ', repos'}`}
            style={{ flex: 1, alignItems: 'center', gap: 5, paddingVertical: 4 }}>
            <Text variant="caption" tone={isToday ? 'gold' : 'muted'} style={{ fontFamily: isToday ? family.semibold : undefined }}>
              {weekdayShort(i).slice(0, 1)}
            </Text>
            <View
              style={{
                width: size,
                height: size,
                borderRadius: size / 2,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: done ? t.accent : 'transparent',
                borderWidth: isToday ? 2 : planned && !done ? 1.5 : 0,
                borderColor: isToday ? t.gold : `${t.accent}AA`,
                boxShadow: shade(done ? `0px 0px 12px ${t.accentGlow}` : undefined, true),
              }}>
              {done ? (
                <Ionicons name="checkmark" size={narrow ? 14 : 16} color={t.onAccent} />
              ) : (
                <Text style={{ fontFamily: family.displaySemi, fontSize: narrow ? 12 : 13, color: planned || isToday ? t.text : t.textMuted }} maxFontSizeMultiplier={1.15}>
                  {Number(d.slice(8))}
                </Text>
              )}
            </View>
          </Tap>
        );
      })}
    </View>
  );
}

/**
 * Under the hero, the essentials only: the cycle week (one line + a thin bar), this week day by
 * day, the next session and the last one. The details are one tap away (cycle editor, planning).
 */
function PlanningPanel({ data, date }: { data: ReturnType<typeof useTodayData>; date: string }) {
  const t = useTheme();
  const meso = data.meso;
  const nextOne = nextPlanned(data.planned, addDays(date, 1));
  const last = data.recent.find((w) => w.date < date) ?? data.recent[0];
  const links = (
    <View style={{ gap: 0 }}>
      {nextOne !== null && (
        <LinkLine label="Ensuite" value={`${weekdayShort(weekday(nextOne.date))} ${formatShortDate(nextOne.date)} · ${splitName(nextOne.title).focus}`} onPress={() => router.navigate('/planning')} />
      )}
      {last !== undefined && (
        <LinkLine label="Dernière" value={`${weekdayShort(weekday(last.date))} ${formatShortDate(last.date)} · ${splitName(last.name).focus}`} onPress={() => router.push(`/workout/${last.id}`)} />
      )}
    </View>
  );
  if (meso === null) {
    return (
      <Card style={{ gap: space.md }}>
        <Tap onPress={() => router.push('/mesocycle/new')} scaleTo={0.98} highlightRadius={radius.md} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48 }}>
          <View style={{ flex: 1 }}>
            <Text variant="bodyStrong">Pas de cycle en cours</Text>
            <Text variant="small" tone="secondary">
              Crée un bloc pour piloter tes charges.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={t.textMuted} />
        </Tap>
        <WeekDays data={data} date={date} />
        {links}
      </Card>
    );
  }
  const phase = phaseFor(meso, date);
  const weeks = totalWeeks(meso);
  const current = phase.kind === 'before' ? 0 : Math.min(phase.week, weeks);
  const kind = mesoKindInfo(meso.kind);
  const kindColor = MESO_KIND_COLOR[meso.kind](t);
  const title =
    phase.kind === 'work'
      ? `Semaine ${phase.week} sur ${meso.workWeeks}`
      : phase.kind === 'deload'
        ? 'Semaine de deload'
        : phase.kind === 'before'
          ? `Commence dans ${phase.daysUntilStart} j`
          : 'Bloc terminé';

  return (
    <Card style={{ gap: space.md }}>
      <Tap
        onPress={() => router.push(phase.kind === 'over' ? '/mesocycle/new' : `/mesocycle/${meso.id}`)}
        scaleTo={0.98}
        highlightRadius={radius.md}
        accessibilityLabel={`${meso.name}, ${kind.label}, ${title}`}
        style={{ gap: space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44 }}>
          <View style={{ flex: 1 }}>
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {meso.name} · {kind.label}
            </Text>
            <Text variant="bodyStrong">{title}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={t.textMuted} />
        </View>
        <View style={{ flexDirection: 'row', gap: 4 }} accessibilityElementsHidden>
          {Array.from({ length: weeks }, (_, i) => {
            const deload = i >= meso.workWeeks;
            const reached = i + 1 <= current;
            const now = i + 1 === current;
            const color = deload ? t.info : kindColor;
            return <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: reached ? color : t.surfaceAlt, opacity: reached && !now ? 0.45 : 1 }} />;
          })}
        </View>
      </Tap>
      <WeekDays data={data} date={date} />
      {links}
    </Card>
  );
}

/** « Ensuite · Sam. 17 oct. · Haut du corps › » */
function LinkLine({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Tap onPress={onPress} scaleTo={0.98} highlightRadius={radius.sm} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 44 }}>
      <Text variant="small" tone="muted" style={{ width: 64 }}>
        {label}
      </Text>
      <Text variant="small" numberOfLines={1} style={{ flex: 1 }}>
        {value}
      </Text>
      <Ionicons name="chevron-forward" size={16} color={t.textMuted} />
    </Tap>
  );
}

// ---------------------------------------------------------------- templates & history

/** A template: day, focus and exercise count in one row, play on the right. */
function TemplateRow({ tpl, onStart }: { tpl: TemplateInfo; onStart?: () => void }) {
  const t = useTheme();
  const { day, focus } = splitName(tpl.name);
  return (
    <Tap onPress={() => (onStart?.(), beginWorkout({ templateId: tpl.id }))} scaleTo={0.985} highlightRadius={0} accessibilityLabel={`Démarrer ${tpl.name}`}>
      <View style={{ minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.sm + 2 }}>
        <View style={{ flex: 1, gap: 1 }}>
          <Text variant="caption" tone="accent" style={{ fontFamily: family.semibold }} numberOfLines={1}>
            {day === '' ? 'Séance type' : day}
          </Text>
          <Text variant="bodyStrong" numberOfLines={2}>
            {focus}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {tpl.lines.length} exercices · {tpl.lines[0]?.name ?? ''}
          </Text>
        </View>
        <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: t.accentSoft }}>
          <Ionicons name="play" size={15} color={t.accent} />
        </View>
      </View>
    </Tap>
  );
}

/** Every other way to start: a template of the week or a free session (sheet, one tap away). */
function OtherSessionSheet({ visible, onClose, templates }: { visible: boolean; onClose: () => void; templates: readonly TemplateInfo[] }) {
  return (
    <Sheet visible={visible} onClose={onClose} title="Autre séance">
      <View style={{ paddingHorizontal: space.sm }}>
        {templates.map((tpl) => (
          <TemplateRow key={tpl.id} tpl={tpl} onStart={onClose} />
        ))}
        <Tap
          onPress={() => (onClose(), beginWorkout({}))}
          scaleTo={0.985}
          highlightRadius={radius.md}
          accessibilityLabel="Démarrer une séance libre"
          style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg }}>
          <Ionicons name="flash-outline" size={20} />
          <Text variant="bodyStrong" style={{ flex: 1 }}>
            Séance libre
          </Text>
        </Tap>
        {templates.length === 0 && (
          <Button label="Créer une séance type" icon="add" variant="ghost" onPress={() => (onClose(), router.navigate('/planning'))} />
        )}
      </View>
    </Sheet>
  );
}

function TodayOverview() {
  const t = useTheme();
  const date = useToday();
  const data = useTodayData(date);
  const [other, setOther] = useState(false);
  const [spaces, setSpaces] = useState(false);
  // Lumière d'état : séance en cours (accent), séance du jour faite (vert) — tant que l'accueil est affiché.
  const live = useWorkoutStore((s) => Object.values(s.docs).some((d) => d.workout.status === 'active'));
  const done = data.recent.some((w) => w.date === date);
  const tone = live ? 'accent' : done ? 'success' : null;
  useFocusEffect(
    useCallback(() => {
      setAmbient(tone);
      return () => setAmbient(null);
    }, [tone]),
  );

  return (
    <Screen
      title="Aujourd’hui"
      subtitle={formatLongDate(date)}
      mood="today"
      onRefresh={() => syncCloud()}
      right={
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {/* Même en-tête dans toutes les apps : le bouton propre à l'app, puis les Espaces MyLife. */}
          <IconButton icon="sparkles" label="Coach IA" glass color={t.accent} onPress={() => router.push('/coach')} />
          <IconButton icon="apps-outline" label="Espaces MyLife" glass onPress={() => setSpaces(true)} />
        </View>
      }>
      <Columns weights={[1.45, 1]}>
        <View style={{ gap: space.sm }}>
          <Reveal index={0}>
            <Tilt>
              <SessionHero data={data} date={date} />
            </Tilt>
          </Reveal>
          <Button label="Autre séance" icon="list" variant="ghost" onPress={() => setOther(true)} />
        </View>
        <View style={{ gap: space.md, marginTop: space.sm }}>
          <Reveal index={1}>
            <PlanningPanel data={data} date={date} />
          </Reveal>
        </View>
      </Columns>
      <OtherSessionSheet visible={other} onClose={() => setOther(false)} templates={data.templates} />
      <Orbit visible={spaces} onClose={() => setSpaces(false)} />
    </Screen>
  );
}
