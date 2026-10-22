import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useWindowDimensions, View } from 'react-native';

import { addDays, formatLongDate, today } from '@/domain/dates';
import { formatPercent } from '@/domain/math';
import { BACKOFF_REPS, describeStrengthWeek, resizeScheme, TOP_REPS } from '@/domain/mesocycle';
import { MESO_KINDS, mesoKindInfo, schemeForKind, type MesoKind } from '@/domain/mesoTypes';
import type { Mesocycle, StrengthWeek } from '@/domain/types';
import { exercisesWithOverrides } from '@/db/repos/cyclePlans';
import { listExercises } from '@/db/repos/exercises';
import { templateSlotsForExercise } from '@/db/repos/templates';
import { deleteMesocycleUndoable, draftNextMesocycle, getMesocycle, listMacrocycles, saveMacrocycle, saveMesocycle } from '@/db/repos/cycles';
import { showToast } from '@/state/toastStore';
import { Button, Card, Chip, Disclosure, Field, Group, IconButton, Row, SectionTitle, Segmented, Stepper, Tap, Text } from '@/ui/components/primitives';
import { goBack, NotFoundScreen, Screen } from '@/ui/components/Screen';
import { MESO_KIND_COLOR } from '@/ui/labels';
import { radius, space, useTheme } from '@/ui/theme';
import { useLive } from '@/ui/useLive';

type Draft = Omit<Mesocycle, 'id'> & { id?: string };

const pct = formatPercent;

/** Block types as compact choices; the selected one says what it is for. */
function MesoKindPicker({ value, onChange }: { value: MesoKind; onChange: (k: MesoKind) => void }) {
  const t = useTheme();
  const current = mesoKindInfo(value);
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {MESO_KINDS.map((k) => {
          const selected = k.kind === value;
          const color = MESO_KIND_COLOR[k.kind](t);
          return (
            <Tap
              key={k.kind}
              onPress={() => onChange(k.kind)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`${k.label} : ${k.goal}`}
              scaleTo={0.96}
              highlightRadius={radius.pill}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                minHeight: 44,
                paddingHorizontal: space.md,
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: selected ? color : t.glass.pane.rim,
                backgroundColor: selected ? `${color}1F` : t.glass.pane.fill,
              }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
              <Text variant="bodyStrong" style={{ color: selected ? t.text : t.textSecondary }}>
                {k.label}
              </Text>
            </Tap>
          );
        })}
      </View>
      <Text variant="small" tone="secondary">
        {current.goal} Volume {current.volume} · {current.intensity}.
      </Text>
    </View>
  );
}

