import { router } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";

import {
  addDays,
  diffDays,
  formatLongDate,
  formatShortDate,
  startOfMonth,
  weekday,
  weekdayShort,
} from "@/domain/dates";
import {
  mesocycleEndOffsetDays,
  phaseFor,
  totalWeeks,
} from "@/domain/mesocycle";
import { listMesocycles } from "@/db/repos/cycles";
import { syncCloud } from "@/services/cloud";
import {
  addPlanned,
  deletePlanned,
  listPlanned,
  movePlanned,
} from "@/db/repos/planning";
import {
  addPatternEntry,
  createTemplate,
  getWeekPattern,
  listTemplates,
  removePatternEntry,
} from "@/db/repos/templates";
import { listWorkouts } from "@/db/repos/workouts";
import { applyPatternFrom } from "@/services/planningService";
import { beginWorkout, logPastWorkout } from "@/services/startFlow";
import { templatePreview } from "@/services/workoutService";
import { showToast } from "@/state/toastStore";
import { MonthGrid, type DayMarks } from "@/ui/components/MonthGrid";
import {
  Button,
  Card,
  Chip,
  Group,
  Icon,
  IconButton,
  Row,
  SectionTitle,
  Segmented,
  Text,
} from "@/ui/components/primitives";
import { Screen } from "@/ui/components/Screen";
import { ActionList, Sheet } from "@/ui/components/Sheet";
import { Columns } from "@/ui/components/layout";
import { useBreakpoint } from "@/ui/responsive";
import { type Palette, radius, space, useTheme } from "@/ui/theme";
import type { Mesocycle } from "@/domain/types";
import { mesoKindInfo } from "@/domain/mesoTypes";
import { BlockTimeline } from "@/features/planning/BlockTimeline";
import { splitTemplateName } from "@/ui/labels";
import { blockColors } from "@/ui/themes";
import { useLive } from "@/ui/useLive";
import { useToday } from "@/ui/useToday";

type Tab = "calendar" | "program";

