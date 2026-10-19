import { useMemo, useState } from 'react';
import { updateSettings } from '../../db/seed';
import { estimateAnnualSpending, monthsToTarget, projectFire } from '../../domain/fire';
import { plannedMonthlySavings } from '../../domain/plans';
import { useRecurring } from '../../domain/useInsights';
import { useWealth } from '../../domain/useWealth';
import { useCategoryMap, useSettings } from '../../hooks';
import { todayISO } from '../../lib/dates';
import { formatCents } from '../../lib/money';
import { LineChart, Ring } from '../../ui/charts';
import { Card, Disclosure, Divider, Metric, MoneyField, Reveal, SectionTitle, StepperRow, ToggleRow } from '../../ui/index';
import { Screen } from '../../ui/Screen';

const bp = (v: number) => `${(v / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`;

function years(months: number | null): string {
  if (months === null) return 'plus de 80 ans';
  if (months === 0) return 'déjà atteinte';
  const y = Math.floor(months / 12);
  const m = months % 12;
  return y === 0 ? `${m} mois` : m === 0 ? `${y} an${y > 1 ? 's' : ''}` : `${y} an${y > 1 ? 's' : ''} et ${m} mois`;
}

/** Indépendance financière : quand tes placements pourraient-ils financer ton train de vie ? */
export default function FirePage() {
  const settings = useSettings();
  const cats = useCategoryMap();
  const w = useWealth();
  const { txs } = useRecurring();
  const today = todayISO();
  const f = settings.fire;
  const auto = estimateAnnualSpending(txs, cats, { ...settings, fire: { ...f, annualSpendingOverride: null } }, today);
  const annualSpending = f.annualSpendingOverride ?? auto.amount;
  const savingsAccounts = w.accounts.filter((a) => a.kind === 'savings' && !a.hidden).reduce((s, a) => s + (a.balance ?? 0), 0);
  const current = w.worth.investments + savingsAccounts;
  const planned = plannedMonthlySavings(w.plans, w.goals);
  const [monthly, setMonthly] = useState<number | null>(null);
  const effectiveMonthly = monthly ?? (settings.savings.mode === 'manual' ? settings.savings.manual : planned);

  const proj = useMemo(() => projectFire({ current, monthly: effectiveMonthly, annualSpending, settings: f }), [current, effectiveMonthly, annualSpending, f]);
  const plus100 = monthsToTarget(current, effectiveMonthly + 10000, proj.realRate, proj.target);
  const gained = proj.months !== null && plus100 !== null ? proj.months - plus100 : null;
  const year = proj.months === null ? null : new Date().getFullYear() + Math.ceil(proj.months / 12);
  const set = (patch: Partial<typeof f>) => void updateSettings({ fire: { ...f, ...patch } });

  return (
    <Screen stack title="Indépendance financière" kicker="Projection en euros d’aujourd’hui" mood="wealth" back="/patrimoine">
      <Reveal index={0}>
        <Card level="raised" tone={proj.months === 0 ? 'gold' : 'neutral'} glow={proj.months !== null && proj.months > 0}>
          <div className="flex items-center gap-4">
            <Ring value={proj.progress} size={104} stroke={10} tone="gold" label={`${Math.round(proj.progress * 100)} % du capital visé`}>
              <span className="num font-display text-[20px] font-semibold">{Math.round(proj.progress * 100)} %</span>
            </Ring>
            <div className="min-w-0 flex-1">
              <p className="t-label text-muted">Au rythme actuel</p>
              <p className={`t-title mt-0.5 ${proj.months === 0 ? 'text-gold' : ''}`}>{proj.months === 0 ? 'Indépendance atteinte' : `Dans ${years(proj.months)}`}</p>
              {year && proj.months !== 0 && <p className="t-small text-secondary">vers {year}</p>}
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Metric label="Capital visé" value={formatCents(proj.target, { compact: true })} hint={`${formatCents(annualSpending, { compact: true })}/an ÷ ${bp(f.withdrawalBp)}`} />
            <Metric label="Aujourd’hui" value={formatCents(current, { compact: true })} hint="placements + épargne" />
          </div>
          {gained !== null && gained > 0 && (
            <p className="t-small mt-3 text-success">+100 € par mois te feraient gagner {years(gained)}.</p>
          )}
        </Card>
      </Reveal>

      <Reveal index={1}>
        <SectionTitle>Trajectoire</SectionTitle>
        <Card>
          <LineChart
            series={[
              { id: 'v', label: 'Capital projeté', values: proj.series.map((p) => p.value), look: 'primary' },
              { id: 't', label: 'Capital visé', values: proj.series.map(() => proj.target), look: 'dashed' },
            ]}
            xLabels={proj.series.map((p) => String(new Date().getFullYear() + p.year))}
            formatY={(v) => formatCents(v, { short: true })}
            ariaLabel={`Projection : ${formatCents(current)} aujourd’hui, objectif ${formatCents(proj.target)} ${proj.months === null ? 'non atteint' : `atteint dans ${years(proj.months)}`}.`}
          />
        </Card>
      </Reveal>

      <Reveal index={2}>
        <SectionTitle>Ton rythme</SectionTitle>
        <Card className="space-y-3">
          <MoneyField label="Versement mensuel simulé" value={effectiveMonthly} onCommit={(v) => setMonthly(v === null ? null : Math.abs(v))} hint={`Prévu dans ton budget : ${formatCents(settings.savings.mode === 'manual' ? settings.savings.manual : planned)} par mois. Change-le pour simuler.`} />
          <Divider />
          <ToggleRow
            label="Dépenses annuelles estimées"
            hint={f.annualSpendingOverride === null ? `${formatCents(auto.amount)} (${auto.source === 'history' ? 'tes 12 derniers mois' : 'ton budget × 12'})` : 'Montant saisi'}
            checked={f.annualSpendingOverride === null}
            onChange={(on) => set({ annualSpendingOverride: on ? null : auto.amount })}
          />
          {f.annualSpendingOverride !== null && <MoneyField label="Dépenses annuelles visées" value={f.annualSpendingOverride} onCommit={(v) => set({ annualSpendingOverride: Math.abs(v ?? 0) })} />}
        </Card>
      </Reveal>

      <Reveal index={3}>
        <Disclosure title="Hypothèses" summary={`${bp(f.annualReturnBp)} − ${bp(f.inflationBp)} · retrait ${bp(f.withdrawalBp)}`}>
          <Card className="space-y-2">
            <StepperRow label="Rendement annuel" hint="Moyenne long terme visée, frais déduits." value={f.annualReturnBp} step={25} min={0} max={1500} format={bp} onChange={(annualReturnBp) => set({ annualReturnBp })} />
            <StepperRow label="Inflation" value={f.inflationBp} step={25} min={0} max={1000} format={bp} onChange={(inflationBp) => set({ inflationBp })} />
            <StepperRow label="Taux de retrait" hint="4 % = 25 ans de dépenses (étude Trinity)." value={f.withdrawalBp} step={25} min={200} max={800} format={bp} onChange={(withdrawalBp) => set({ withdrawalBp })} />
            <p className="t-caption text-muted">Rendement réel retenu : {(proj.realRate * 100).toFixed(2).replace('.', ',')} % par an, intérêts composés chaque mois. Une projection n’est pas une promesse : les marchés ne montent pas en ligne droite.</p>
          </Card>
        </Disclosure>
      </Reveal>
    </Screen>
  );
}
