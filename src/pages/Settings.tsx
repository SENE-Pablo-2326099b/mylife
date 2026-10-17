import { Card, MoneyField, NumberField, PageTitle, Money, Field, inputClass } from '../components/ui';
import { updateSettings } from '../db/seed';
import { computeEnvelope, defaultEnvelope, totalIncome } from '../domain/defaults';
import { useSettings } from '../hooks';

export default function SettingsPage() {
  const s = useSettings();
  const save = (patch: Parameters<typeof updateSettings>[0]) => void updateSettings(patch);
  const envelope = computeEnvelope(s);

  return (
    <div className="space-y-4">
      <PageTitle>Réglages</PageTitle>

      <Card title="Cycle budgétaire">
        <NumberField
          label="Jour de paie"
          min={1}
          max={31}
          value={s.payday}
          onCommit={(payday) => save({ payday })}
          hint={`Le cycle va du ${s.payday} au ${s.payday === 1 ? 'dernier jour du mois' : s.payday - 1 + ' du mois suivant'}. Si le jour n’existe pas (ex. 31 février), le dernier jour du mois est utilisé.`}
        />
      </Card>

      <Card title="Revenus et enveloppe">
        <div className="grid grid-cols-2 gap-3">
          <MoneyField label="Salaire net" value={s.salary} onCommit={(v) => save({ salary: v ?? 0 })} />
          <MoneyField label="APL" value={s.apl} onCommit={(v) => save({ apl: v ?? 0 })} />
          <MoneyField label="Prime d’activité" value={s.activityBonus} onCommit={(v) => save({ activityBonus: v ?? 0 })} hint="Optionnelle" />
          <MoneyField label="Charges fixes" value={s.fixedCharges} onCommit={(v) => save({ fixedCharges: v ?? 0 })} hint="Loyer, abonnements…" />
          <MoneyField label="Épargne / investissement" value={s.investment} onCommit={(v) => save({ investment: v ?? 0 })} />
          <MoneyField
            label="Enveloppe vie courante"
            value={s.envelopeOverride}
            allowEmpty
            placeholder={String(defaultEnvelope(s) / 100).replace('.', ',')}
            onCommit={(v) => save({ envelopeOverride: v })}
            hint="Vide = calculée automatiquement"
          />
        </div>
        <dl className="mt-4 space-y-1 rounded-xl bg-raised p-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">Revenus du cycle</dt>
            <dd><Money cents={totalIncome(s)} /></dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">− Charges fixes</dt>
            <dd><Money cents={-s.fixedCharges} /></dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">− Épargne / investissement</dt>
            <dd><Money cents={-s.investment} /></dd>
          </div>
          <div className="flex justify-between border-t border-line pt-1 font-semibold">
            <dt>Enveloppe vie courante {s.envelopeOverride !== null && <span className="font-normal text-muted">(manuelle)</span>}</dt>
            <dd><Money cents={envelope} /></dd>
          </div>
        </dl>
      </Card>

      <Card title="Identité">
        <Field label="Ton nom tel qu’il apparaît sur les virements" hint="Sert à reconnaître les virements entre tes propres comptes (BNP → Revolut).">
          {(id) => (
            <input id={id} className={inputClass} defaultValue={s.ownerName} onBlur={(e) => e.target.value !== s.ownerName && save({ ownerName: e.target.value.trim() })} />
          )}
        </Field>
      </Card>
    </div>
  );
}