export default function PlanningScreen() {
  const [tab, setTab] = useState<Tab>("calendar");
  return (
    <Screen title="Planning" subtitle="Cycles & semaines" mood="planning" onRefresh={() => syncCloud()}>
      <Segmented
        options={[
          { value: "calendar", label: "Calendrier" },
          { value: "program", label: "Programme" },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "calendar" ? <CalendarTab /> : <ProgramTab />}
    </Screen>
  );
}

// ---------------------------------------------------------------- calendar

function TemplateChooser({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (id: string, name: string) => void;
}) {
  const templates = useLive(() => listTemplates(), []);
  return (
    <Sheet visible={visible} onClose={onClose} title="Choisir une séance type">
      {templates.length === 0 && (
        <Text tone="secondary" style={{ padding: space.lg }}>
          Crée d’abord une séance type dans l’onglet Programme.
        </Text>
      )}
      {templates.map((tp) => (
        <Row
          key={tp.id}
          title={tp.name}
          icon="barbell-outline"
          onPress={() => {
            onClose();
            onPick(tp.id, tp.name);
          }}
          style={{ backgroundColor: "transparent" }}
        />
      ))}
    </Sheet>
  );
}

/**
 * Colour of each block / cycle on the calendar: its own colour, in order, from a set kept apart
 * from the theme's accent (blockColors), so consecutive cycles never look alike.
 */
function cycleColors(mesos: readonly Mesocycle[], t: Palette): Map<string, { color: string; light: boolean }> {
  const hues = blockColors(t);
  const out = new Map<string, { color: string; light: boolean }>();
  [...mesos]
    .sort((a, b) => (a.startDate < b.startDate ? -1 : 1))
    .forEach((m, i) => out.set(m.id, { color: hues[i % hues.length] ?? t.info, light: false }));
  return out;
}

interface PlannedRef {
  id: string;
  title: string;
  date: string;
  templateId: string | null;
}

/** A planned session: what it holds (same preview as Today), then start / move / skip. */
function PlannedSheet({
  planned,
  onClose,
  onMove,
  onSkip,
}: {
  planned: PlannedRef | null;
  onClose: () => void;
  onMove: (p: PlannedRef) => void;
  onSkip: (p: PlannedRef) => void;
}) {
  const templateId = planned?.templateId ?? null;
  const date = planned?.date ?? "";
  const lines = useLive(
    () => (templateId === null ? [] : templatePreview(templateId, date)),
    [templateId, date],
  );
  return (
    <Sheet
      visible={planned !== null}
      onClose={onClose}
      title={planned === null ? undefined : `${planned.title} · ${formatShortDate(planned.date)}`}
    >
      {lines.length > 0 && (
        <View style={{ paddingHorizontal: space.lg, paddingBottom: space.md }}>
          {lines.map((l, i) => (
            <View
              key={`${l.exerciseId}-${i}`}
              style={{ flexDirection: "row", gap: space.md, paddingVertical: 5 }}
            >
              <Text
                variant={l.main ? "bodyStrong" : "body"}
                tone={l.main ? "default" : "secondary"}
                style={{ flex: 1 }}
                numberOfLines={1}
              >
                {l.name}
              </Text>
              <Text variant="small" tone="muted" numeric numberOfLines={1}>
                {l.label.replace(/^Deload · /, "")}
              </Text>
            </View>
          ))}
        </View>
      )}
      {planned !== null && (
        <ActionList
          onClose={onClose}
          actions={[
            {
              label: "Démarrer maintenant",
              icon: "play",
              onPress: () => beginWorkout({ plannedId: planned.id }),
            },
            {
              label: "Déplacer à un autre jour",
              icon: "move-outline",
              onPress: () => onMove(planned),
            },
            {
              label: "Modifier la séance type",
              icon: "create-outline",
              hidden: planned.templateId === null,
              onPress: () => router.push(`/template/${planned.templateId}`),
            },
            {
              label: "Sauter cette séance",
              icon: "close-circle-outline",
              destructive: true,
              onPress: () => onSkip(planned),
            },
          ]}
        />
      )}
    </Sheet>
  );
}

function CalendarTab() {
  const t = useTheme();
  const wide = useBreakpoint() === "expanded";
  const now = useToday();
  const [month, setMonth] = useState(() => startOfMonth(now));
  const [selected, setSelected] = useState(now);
  const [moving, setMoving] = useState<{ id: string; title: string } | null>(
    null,
  );
  const [choosing, setChoosing] = useState(false);
  const [menuFor, setMenuFor] = useState<{
    id: string;
    title: string;
    date: string;
    templateId: string | null;
  } | null>(null);

  // The cycle colours follow the theme (useLive only takes primitive deps).
  const kindColors = `${t.accent}${t.scheme}`;
  const data = useLive(() => {
    const from = addDays(month, -7);
    const to = addDays(month, 42);
    const planned = listPlanned(from, to);
    const workouts = listWorkouts(from, to);
    const mesos = listMesocycles();
    const marks = new Map<string, DayMarks>();
    const mark = (date: string) => {
      const m = marks.get(date) ?? { planned: 0, done: 0 };
      marks.set(date, m);
      return m;
    };
    for (const p of planned)
      if (p.workoutId === null) mark(p.date).planned += 1;
    for (const w of workouts) mark(w.date).done += 1;
    // Each block / cycle as a band of its type's colour; deload weeks lighter.
    const shown: typeof mesos = [];
    const colors = cycleColors(mesos, t);
    for (const meso of mesos) {
      const days = totalWeeks(meso) * 7;
      const { color, light } = colors.get(meso.id) ?? { color: t.accent, light: false };
      let visible = false;
      for (let d = 0; d < days; d++) {
        const date = addDays(meso.startDate, d);
        if (diffDays(from, date) < 0 || diffDays(date, to) < 0) continue;
        const m = mark(date);
        m.cycle = { color, light, start: d === 0 || weekday(date) === 0, end: d === days - 1 || weekday(date) === 6 };
        if (d >= meso.workWeeks * 7) m.deload = true;
        if (date.slice(0, 7) === month.slice(0, 7)) visible = true;
      }
      if (visible) shown.push(meso);
    }
    return { planned, workouts, marks, mesos, shown, colors };
  }, [month, kindColors]);

  const dayPlanned = data.planned.filter(
    (p) => p.date === selected && p.workoutId === null,
  );
  const dayWorkouts = data.workouts.filter((w) => w.date === selected);
  const meso = data.mesos
    .filter((m) => diffDays(m.startDate, selected) >= 0)
    .pop();
  const phase = meso === undefined ? null : phaseFor(meso, selected);
  const isPast = diffDays(selected, now) > 0;
  const isToday = selected === now;

  const onSelect = (date: string) => {
    if (moving !== null) {
      movePlanned(moving.id, date);
      showToast({
        message: `${moving.title} déplacée au ${formatShortDate(date)}`,
      });
      setMoving(null);
    }
    setSelected(date);
  };

  return (
    <View style={{ marginTop: space.lg }}>
      {moving !== null && (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space.sm,
            padding: space.md,
            borderRadius: radius.md,
            backgroundColor: t.accentSoft,
            marginBottom: space.md,
          }}
        >
          <Icon name="move-outline" color={t.accent} />
          <Text style={{ flex: 1 }}>
            Touche le nouveau jour pour « {moving.title} »
          </Text>
          <Button
            label="Annuler"
            variant="ghost"
            size="sm"
            onPress={() => setMoving(null)}
          />
        </View>
      )}
      <Columns weights={[1.35, 1]}>
        <Card level="raised">
          <MonthGrid
            month={month}
            onMonthChange={setMonth}
            selected={selected}
            onSelect={onSelect}
            marks={data.marks}
            today={now}
          />
          {data.shown.length > 0 && (
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                columnGap: space.md,
                rowGap: 2,
                marginTop: space.md,
                paddingHorizontal: 2,
              }}
            >
              {data.shown.map((m) => (
                <Pressable
                  key={m.id}
                  onPress={() => router.push(`/mesocycle/${m.id}`)}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={`${m.name}, ${mesoKindInfo(m.kind).label}`}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    minHeight: 32,
                  }}
                >
                  <View
                    style={{
                      width: 14,
                      height: 4,
                      borderRadius: 2,
                      backgroundColor: data.colors.get(m.id)?.color ?? t.accent,
                      opacity: data.colors.get(m.id)?.light === true ? 0.55 : 1,
                    }}
                  />
                  <Text variant="caption" tone="secondary" numberOfLines={1}>
                    {m.name.replace(/ — .*/, "")} · {mesoKindInfo(m.kind).label}
                  </Text>
                </Pressable>
              ))}
              {data.shown.some((m) => m.deloadWeeks > 0) && (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    minHeight: 32,
                  }}
                >
                  <View
                    style={{
                      width: 14,
                      height: 4,
                      borderRadius: 2,
                      backgroundColor: t.textSecondary,
                      opacity: 0.35,
                    }}
                  />
                  <Text variant="caption" tone="muted">
                    deload
                  </Text>
                </View>
              )}
            </View>
          )}
        </Card>
        <View>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              marginTop: wide ? space.sm : space.xl,
              marginBottom: space.md,
              gap: space.sm,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text variant="title">{formatLongDate(selected)}</Text>
              {phase !== null && (phase.kind === "work" || phase.kind === "deload") && (
                <Text variant="small" tone="secondary">
                  {meso?.name ?? ""} · {phase.kind === "deload" ? "deload" : `semaine ${phase.week}`}
                </Text>
              )}
            </View>
          </View>

          <View style={{ gap: space.sm }}>
            {dayWorkouts.map((w) => (
              <Card
                key={w.id}
                onPress={() =>
                  router.push(w.status === "active" ? "/" : `/workout/${w.id}`)
                }
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.md,
                }}
              >
                <Icon
                  name={
                    w.status === "active" ? "play-circle" : "checkmark-circle"
                  }
                  color={t.accent}
                  size={24}
                />
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong">{w.name}</Text>
                  <Text variant="small" tone="secondary">
                    {w.status === "active" ? "En cours" : "Faite"}
                  </Text>
                </View>
                <Icon name="chevron-forward" color={t.textMuted} size={18} />
              </Card>
            ))}
            {dayPlanned.map((p) => (
              <Card
                key={p.id}
                onPress={() => setMenuFor({ id: p.id, title: p.title, date: p.date, templateId: p.templateId })}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.md,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong">{splitTemplateName(p.title).focus}</Text>
                  <Text variant="small" tone="secondary">
                    Prévue · toucher pour les détails
                  </Text>
                </View>
                {isToday ? (
                  <IconButton
                    icon="play"
                    label={`Démarrer ${p.title}`}
                    glass
                    color={t.accent}
                    onPress={() => beginWorkout({ plannedId: p.id })}
                  />
                ) : (
                  <Icon name="chevron-forward" color={t.textMuted} size={18} />
                )}
              </Card>
            ))}
            {dayWorkouts.length === 0 && dayPlanned.length === 0 && (
              <Text tone="muted" style={{ paddingVertical: space.sm }}>
                Repos.
              </Text>
            )}
            <View
              style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}
            >
              {!isPast && (
                <Button
                  label="Planifier"
                  icon="add"
                  variant="secondary"
                  size="sm"
                  onPress={() => setChoosing(true)}
                />
              )}
              {isToday && (
                <Button
                  label="Séance libre"
                  icon="flash-outline"
                  variant="secondary"
                  size="sm"
                  onPress={() => beginWorkout({})}
                />
              )}
              {isPast && (
                <Button
                  label="Saisir une séance passée"
                  icon="create-outline"
                  variant="secondary"
                  size="sm"
                  onPress={() => logPastWorkout(selected)}
                />
              )}
            </View>
          </View>
        </View>
      </Columns>

      <TemplateChooser
        visible={choosing}
        onClose={() => setChoosing(false)}
        onPick={(id, name) => {
          addPlanned(selected, id, name);
        }}
      />
      <PlannedSheet
        planned={menuFor}
        onClose={() => setMenuFor(null)}
        onMove={(m) => setMoving({ id: m.id, title: m.title })}
        onSkip={(snapshot) => {
          deletePlanned(snapshot.id);
          showToast({
            message: "Séance retirée du planning",
            actionLabel: "Annuler",
            onAction: () =>
              snapshot.templateId !== null &&
              addPlanned(snapshot.date, snapshot.templateId, snapshot.title),
          });
        }}
      />
    </View>
  );
}