/** One week of the main lifts: set counts, reps (top 1-5, backoffs 3-6) and % of the reference 1RM. */
function WeekEditor({ title, week, onChange }: { title: string; week: StrengthWeek; onChange: (w: StrengthWeek) => void }) {
  const [open, setOpen] = useState(false);
  const set = (patch: Partial<StrengthWeek>) => onChange({ ...week, ...patch });
  return (
    <Card style={{ paddingVertical: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Text variant="bodyStrong">{title}</Text>
          <Text variant="small" tone="secondary">
            {describeStrengthWeek(week)}
          </Text>
        </View>
        <IconButton icon={open ? 'chevron-up' : 'create-outline'} label={`Modifier : ${title}`} onPress={() => setOpen(!open)} />
      </View>
      {open && (
        <View style={{ gap: space.md, marginTop: space.md }}>
          <Text variant="label" tone="secondary">
            Top set
          </Text>
          <View style={{ flexDirection: 'row', gap: space.md }}>
            <View style={{ flex: 1 }}>
              <Stepper label="Séries" value={week.topSets} min={0} max={5} onChange={(v) => set({ topSets: v })} />
            </View>
            <View style={{ flex: 1 }}>
              <Stepper
                label="Reps"
                value={week.topRepsMin}
                min={TOP_REPS.min}
                max={TOP_REPS.max}
                onChange={(v) => set({ topRepsMin: v, topRepsMax: v })}
              />
            </View>
          </View>
          <Stepper label="Charge (% du 1RM)" value={week.topPercent} step={0.025} snap min={0.4} max={1} format={pct} onChange={(v) => set({ topPercent: v })} />
          <Text variant="label" tone="secondary">
            Backoffs
          </Text>
          <View style={{ flexDirection: 'row', gap: space.md }}>
            <View style={{ flex: 1 }}>
              <Stepper label="Séries" value={week.backoffSets} min={0} max={8} onChange={(v) => set({ backoffSets: v })} />
            </View>
            <View style={{ flex: 1 }}>
              <Stepper label="Reps" value={week.backoffReps} min={BACKOFF_REPS.min} max={BACKOFF_REPS.max} onChange={(v) => set({ backoffReps: v })} />
            </View>
          </View>
          <Stepper
            label="Charge (% du 1RM)"
            value={week.backoffPercent}
            step={0.025}
            snap
            min={0.3}
            max={1}
            format={pct}
            onChange={(v) => set({ backoffPercent: v })}
          />
          <Text variant="caption" tone="muted">
            Backoffs {Math.round((1 - week.backoffPercent / week.topPercent) * 100)} % plus légers que le top set.
          </Text>
        </View>
      )}
    </Card>
  );
}

export default function MesocycleRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // Checked once on open: deleting the mesocycle from the editor navigates away by itself.
  const [missing] = useState(() => id !== 'new' && getMesocycle(id) === null);
  return missing ? <NotFoundScreen title="Mésocycle introuvable" /> : <MesocycleEditor />;
}

function MesocycleEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const narrow = useWindowDimensions().width < 360;
  const [draft, setDraft] = useState<Draft>(() => {
    const existing = isNew ? null : getMesocycle(id);
    return existing ?? draftNextMesocycle(today());
  });
  const macros = useLive(() => listMacrocycles(), []);
  const tweaked = useLive(() => (isNew ? new Set<string>() : exercisesWithOverrides(id)), [id, isNew]);
  // Lifts done as top set + backoff in the session templates (falls back to every top set exercise).
  const mainLifts = useLive(() => {
    const all = listExercises();
    const inProgram = all.filter(
      (e) =>
        tweaked.has(e.id) ||
        templateSlotsForExercise(e.id).some((te) => (te.progressionType ?? e.progressionType) === 'top_set_backoff'),
    );
    return inProgram.length > 0 ? inProgram : all.filter((e) => e.progressionType === 'top_set_backoff');
  }, [tweaked.size]);
  const [newMacro, setNewMacro] = useState('');
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const pickKind = (kind: MesoKind) => {
    const info = mesoKindInfo(kind);
    const scheme = schemeForKind(kind, info.weeks);
    if (scheme === null) return set({ kind });
    set({ kind, workWeeks: info.weeks, deloadWeeks: info.deloadWeeks, scheme });
    showToast({ message: `Structure « ${info.label} » appliquée : tout reste modifiable` });
  };
  const changeWeeks = (workWeeks: number) => {
    // An untouched preset is re-stretched to the new length; edited weeks are kept.
    const preset = schemeForKind(draft.kind, draft.workWeeks);
    const pristine = preset !== null && JSON.stringify(preset) === JSON.stringify(resizeScheme(draft.scheme, draft.workWeeks, draft.kind));
    set({ workWeeks, scheme: pristine ? (schemeForKind(draft.kind, workWeeks) ?? []) : resizeScheme(draft.scheme, workWeeks, draft.kind) });
  };

  const save = () => {
    saveMesocycle({ ...draft, id: isNew ? undefined : id, scheme: resizeScheme(draft.scheme, draft.workWeeks, draft.kind) });
    goBack();
  };

  return (
    <Screen
      stack
      title={isNew ? 'Nouveau mésocycle' : draft.name}
      mood="planning"
      maxWidth={760}
      footer={<Button label="Enregistrer" size="lg" onPress={save} disabled={draft.name.trim() === ''} />}>
      <View style={{ gap: space.lg }}>
        <Field label="Nom" value={draft.name} onChangeText={(name) => set({ name })} />

        <View style={{ gap: space.sm }}>
          <Text variant="label" tone="secondary">
            Type de bloc
          </Text>
          <MesoKindPicker value={draft.kind} onChange={pickKind} />
        </View>

        <View style={{ gap: space.xs }}>
          <Text variant="label" tone="secondary">
            Début
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
            {!narrow && <IconButton icon="play-back" label="Une semaine plus tôt" onPress={() => set({ startDate: addDays(draft.startDate, -7) })} />}
            <IconButton icon="chevron-back" label="Un jour plus tôt" onPress={() => set({ startDate: addDays(draft.startDate, -1) })} />
            <Text variant="bodyStrong" style={{ flex: 1, textAlign: 'center' }} numberOfLines={1}>
              {formatLongDate(draft.startDate)}
            </Text>
            <IconButton icon="chevron-forward" label="Un jour plus tard" onPress={() => set({ startDate: addDays(draft.startDate, 1) })} />
            {!narrow && <IconButton icon="play-forward" label="Une semaine plus tard" onPress={() => set({ startDate: addDays(draft.startDate, 7) })} />}
          </View>
          <View style={{ alignItems: 'flex-start' }}>
            <Chip label="Aujourd’hui" small onPress={() => set({ startDate: today() })} />
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: space.md }}>
          <View style={{ flex: 1 }}>
            <Stepper
              label="Semaines de travail"
              value={draft.workWeeks}
              min={1}
              max={12}
              onChange={changeWeeks}
            />
          </View>
          <View style={{ flex: 1, gap: space.xs }}>
            <Text variant="label" tone="secondary">
              Deload
            </Text>
            <Segmented
              options={[
                { value: '1', label: '1 sem.' },
                { value: '0', label: 'Aucun' },
              ]}
              value={draft.deloadWeeks > 0 ? '1' : '0'}
              onChange={(v) => set({ deloadWeeks: v === '1' ? 1 : 0 })}
            />
          </View>
        </View>
        <Text variant="caption" tone="muted">
          Modifiable à tout moment ; les séances déjà faites gardent leur semaine.
        </Text>
      </View>

      <SectionTitle title="Top set + backoff" />
      <View style={{ gap: space.sm }}>
        {resizeScheme(draft.scheme, draft.workWeeks, draft.kind).map((w, i) => (
          <WeekEditor
            key={i}
            title={`Semaine ${i + 1}`}
            week={w}
            onChange={(next) => {
              const scheme = resizeScheme(draft.scheme, draft.workWeeks, draft.kind);
              scheme[i] = next;
              set({ scheme });
            }}
          />
        ))}
      </View>
      <Text variant="caption" tone="muted" style={{ marginTop: space.sm }}>
        % du 1RM de référence. Ajustable aussi par exercice (plus bas) ou en pleine séance.
      </Text>

      {draft.deloadWeeks > 0 && (
        <>
          <SectionTitle title="Deload" />
          <View style={{ gap: space.md }}>
            <WeekEditor title="Lifts principaux" week={draft.deload.main} onChange={(main) => set({ deload: { ...draft.deload, main } })} />
            <Card style={{ gap: space.md }}>
              <Text variant="bodyStrong">Accessoires</Text>
              <View style={{ flexDirection: 'row', gap: space.md }}>
                <View style={{ flex: 1 }}>
                  <Stepper
                    label="Charge"
                    value={draft.deload.loadFactor}
                    step={0.05}
                    min={0.3}
                    max={1}
                    format={pct}
                    onChange={(loadFactor) => set({ deload: { ...draft.deload, loadFactor } })}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Stepper
                    label="Volume"
                    value={draft.deload.volumeFactor}
                    step={0.1}
                    min={0.3}
                    max={1}
                    format={pct}
                    onChange={(volumeFactor) => set({ deload: { ...draft.deload, volumeFactor } })}
                  />
                </View>
              </View>
              <Text variant="small" tone="muted">
                % de la charge de la dernière séance, et du nombre de séries.
              </Text>
            </Card>
          </View>
        </>
      )}

      {!isNew && (
        <>
          <SectionTitle title="Par exercice" />
          <Group>
            {mainLifts.map((e) => (
              <Row
                key={e.id}
                title={e.name}
                subtitle={tweaked.has(e.id) ? 'Ajusté' : 'Valeurs du cycle'}
                icon="barbell-outline"
                onPress={() => router.push({ pathname: '/cycle-plan', params: { meso: id, exercise: e.id } })}
              />
            ))}
          </Group>
        </>
      )}

      <Disclosure title="Macrocycle et notes" summary={draft.notes.trim() === '' ? 'optionnel' : 'notes'}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          <Chip label="Aucun macrocycle" small selected={draft.macrocycleId === null} onPress={() => set({ macrocycleId: null })} />
          {macros.map((m) => (
            <Chip key={m.id} label={m.name} small selected={draft.macrocycleId === m.id} onPress={() => set({ macrocycleId: m.id })} />
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm, alignItems: 'flex-end' }}>
          <View style={{ flex: 1 }}>
            <Field value={newMacro} onChangeText={setNewMacro} placeholder="Nouveau macrocycle" />
          </View>
          <Button
            label="Créer"
            variant="secondary"
            disabled={newMacro.trim() === ''}
            onPress={() => {
              set({ macrocycleId: saveMacrocycle(newMacro) });
              setNewMacro('');
            }}
          />
        </View>
        <View style={{ marginTop: space.lg }}>
          <Field label="Notes" value={draft.notes} onChangeText={(notes) => set({ notes })} multiline />
        </View>
      </Disclosure>

      {!isNew && (
        <Button
          label="Supprimer le mésocycle"
          variant="danger"
          size="sm"
          icon="trash-outline"
          style={{ marginTop: space.xl, alignSelf: 'center' }}
          onPress={() => {
            const undo = deleteMesocycleUndoable(id);
            showToast({ message: 'Mésocycle supprimé — les séances restent dans l’historique', actionLabel: 'Annuler', onAction: undo }, 6000);
            goBack();
          }}
        />
      )}
    </Screen>
  );
}
