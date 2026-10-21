import { useState } from 'react';
import { View } from 'react-native';

import { formatShortDate } from '@/domain/dates';
import { formatDecimal, formatWeight, plainWeight } from '@/domain/math';
import { MAX_RISE_PER_CYCLE, RELIABLE_MAX_REPS, type Calibration, type ManualSuggestion, type Reference } from '@/domain/reference';
import { saveOneRm, type OneRmMode } from '@/db/repos/oneRm';
import { referenceInfo, refreshActiveTargets } from '@/services/workoutService';
import { useWorkoutStore } from '@/state/workoutStore';
import { showToast } from '@/state/toastStore';
import { Badge, Button, Card, Field, Segmented, Text } from '@/ui/components/primitives';
import { space, useTheme } from '@/ui/theme';
import { useLive } from '@/ui/useLive';
import { useToday } from '@/ui/useToday';

const kg = (v: number) => formatWeight(Math.round(v * 10) / 10);
const signedPct = (v: number) => `${v >= 0 ? '+' : '−'}${formatWeight(Math.round(Math.abs(v) * 1000) / 10)} %`;
/** A typed / suggested 1RM, to the half kilo. */
const half = (v: number) => Math.round(v * 2) / 2;

/** Load as the user logs it: lest for weighted exercises ("+35"), bar weight otherwise. */
export function loggedLoad(total: number, bodyweight: number, lest: boolean): string {
  if (!lest) return kg(total);
  const added = total - bodyweight;
  return added === 0 ? 'PDC' : `${added > 0 ? '+' : ''}${kg(added)}`;
}

function basisText(r: Reference, lest: boolean): string {
  const b = r.basis;
  const set = `${loggedLoad(b.load, b.bodyweight, lest)} × ${b.reps}`;
  const date = formatShortDate(b.date);
  switch (b.kind) {
    case 'manual':
      return `Ton 1RM (saisi le ${date}) : les charges sont des % de ce 1RM${lest ? ', sur la masse totale (poids de corps de la séance + lest)' : ''}.`;
    case 'set':
      return r.status === 'provisional'
        ? `Basée sur ${set} (${date}) : plus de ${RELIABLE_MAX_REPS} reps, estimation peu fiable. Tes premiers top sets du cycle la recaleront.`
        : `Meilleure série ≤ ${RELIABLE_MAX_REPS} reps : ${set} (${date}), formule d’Epley.`;
    case 'plan':
      return `Recalée sur ta séance du ${date} (${set}), lue par rapport à ce qui était prévu.`;
    case 'test':
      return `Test du ${date} : ${set}.`;
    case 's4':
      return `Calibrée sur la S4 du ${date} (${set}).`;
  }
}

/** Where the history estimate comes from, in a few words. */
function estimateSource(r: Reference, lest: boolean): string {
  const b = r.basis;
  const set = `${loggedLoad(b.load, b.bodyweight, lest)} × ${b.reps}`;
  const what = b.kind === 's4' ? 'S4' : b.kind === 'test' ? 'test' : b.kind === 'plan' ? 'séance' : 'série';
  return `${what} ${set} du ${formatShortDate(b.date)}`;
}

function calibrationText(c: Calibration): string {
  const what = c.kind === 's4' ? 'S4' : 'Test';
  const measured = c.kind === 's4' && c.measured >= 0.999 ? 'réussie' : `mesuré ×${formatDecimal(c.measured, 2)}`;
  const applied = signedPct(c.after / c.before - 1);
  return `${what} · ${formatShortDate(c.date)} : ${measured} → ${applied}${c.capped ? ' (plafond)' : ''}`;
}

function suggestionText(s: ManualSuggestion, lest: boolean): string {
  const set = `${loggedLoad(s.load, s.bodyweight, lest)} × ${s.reps}`;
  if (s.kind === 'test') return `Test du ${formatShortDate(s.date)} (${set}) : il indique ${s.aboveCap ? 'plus que' : 'un autre'} 1RM.`;
  return s.measured >= 0.999
    ? `S4 réussie le ${formatShortDate(s.date)} (${set}) : +${formatWeight(MAX_RISE_PER_CYCLE * 100)} % pour le cycle suivant ?`
    : `S4 du ${formatShortDate(s.date)} en dessous du plan (${set}) : baisser ton 1RM ?`;
}

/** "57,5", "+57,5", "57.5" → 57.5 ; anything else → null. */
function parseLoad(text: string): number | null {
  const v = Number(text.trim().replace(/^\+/, '').replace(',', '.'));
  return text.trim() === '' || !Number.isFinite(v) ? null : v;
}

/**
 * The reference 1RM behind a main lift's loads. The user types their own 1RM (as logged: lest for
 * weighted lifts) and it drives the loads; the estimate from the history (Epley on sets ≤ 6 reps)
 * stays visible as a guide and can be chosen instead. In manual mode, an S4 or a test done since
 * suggests an update — never applied without the user.
 */
