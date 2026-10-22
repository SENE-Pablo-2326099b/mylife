import Ionicons from '@expo/vector-icons/Ionicons';
import { FlashList } from '@shopify/flash-list';
import { useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { parseDate, today } from '@/domain/dates';
import { searchKey } from '@/domain/text';
import { MUSCLES, type Equipment, type Exercise, type Muscle } from '@/domain/types';
import { Glass } from '@/ui/components/Glass';
import { listTemplateExercises, listTemplates } from '@/db/repos/templates';
import { Chip, EmptyState, IconButton, Tap, Text } from '@/ui/components/primitives';
import { useLive } from '@/ui/useLive';
import { useGutter } from '@/ui/components/Screen';
import { CATEGORY_LABEL, EQUIPMENT_LABEL, MUSCLE_LABEL, PROGRESSION_LABEL, splitTemplateName } from '@/ui/labels';
import { CONTENT_MAX, useBreakpoint, useDockInset } from '@/ui/responsive';
import { family, type Palette, radius, space, useTheme } from '@/ui/theme';

const EQUIPMENT_FILTERS: readonly Equipment[] = ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'kettlebell', 'band'];

/** Accent-insensitive search: "developpe" matches "Développé". */
export const normalize = searchKey;

export function filterExercises(list: readonly Exercise[], query: string, muscle: Muscle | null, equipment: Equipment | null): Exercise[] {
  const q = normalize(query.trim());
  return list.filter(
    (e) =>
      (q === '' || normalize(e.name).includes(q)) &&
      (muscle === null || e.primaryMuscles.includes(muscle) || e.secondaryMuscles.includes(muscle)) &&
      (equipment === null || e.equipment === equipment),
  );
}

export function exerciseSubtitle(e: Exercise): string {
  const muscles = e.primaryMuscles.map((m) => MUSCLE_LABEL[m]).join(', ');
  return `${muscles} · ${EQUIPMENT_LABEL[e.equipment]} · ${e.progressionType === 'top_set_backoff' ? PROGRESSION_LABEL.top_set_backoff : CATEGORY_LABEL[e.category]}`;
}

/** Each muscle family carries its own light, so the library reads at a glance. */
export function muscleColor(m: Muscle | undefined, t: Palette): string {
  switch (m) {
    case 'chest':
    case 'triceps':
      return t.accent;
    case 'back':
    case 'lats':
    case 'traps':
    case 'biceps':
    case 'forearms':
      return t.info;
    case 'quads':
    case 'hamstrings':
    case 'glutes':
    case 'adductors':
    case 'calves':
      return t.setType.drop;
    case 'shoulders':
    case 'rear_delts':
      return t.gold;
    default:
      return t.setType.warmup;
  }
}

/** « auj. », « il y a 3 j », « il y a 5 sem. » — when the exercise was last trained. */
function since(lastDate: string, today: string): string {
  const days = Math.round((parseDate(today).getTime() - parseDate(lastDate).getTime()) / 86_400_000);
  if (days <= 0) return 'auj.';
  if (days === 1) return 'hier';
  if (days < 14) return `${days}\u00A0j`;
  if (days < 70) return `${Math.round(days / 7)}\u00A0sem.`;
  return `${Math.round(days / 30)}\u00A0mois`;
}

/** One exercise in a grouped card: name, then main muscle · equipment, last session on the right. */
function ExerciseRow({ e, first, onPress, since: lastLabel }: { e: Exercise; first: boolean; last?: boolean; onPress: () => void; since?: string }) {
  const t = useTheme();
  const main = e.progressionType === 'top_set_backoff';
  return (
    <Tap onPress={onPress} scaleTo={0.985} highlightRadius={radius.md}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          minHeight: 56,
          paddingHorizontal: space.lg,
          paddingVertical: space.sm + 2,
          borderTopWidth: first ? 0 : StyleSheet.hairlineWidth,
          borderTopColor: t.border,
        }}>
        <View style={{ flex: 1, gap: 1 }}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {e.name}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {MUSCLE_LABEL[e.primaryMuscles[0] ?? 'abs']} · {EQUIPMENT_LABEL[e.equipment]}
            {main ? ' · principal' : ''}
          </Text>
        </View>
        {lastLabel !== undefined && (
          <Text variant="caption" tone="secondary" numberOfLines={1} accessibilityLabel={`Dernière séance : ${lastLabel}`}>
            {lastLabel}
          </Text>
        )}
      </View>
    </Tap>
  );
}

