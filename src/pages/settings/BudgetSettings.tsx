import { updateSettings } from '../../db/seed';
import { computeEnvelope, defaultEnvelope, plannedSavings, totalFixed, totalIncome } from '../../domain/defaults';
import { useSettings } from '../../hooks';
import { formatCents } from '../../lib/money';
import { Card, Divider, Money, MoneyField, Reveal, SectionTitle, Segmented, StepperRow } from '../../ui/index';
import { Screen } from '../../ui/Screen';
import { LinesEditor } from './LinesEditor';

function Line({ label, cents, strong }: { label: string; cents: number; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? 't-body-strong' : 't-small text-secondary'}`}>
      <span>{label}</span>
      <Money cents={cents} className={strong ? 'text-[17px] text-ink' : 'text-ink'} />
    </div>
  );
}

/** Le budget mensuel : cycle, revenus, charges fixes, épargne → enveloppe « vie courante ». */
export default function BudgetSettingsPage() {
  const s = useSettings();
  const save = (patch: Parameters<typeof updateSettings>[0]) => void updateSettings(patch);
  const envelope = computeEnvelope(s);

  return (
    <Screen stack title="Revenus, charges et épargne" kicker="Ton budget mensuel" mood="settings" back="/reglages">
      <Reveal index={0}>
        <Card level="raised" glow={envelope > 0} tone={envelope <= 0 ? 'danger' : 'neutral'}>
          <p className="t-label text-muted">Enveloppe vie courante par cycle</p>
          <Money cents={envelope} className={`mt-1 block text-[30px] tracking-[-0.8px] ${envelope <= 0 ? 'text-danger' : ''}`} />
          <div className="mt-3 space-y-1">
            <Line label="Revenus" cents={totalIncome(s)} />
            <Line label="− Charges fixes" cents={-totalFixed(s)} />
            <Line label="− Épargne et investissement" cents={-plannedSavings(s)} />
            {s.envelopeOverride !== null && <p className="t-caption text-warning">Montant saisi à la main ({formatCents(defaultEnvelope(s))} calculés).</p>}
          </div>
          <p className="t-caption mt-2 text-muted">C’est ce qu’il reste pour la vie de tous les jours : courses, sorties, transport… Le budget du jour en découle.</p>
        </Card>
      </Reveal>

      <Reveal index={1}>
        <SectionTitle>Cycle budgétaire</SectionTitle>
        <Card>
          <StepperRow
            label="Jour de paie"
            hint={`Du ${s.payday} au ${s.payday === 1 ? 'dernier jour du mois' : `${s.payday - 1} du mois suivant`}`}
            value={s.payday}
            min={1}
            max={31}
            onChange={(payday) => save({ payday })}
            format={(d) => `le ${d}`}
          />
        </Card>
      </Reveal>

      <Reveal index={2}>
        <SectionTitle action={<Money cents={totalIncome(s)} className="text-[14px] text-success" />}>Revenus du mois</SectionTitle>
        <LinesEditor income lines={s.incomes} onChange={(incomes) => save({ incomes })} icon="cash" addLabel="Ajouter un revenu" emptyLabel="Salaire, bourse, aides, pension, freelance…" suggestions={['Salaire', 'APL', 'Bourse', 'Prime d’activité']} />
      </Reveal>

      <Reveal index={3}>
        <SectionTitle action={<Money cents={totalFixed(s)} className="text-[14px]" />}>Charges fixes</SectionTitle>
        <LinesEditor lines={s.fixedCharges} onChange={(fixedCharges) => save({ fixedCharges })} icon="receipt" addLabel="Ajouter une charge" emptyLabel="Loyer, électricité, forfait, assurances, abonnements…" suggestions={['Loyer', 'Électricité', 'Forfait mobile', 'Assurance']} />
      </Reveal>

      <Reveal index={4}>
        <SectionTitle>Épargne et investissement</SectionTitle>
        <Card className="space-y-3">
          <Segmented
            options={[
              { value: 'auto', label: 'Mes plans et objectifs' },
              { value: 'manual', label: 'Montant fixe' },
            ]}
            value={s.savings.mode}
            onChange={(mode) => save({ savings: { ...s.savings, mode } })}
            label="Calcul de l’épargne"
          />
          {s.savings.mode === 'auto' ? (
            <p className="t-small text-secondary">
              <Money cents={s.plannedSavingsAuto} className="text-ink" /> par mois : la somme de tes investissements programmés et des objectifs comptés dans le budget (onglet Patrimoine).
            </p>
          ) : (
            <MoneyField label="Mis de côté chaque mois" value={s.savings.manual} onCommit={(v) => save({ savings: { ...s.savings, manual: Math.abs(v ?? 0) } })} />
          )}
          <Divider />
          <MoneyField
            label="Enveloppe saisie à la main"
            value={s.envelopeOverride}
            allowEmpty
            allowNegative
            placeholder={formatCents(defaultEnvelope(s)).replace(/\s?€/, '')}
            onCommit={(v) => save({ envelopeOverride: v })}
            hint="Vide = calculée automatiquement (recommandé)."
          />
        </Card>
      </Reveal>
    </Screen>
  );
}