export function ReferenceCard({ exerciseId, lest }: { exerciseId: string; lest: boolean }) {
  const t = useTheme();
  const today = useToday();
  const info = useLive(() => referenceInfo(exerciseId, today), [exerciseId, today]);
  const { reference, estimate, typed, bodyweight: bw, suggestion } = info;
  const [draft, setDraft] = useState<string | null>(null);
  const manual = typed !== null && typed.mode === 'manual';
  const text = draft ?? (typed === null ? '' : formatWeight(typed.value));
  const parsed = parseLoad(text);
  const total = parsed === null ? null : parsed + bw;
  const valid = parsed !== null && total !== null && total > 0 && total < 1000;
  const dirty = parsed !== null && (typed === null || parsed !== typed.value || !manual);

  // A session in progress takes the new 1RM on the sets still to do.
  const resync = () => {
    for (const id of refreshActiveTargets(exerciseId)) {
      if (useWorkoutStore.getState().docs[id] !== undefined) useWorkoutStore.getState().load(id);
    }
  };
  const save = (value: number, message: string) => {
    saveOneRm({ exerciseId, value, mode: 'manual', setOn: today });
    resync();
    setDraft(null);
    showToast({ message });
  };
  const setMode = (mode: OneRmMode) => {
    if (typed === null) return;
    saveOneRm({ ...typed, mode });
    resync();
  };
  const unit = `${lest ? '+' : ''}${formatWeight(parsed ?? 0)} kg`;

  const provisional = !manual && reference?.status === 'provisional';
  return (
    <Card style={{ gap: space.sm }} tone={provisional ? 'warning' : undefined}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Text variant="label" tone="secondary" style={{ flex: 1 }}>
          1RM de référence
        </Text>
        {reference !== null && (
          <Badge
            label={manual ? 'Mon 1RM' : provisional ? 'Provisoire' : 'Estimé'}
            color={manual ? t.gold : provisional ? t.warning : t.info}
            icon={manual ? 'create' : provisional ? 'alert-circle' : 'analytics'}
          />
        )}
      </View>

      {reference === null ? (
        <Text variant="small" tone="secondary">
          Pas encore d’historique : saisis ton 1RM ci-dessous, ou ton premier top set ; les charges en découleront.
        </Text>
      ) : (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.sm, flexWrap: 'wrap' }}>
            <Text variant="title" numeric>
              {loggedLoad(reference.value, bw, lest)} kg
            </Text>
            {lest && (
              <Text variant="small" tone="secondary" numeric>
                {kg(reference.value)} kg au total · poids de corps {formatWeight(bw)} kg
              </Text>
            )}
          </View>
          <Text variant="small" tone="secondary">
            {basisText(reference, lest)}
          </Text>
        </>
      )}

      {typed !== null && (
        <Segmented<OneRmMode>
          options={[
            { value: 'manual', label: 'Mon 1RM' },
            { value: 'estimated', label: 'Estimation' },
          ]}
          value={typed.mode}
          onChange={setMode}
        />
      )}

      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.sm }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Field
            label={lest ? 'Ton 1RM (lest, kg)' : 'Ton 1RM (kg)'}
            value={text}
            onChangeText={setDraft}
            keyboardType="decimal-pad"
            returnKeyType="done"
            placeholder={lest ? 'ex. 57,5' : 'ex. 100'}
            onSubmitEditing={() => valid && dirty && parsed !== null && save(parsed, `1RM enregistré : ${unit}`)}
          />
        </View>
        <Button
          label="Enregistrer"
          size="sm"
          disabled={!valid || !dirty}
          onPress={() => parsed !== null && save(parsed, `1RM enregistré : ${unit}`)}
          style={{ marginBottom: 4 }}
        />
      </View>
      {lest && valid && total !== null && dirty && (
        <Text variant="caption" tone="muted" numeric>
          = {kg(total)} kg au total avec {formatWeight(bw)} kg de poids de corps.
        </Text>
      )}

      {manual && suggestion !== null && (
        <Card level="raised" tone="accent" style={{ gap: space.xs }}>
          <Text variant="small">{suggestionText(suggestion, lest)}</Text>
          <Text variant="bodyStrong" numeric>
            {loggedLoad(typed.value + bw, bw, lest)} → {loggedLoad(half(suggestion.to - bw) + bw, bw, lest)} kg ({signedPct(suggestion.to / (typed.value + bw) - 1)})
          </Text>
          {suggestion.aboveCap && (
            <Text variant="caption" tone="muted">
              Au-delà du +{formatWeight(MAX_RISE_PER_CYCLE * 100)} % habituel par cycle : à toi de juger.
            </Text>
          )}
          <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
            <Button label="Appliquer" size="sm" icon="checkmark" onPress={() => save(half(suggestion.to - bw), `1RM mis à jour : ${loggedLoad(half(suggestion.to - bw) + bw, bw, lest)} kg`)} />
            <Button label="Garder mon 1RM" size="sm" variant="ghost" onPress={() => save(typed.value, '1RM conservé')} />
          </View>
        </Card>
      )}

      {estimate !== null && manual && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Text variant="caption" tone="muted" style={{ flex: 1 }} numeric>
            Estimation de l’historique : {loggedLoad(estimate.value, bw, lest)} kg ({estimateSource(estimate, lest)})
            {estimate.status === 'provisional' ? ', peu fiable' : ''}.
          </Text>
          <Button label="Utiliser" size="sm" variant="ghost" onPress={() => setDraft(plainWeight(half(estimate.value - (lest ? bw : 0))).replace('.', ','))} />
        </View>
      )}

      {!manual && reference !== null && reference.calibrations.length > 0 && (
        <View style={{ gap: 2 }}>
          {reference.calibrations.slice(-3).map((c) => (
            <Text key={`${c.kind}-${c.date}`} variant="caption" tone="muted" numeric>
              {calibrationText(c)}
            </Text>
          ))}
        </View>
      )}
      <Text variant="caption" tone="muted">
        {manual
          ? 'Après une S4 réussie ou un test, l’app te propose une mise à jour ; rien ne change sans toi.'
          : `Estimation : S4 réussie (ou test) → +${formatWeight(MAX_RISE_PER_CYCLE * 100)} % max par cycle · ratée → baisse d’autant. Saisis ton 1RM pour la remplacer.`}
      </Text>
    </Card>
  );
}
