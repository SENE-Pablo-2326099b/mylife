import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { EQUIPMENTS, MUSCLES, type Exercise, type Muscle } from '@/domain/types';
import { formatWeight } from '@/domain/math';
import { createExercise, getExercise, setExerciseArchived, updateExercise, type ExerciseInput } from '@/db/repos/exercises';
import { useSettings } from '@/state/settingsStore';
import { showToast } from '@/state/toastStore';
import { Button, Chip, Field, Segmented, Stepper, Text, Toggle } from '@/ui/components/primitives';
import { goBack, Screen } from '@/ui/components/Screen';
import { CATEGORY_LABEL, EQUIPMENT_LABEL, LOAD_TYPE_LABEL, MUSCLE_LABEL, PROGRESSION_LABEL } from '@/ui/labels';
import { space, useTheme } from '@/ui/theme';

function blank(defaultBackoff: number): ExerciseInput {
  return {
    name: '',
    primaryMuscles: [],
    secondaryMuscles: [],
    equipment: 'barbell',
    unilateral: false,
    loadType: 'external',
    category: 'compound',
    progressionType: 'double_progression',
    backoffPercent: defaultBackoff,
    repRangeMin: 8,
    repRangeMax: 12,
    weightIncrement: null,
    isCustom: true,
    notes: '',
  };
}

function toInput(e: Exercise): ExerciseInput {
  const { id: _id, archived: _archived, ...input } = e;
  return input;
}

function MuscleChips({ value, onChange, exclude }: { value: Muscle[]; onChange: (m: Muscle[]) => void; exclude: Muscle[] }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {MUSCLES.filter((m) => !exclude.includes(m)).map((m) => (
        <Chip
          key={m}
          label={MUSCLE_LABEL[m]}
          small
          selected={value.includes(m)}
          onPress={() => onChange(value.includes(m) ? value.filter((x) => x !== m) : [...value, m])}
        />
      ))}
    </View>
  );
}