// ---------------------------------------------------------------- program

function ProgramTab() {
  const t = useTheme();
  const now = useToday();
  const [addingDay, setAddingDay] = useState<number | null>(null);
  const data = useLive(() => {
    const mesos = listMesocycles();
    return {
      mesos: [...mesos].reverse(),
      templates: listTemplates(),
      pattern: getWeekPattern(),
    };
  }, []);
  const names = new Map(data.templates.map((tp) => [tp.id, tp.name]));

  const newTemplate = () => {
    const id = createTemplate(
      `Séance ${String.fromCharCode(65 + (data.templates.length % 26))}`,
    );
    router.push(`/template/${id}`);
  };

  return (
    <View>
      <Columns weights={[1, 1]}>
        <View>
          <SectionTitle
            title="Mésocycles"
            action={
              <Button
                label="Nouveau"
                icon="add"
                variant="ghost"
                size="sm"
                onPress={() => router.push("/mesocycle/new")}
              />
            }
          />
          {data.mesos.length === 0 ? (
            <Card>
              <Text tone="secondary">
                Un mésocycle = X semaines de travail + 1 deload. Il pilote la
                rampe des top sets et les deloads. Sans cycle, l’app fonctionne
                aussi.
              </Text>
            </Card>
          ) : (
            <View style={{ gap: space.md }}>
            <BlockTimeline mesos={data.mesos} today={now} />
            <Group>
              {data.mesos.map((m) => {
                const phase = phaseFor(m, now);
                const end = addDays(m.startDate, mesocycleEndOffsetDays(m));
                const status =
                  phase.kind === "work"
                    ? `En cours · S${phase.week}/${m.workWeeks}`
                    : phase.kind === "deload"
                      ? "En cours · deload"
                      : phase.kind === "before"
                        ? "À venir"
                        : "Terminé";
                return (
                  <Row
                    key={m.id}
                    title={m.name}
                    subtitle={`${mesoKindInfo(m.kind).label} · ${formatShortDate(m.startDate)} → ${formatShortDate(end)}${phase.kind === "work" || phase.kind === "deload" ? ` · ${status}` : ""}`}
                    icon={
                      phase.kind === "work" || phase.kind === "deload"
                        ? "radio-button-on"
                        : "radio-button-off"
                    }
                    onPress={() => router.push(`/mesocycle/${m.id}`)}
                  />
                );
              })}
            </Group>
            </View>
          )}

          <SectionTitle
            title="Séances types"
            action={
              <Button
                label="Nouvelle"
                icon="add"
                variant="ghost"
                size="sm"
                onPress={newTemplate}
              />
            }
          />
          <Group>
            {data.templates.map((tp) => (
              <Row
                key={tp.id}
                title={tp.name}
                icon="barbell-outline"
                onPress={() => router.push(`/template/${tp.id}`)}
              />
            ))}
            {data.templates.length === 0 && (
              <Row
                title="Créer ta première séance type"
                icon="add-circle-outline"
                onPress={newTemplate}
              />
            )}
          </Group>
        </View>
        <View>
          <SectionTitle title="Semaine type" />
          <Text
            variant="small"
            tone="secondary"
            style={{ marginBottom: space.sm }}
          >
            Toucher une séance la retire ; + en ajoute une.
          </Text>
          <Card style={{ gap: 2, paddingVertical: space.sm }}>
            {Array.from({ length: 7 }, (_, day) => {
              const entries = data.pattern.filter((p) => p.weekday === day);
              return (
                <View
                  key={day}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    minHeight: 44,
                    gap: space.sm,
                  }}
                >
                  <Text
                    variant="bodyStrong"
                    tone="secondary"
                    style={{ width: 40 }}
                  >
                    {weekdayShort(day)}
                  </Text>
                  <View
                    style={{
                      flex: 1,
                      flexDirection: "row",
                      flexWrap: "wrap",
                      gap: 6,
                    }}
                  >
                    {entries.map((e) => (
                      <Chip
                        key={e.id}
                        label={`${splitTemplateName(names.get(e.templateId) ?? "?").focus}  ✕`}
                        small
                        selected
                        onPress={() => {
                          removePatternEntry(e.id);
                          showToast({
                            message: "Retirée de la semaine type",
                            actionLabel: "Annuler",
                            onAction: () => addPatternEntry(day, e.templateId),
                          });
                        }}
                      />
                    ))}
                    {entries.length === 0 && (
                      <Text variant="small" tone="muted">
                        Repos
                      </Text>
                    )}
                  </View>
                  <Pressable
                    onPress={() => setAddingDay(day)}
                    hitSlop={8}
                    accessibilityLabel={`Ajouter une séance le ${weekdayShort(day)}`}
                  >
                    <Icon name="add-circle-outline" color={t.textSecondary} />
                  </Pressable>
                </View>
              );
            })}
          </Card>
          <Button
            label="Appliquer au calendrier"
            icon="calendar-outline"
            variant="secondary"
            style={{ marginTop: space.md }}
            disabled={data.pattern.length === 0}
            onPress={() => {
              const n = applyPatternFrom(now);
              showToast({
                message:
                  n === 0
                    ? "Rien à ajouter : les jours sont déjà planifiés"
                    : `${n} séances ajoutées au calendrier`,
              });
            }}
          />
        </View>
      </Columns>

      <TemplateChooser
        visible={addingDay !== null}
        onClose={() => setAddingDay(null)}
        onPick={(id) => addingDay !== null && addPatternEntry(addingDay, id)}
      />
    </View>
  );
}