/** A session template, folded: day + focus + count; unfolds into its exercises. */
function TemplateGroup({
  name,
  list,
  onPress,
  lastLabel,
}: {
  name: string;
  list: readonly Exercise[];
  onPress: (e: Exercise) => void;
  lastLabel: (e: Exercise) => string | undefined;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const { day, focus } = splitTemplateName(name);
  return (
    <Glass radius={radius.lg} contentStyle={{ overflow: 'hidden', borderRadius: radius.lg }}>
      <Tap
        onPress={() => setOpen(!open)}
        scaleTo={0.99}
        highlightRadius={radius.lg}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${name}, ${list.length} exercices`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 60, paddingHorizontal: space.lg, paddingVertical: space.sm + 2 }}>
        <View style={{ flex: 1, gap: 1 }}>
          {day !== '' && (
            <Text variant="caption" tone="accent" style={{ fontFamily: family.semibold }}>
              {day}
            </Text>
          )}
          <Text variant="bodyStrong" numberOfLines={1}>
            {focus}
          </Text>
        </View>
        <Text variant="caption" tone="muted">
          {list.length} exos
        </Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={t.textMuted} />
      </Tap>
      {open && (
        <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border }}>
          {list.map((e, i) => (
            <ExerciseRow key={e.id} e={e} first={i === 0} last={i === list.length - 1} onPress={() => onPress(e)} since={lastLabel(e)} />
          ))}
        </View>
      )}
    </Glass>
  );
}

/** Muscles as tiles: name and how many exercises, the way into the library. */
function MuscleGrid({ exercises, onPick }: { exercises: readonly Exercise[]; onPick: (m: Muscle) => void }) {
  const t = useTheme();
  const counts = MUSCLES.map((m) => ({ m, n: filterExercises(exercises, '', m, null).length })).filter((x) => x.n > 0);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
      {counts.map(({ m, n }) => (
        <Tap
          key={m}
          onPress={() => onPick(m)}
          scaleTo={0.96}
          highlightRadius={radius.md}
          accessibilityLabel={`${MUSCLE_LABEL[m]}, ${n} exercices`}
          style={{ flexGrow: 1, flexBasis: '45%', maxWidth: '50%', borderRadius: radius.md }}>
          <Glass radius={radius.md} contentStyle={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, minHeight: 52 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: muscleColor(m, t) }} />
            <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
              {MUSCLE_LABEL[m]}
            </Text>
            <Text variant="caption" tone="muted">
              {n}
            </Text>
          </Glass>
        </Tap>
      ))}
    </View>
  );
}

function Section({ title, children, first = false }: { title: string; children: ReactNode; first?: boolean }) {
  return (
    <View style={{ gap: space.sm, marginTop: first ? space.sm : space.xl }}>
      <Text variant="label" tone="muted" style={{ paddingHorizontal: 2 }}>
        {title}
      </Text>
      {children}
    </View>
  );
}

type View_ = { kind: 'browse' } | { kind: 'muscle'; muscle: Muscle } | { kind: 'all' };

/**
 * The exercise library (tab and picker), built to browse rather than scroll: your sessions'
 * exercises grouped by session (folded), then the muscles as tiles; a muscle or « Toute la
 * bibliothèque » opens a list (with an equipment filter). Typing searches everything.
 */
export function ExerciseList({
  exercises,
  onPress,
  header,
  autoFocus = false,
  initialMuscle = null,
  lastDates,
}: {
  exercises: readonly Exercise[];
  onPress: (e: Exercise) => void;
  header?: ReactNode;
  autoFocus?: boolean;
  /** Opens directly on this muscle (from the body map). */
  initialMuscle?: Muscle | null;
  /** Last training date per exercise id: shown on each row (« il y a 3 j »). */
  lastDates?: ReadonlyMap<string, string>;
}) {
  const t = useTheme();
  const bp = useBreakpoint();
  const gutter = useGutter();
  const dockInset = useDockInset();
  const [query, setQuery] = useState('');
  const [view, setView] = useState<View_>(initialMuscle === null ? { kind: 'browse' } : { kind: 'muscle', muscle: initialMuscle });
  const [equipment, setEquipment] = useState<Equipment | null>(null);
  const templates = useLive(
    () => listTemplates().map((tp) => ({ id: tp.id, name: tp.name, ids: listTemplateExercises(tp.id).map((te) => te.exerciseId) })),
    [],
  );
  const column = { width: '100%' as const, maxWidth: CONTENT_MAX[bp], alignSelf: 'center' as const };
  const now = today();
  const lastLabel = (e: Exercise) => {
    const d = lastDates?.get(e.id);
    return d === undefined ? undefined : since(d, now);
  };
  const byId = new Map(exercises.map((e) => [e.id, e]));
  const searching = query.trim() !== '';

  const listOf = (v: View_): Exercise[] =>
    searching
      ? filterExercises(exercises, query, null, null)
      : v.kind === 'muscle'
        ? filterExercises(exercises, '', v.muscle, equipment)
        : filterExercises(exercises, '', null, equipment);
  const list = searching || view.kind !== 'browse' ? listOf(view) : [];
  const listTitle = searching
    ? `${list.length} résultat${list.length > 1 ? 's' : ''}`
    : view.kind === 'muscle'
      ? MUSCLE_LABEL[view.muscle]
      : 'Toute la bibliothèque';

  const search = (
    <Glass radius={radius.lg} contentStyle={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, height: 50, overflow: 'hidden' }}>
      <Ionicons name="search" size={18} color={t.textMuted} />
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Rechercher un exercice"
        placeholderTextColor={t.textMuted}
        selectionColor={t.accent}
        autoFocus={autoFocus}
        autoCorrect={false}
        returnKeyType="search"
        style={{ flex: 1, minWidth: 0, color: t.text, fontFamily: family.medium, fontSize: 15, height: '100%', outlineWidth: 0, outlineColor: 'transparent' }}
      />
      {query !== '' && (
        <Tap onPress={() => setQuery('')} scaleTo={0.85} highlightRadius={12} accessibilityLabel="Effacer la recherche" style={{ padding: 4, borderRadius: 12 }}>
          <Ionicons name="close-circle" size={18} color={t.textMuted} />
        </Tap>
      )}
    </Glass>
  );

  if (!searching && view.kind === 'browse') {
    const groups = templates
      .map((tp) => ({ ...tp, list: tp.ids.flatMap((id) => byId.get(id) ?? []) }))
      .filter((g) => g.list.length > 0);
    return (
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: dockInset + space.xl }}>
        <View style={[column, { paddingHorizontal: gutter, gap: space.md }]}>
          {header}
          {search}
          {groups.length > 0 && (
            <Section title="Mes séances" first>
              {groups.map((g) => (
                <TemplateGroup key={g.id} name={g.name} list={g.list} onPress={onPress} lastLabel={lastLabel} />
              ))}
            </Section>
          )}
          <Section title="Par muscle" first={groups.length === 0}>
            <MuscleGrid exercises={exercises} onPick={(muscle) => setView({ kind: 'muscle', muscle })} />
          </Section>
          <Tap
            onPress={() => setView({ kind: 'all' })}
            scaleTo={0.98}
            highlightRadius={radius.md}
            accessibilityRole="button"
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, minHeight: 52, marginTop: space.md }}>
            <Ionicons name="library-outline" size={18} color={t.accent} />
            <Text variant="bodyStrong" tone="accent">
              Toute la bibliothèque ({exercises.length})
            </Text>
          </Tap>
        </View>
      </ScrollView>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={[column, { paddingHorizontal: gutter, gap: space.md, paddingBottom: space.sm }]}>
        {header}
        {search}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
          {!searching && (
            <IconButton icon="chevron-back" label="Retour aux catégories" size={20} onPress={() => (setView({ kind: 'browse' }), setEquipment(null))} />
          )}
          <Text variant="title" style={{ flex: 1 }} numberOfLines={1}>
            {listTitle}
          </Text>
          {!searching && (
            <Text variant="caption" tone="muted">
              {list.length}
            </Text>
          )}
        </View>
        {!searching && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} style={{ flexGrow: 0 }}>
            <Chip label="Tout équipement" small selected={equipment === null} onPress={() => setEquipment(null)} />
            {EQUIPMENT_FILTERS.map((eq) => (
              <Chip key={eq} label={EQUIPMENT_LABEL[eq]} small selected={equipment === eq} onPress={() => setEquipment(equipment === eq ? null : eq)} />
            ))}
          </ScrollView>
        )}
      </View>
      <View style={[column, { flex: 1 }]}>
        <FlashList
          data={list}
          keyExtractor={(e) => e.id}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={<EmptyState icon="search" title="Aucun exercice" body="Change la recherche ou le filtre, ou crée l’exercice." />}
          renderItem={({ item, index }) => (
            <View
              style={{
                backgroundColor: t.glass.pane.fill,
                borderColor: t.glass.pane.rim,
                borderLeftWidth: StyleSheet.hairlineWidth,
                borderRightWidth: StyleSheet.hairlineWidth,
                borderTopWidth: index === 0 ? StyleSheet.hairlineWidth : 0,
                borderBottomWidth: index === list.length - 1 ? StyleSheet.hairlineWidth : 0,
                borderTopLeftRadius: index === 0 ? radius.lg : 0,
                borderTopRightRadius: index === 0 ? radius.lg : 0,
                borderBottomLeftRadius: index === list.length - 1 ? radius.lg : 0,
                borderBottomRightRadius: index === list.length - 1 ? radius.lg : 0,
              }}>
              <ExerciseRow e={item} first={index === 0} last={index === list.length - 1} onPress={() => onPress(item)} since={lastLabel(item)} />
            </View>
          )}
          contentContainerStyle={{ paddingHorizontal: gutter, paddingTop: space.xs, paddingBottom: dockInset + space.xl }}
        />
      </View>
    </View>
  );
}