export default function ExerciseEdit() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const settings = useSettings((s) => s.settings);
  const existing = id === undefined ? null : getExercise(id);
  const [form, setForm] = useState<ExerciseInput>(() => (existing === null ? blank(settings.defaultBackoffPercent) : toInput(existing)));
  const set = <K extends keyof ExerciseInput>(key: K, value: ExerciseInput[K]) => setForm((f) => ({ ...f, [key]: value }));
  const valid = form.name.trim() !== '' && form.primaryMuscles.length > 0 && form.repRangeMin <= form.repRangeMax;

  const save = () => {
    if (!valid) return;
    if (existing === null) createExercise(form);
    else updateExercise(existing.id, form);
    goBack();
  };

  return (
    <Screen
      stack
      modal
      title={existing === null ? 'Nouvel exercice' : `Modifier ${existing.name}`}
      mood="library"
      maxWidth={720}
      contentStyle={{ gap: space.lg }}
      footer={<Button label="Enregistrer" size="lg" onPress={save} disabled={!valid} />}>
      <Field label="Nom" value={form.name} onChangeText={(v) => set('name', v)} placeholder="ex. Traction lestée" autoFocus={existing === null} />

      <View style={{ gap: space.sm }}>
        <Text variant="label" tone="secondary">
          Progression
        </Text>
        <Segmented
          options={[
            { value: 'top_set_backoff', label: PROGRESSION_LABEL.top_set_backoff },
            { value: 'double_progression', label: PROGRESSION_LABEL.double_progression },
          ]}
          value={form.progressionType}
          onChange={(v) => setForm((f) => ({ ...f, progressionType: v, category: v === 'top_set_backoff' ? 'main' : f.category }))}
        />
        <Text variant="small" tone="muted">
          {form.progressionType === 'top_set_backoff'
            ? 'Mouvement de force : top set (1-5 reps) puis backoffs (3-6 reps), charges en % du 1RM de référence, réglées dans le cycle (semaine par semaine).'
            : 'Accessoire : monte la charge quand toutes les séries atteignent le haut de la fourchette.'}
        </Text>
      </View>

      {form.progressionType === 'double_progression' && (
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <View style={{ flex: 1 }}>
            <Stepper label="Reps min" value={form.repRangeMin} min={1} max={50} onChange={(v) => set('repRangeMin', v)} />
          </View>
          <View style={{ flex: 1 }}>
            <Stepper label="Reps max" value={form.repRangeMax} min={1} max={50} onChange={(v) => set('repRangeMax', v)} />
          </View>
        </View>
      )}

      {form.progressionType === 'top_set_backoff' && (
        <Stepper
          label="Backoff sans 1RM connu (% du top set)"
          value={form.backoffPercent}
          step={0.05}
          min={0.5}
          max={0.95}
          format={(v) => `${Math.round(v * 100)} %`}
          onChange={(v) => set('backoffPercent', v)}
        />
      )}

      <View style={{ gap: space.sm }}>
        <Text variant="label" tone="secondary">
          Muscles principaux
        </Text>
        <MuscleChips value={form.primaryMuscles} onChange={(m) => set('primaryMuscles', m)} exclude={[]} />
      </View>
      <View style={{ gap: space.sm }}>
        <Text variant="label" tone="secondary">
          Muscles secondaires (comptent ½ série)
        </Text>
        <MuscleChips value={form.secondaryMuscles} onChange={(m) => set('secondaryMuscles', m)} exclude={form.primaryMuscles} />
      </View>

      <View style={{ gap: space.sm }}>
        <Text variant="label" tone="secondary">
          Équipement
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {EQUIPMENTS.map((eq) => (
            <Chip key={eq} label={EQUIPMENT_LABEL[eq]} small tone={t.info} selected={form.equipment === eq} onPress={() => set('equipment', eq)} />
          ))}
        </View>
      </View>

      <View style={{ gap: space.sm }}>
        <Text variant="label" tone="secondary">
          Catégorie (plancher du repos)
        </Text>
        <Segmented
          options={[
            { value: 'main', label: CATEGORY_LABEL.main },
            { value: 'compound', label: 'Poly.' },
            { value: 'isolation', label: CATEGORY_LABEL.isolation },
          ]}
          value={form.category}
          onChange={(v) => set('category', v)}
        />
      </View>

      <View style={{ gap: space.sm }}>
        <Text variant="label" tone="secondary">
          Charge
        </Text>
        <Segmented
          options={[
            { value: 'external', label: LOAD_TYPE_LABEL.external },
            { value: 'bodyweight', label: 'Lest + poids du corps' },
          ]}
          value={form.loadType}
          onChange={(v) => set('loadType', v)}
        />
        {form.loadType === 'bodyweight' && (
          <Text variant="small" tone="muted">
            Tu saisis le lest ajouté ; e1RM et backoffs sont calculés sur la masse totale (poids de corps du suivi corporel).
          </Text>
        )}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="bodyStrong">Unilatéral</Text>
        <Toggle value={form.unilateral} onValueChange={(v) => set('unilateral', v)} label="Unilatéral" />
      </View>

      <Stepper
        label="Incrément de charge"
        value={form.weightIncrement ?? 0}
        step={0.25}
        min={0}
        max={20}
        format={(v) => (v === 0 ? `Défaut (${formatWeight(settings.increment)} kg)` : `${formatWeight(v)} kg`)}
        onChange={(v) => set('weightIncrement', v === 0 ? null : v)}
      />

      <Field label="Notes" value={form.notes} onChangeText={(v) => set('notes', v)} multiline placeholder="Consignes techniques, réglages…" />

      {existing !== null && (
        <Button
          label={existing.archived ? 'Restaurer l’exercice' : 'Archiver l’exercice'}
          variant={existing.archived ? 'secondary' : 'danger'}
          size="sm"
          style={{ alignSelf: 'center' }}
          icon="archive-outline"
          onPress={() => {
            setExerciseArchived(existing.id, !existing.archived);
            const was = existing.archived;
            showToast({ message: was ? 'Exercice restauré' : 'Exercice archivé — l’historique est conservé', actionLabel: 'Annuler', onAction: () => setExerciseArchived(existing.id, was) });
            goBack();
          }}
        />
      )}
    </Screen>
  );
}
