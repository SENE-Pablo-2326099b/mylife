import { useEffect, useMemo, useState } from 'react';
import { updateSettings } from '../../db/seed';
import {
  coastFi,
  computeFire,
  fireLevers,
  isEssential,
  milestoneReached,
  passiveIncome,
  savingsRateHistory,
  scenarioSeries,
  type FiTier,
} from '../../domain/fire';
import { plannedMonthlySavings } from '../../domain/plans';
import { useRecurring } from '../../domain/useInsights';
import { useMonteCarlo } from '../../domain/useFireSim';
import { useWealth } from '../../domain/useWealth';
import { useCategories, useCategoryMap, useSettings } from '../../hooks';
import { todayISO } from '../../lib/dates';
import { formatCents } from '../../lib/money';
import { ColumnChart, LineChart, Ring } from '../../ui/charts';
import { Badge, Card, Chip, Disclosure, Divider, Metric, MoneyField, ProgressBar, Reveal, Sheet, StepperRow, ToggleRow, toast } from '../../ui/index';
import { Screen } from '../../ui/Screen';
import { useBreakpoint } from '../../ui/responsive';

const pct = (v: number, digits = 0) => `${(v * 100).toLocaleString('fr-FR', { maximumFractionDigits: digits })} %`;
const bp = (v: number) => `${(v / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`;

function duration(months: number | null): string {
  if (months === null) return 'plus de 80 ans';
  if (months <= 0) return 'déjà atteinte';
  const y = Math.floor(months / 12);
  const m = months % 12;
  return y === 0 ? `${m} mois` : m === 0 ? `${y} an${y > 1 ? 's' : ''}` : `${y} an${y > 1 ? 's' : ''} et ${m} mois`;
}

/** Durée courte pour les leviers : « 11 mois », « 1,5 an », « 7,8 ans ». */
function shortDuration(months: number): string {
  if (months < 12) return `${months} mois`;
  const y = Math.round((months / 12) * 10) / 10;
  return `${y.toLocaleString('fr-FR')} an${y >= 2 ? 's' : ''}`;
}

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

const yearOf = (months: number | null) => (months === null ? null : new Date().getFullYear() + Math.ceil(months / 12));

function TierRow({ tier, current, birthYear }: { tier: FiTier; current: number; birthYear: number | null }) {
  const reached = tier.months === 0;
  const y = yearOf(tier.months);
  return (
    <div className="py-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="t-body-strong">
          {tier.label} {reached && <Badge tone="gold">atteint</Badge>}
        </span>
        <span className="num t-small text-secondary">{formatCents(tier.target, { short: true })}</span>
      </div>
      <ProgressBar value={current} max={tier.target} tone={reached ? 'gold' : 'accent'} height={6} label={`${tier.label} : ${pct(Math.min(1, current / Math.max(1, tier.target)))}`} />
      <p className="t-caption mt-1 text-muted">
        {formatCents(tier.annualSpending, { short: true })}/an · {reached ? 'déjà là' : `dans ${duration(tier.months)}${y ? ` (${y}${birthYear ? `, à ${y - birthYear} ans` : ''})` : ''}`}
      </p>
    </div>
  );
}

/** Indépendance financière : où tu en es, quand, avec quelle probabilité, et ce qui change la donne. */
export default function FirePage() {
  const settings = useSettings();
  const cats = useCategoryMap();
  const categories = useCategories();
  const w = useWealth();
  const { txs } = useRecurring();
  const today = todayISO();
  const wide = useBreakpoint() === 'expanded';
  const f = settings.fire;
  const set = (patch: Partial<typeof f>) => void updateSettings({ fire: { ...f, ...patch } });
  const [essentialSheet, setEssentialSheet] = useState(false);

  const savingsAccounts = useMemo(() => w.accounts.filter((a) => a.kind === 'savings' && !a.hidden), [w.accounts]);
  const excluded = new Set(f.excludedIds);
  const planned = plannedMonthlySavings(w.plans, w.goals);
  const [monthlyOverride, setMonthly] = useState<number | null>(null);
  const monthly = monthlyOverride ?? (settings.savings.mode === 'manual' ? settings.savings.manual : planned);
  const state = useMemo(
    () => computeFire({ summaries: w.summaries, savingsAccounts, txs, cats, settings, today, monthly }),
    [w.summaries, savingsAccounts, txs, cats, settings, today, monthly],
  );
  const { current, breakdown, breakdownReal, tax, realNet, tiers, main, progress } = state;
  const coast = coastFi(main.target, realNet, f.birthYear, f.retirementAge, today);
  const levers = fireLevers({ current, monthly, target: main.target, settings: f });
  const years = Math.min(50, Math.max(10, main.months === null ? 40 : Math.ceil(main.months / 12) + 5));
  const scenarios = scenarioSeries({ current, monthly, settings: f, years });
  // Seulement les mois qui ont des données (6 au plus sur téléphone, 12 sur ordinateur).
  const rates = useMemo(() => {
    const all = savingsRateHistory(txs, cats, today, 12);
    const first = all.findIndex((r) => r.income > 0 || r.spending > 0);
    return first === -1 ? [] : all.slice(first);
  }, [txs, cats, today]).slice(wide ? -12 : -6);
  const withIncome = rates.filter((r) => r.rate !== null);
  const avgRate = withIncome.length ? withIncome.reduce((s, r) => s + (r.rate ?? 0), 0) / withIncome.length : null;
  const passive = passiveIncome(w.ops, today);
  const pensionYear = f.pensionMonthly * 12;
  const afterPensionTarget = Math.round(Math.max(0, breakdown.annual - pensionYear) / (f.withdrawalBp / 10000) / Math.max(0.5, 1 - tax));
  const sim = useMonteCarlo(main.target > 0 ? { current, monthly, target: main.target, realRate: realNet, volatility: 0.15, annualSpending: breakdown.annual, runs: 1000 } : null);
  const year = yearOf(main.months);

  // Paliers : chacun fêté une seule fois.
  const milestone = milestoneReached(progress);
  useEffect(() => {
    if (milestone > f.lastMilestone) {
      toast({ message: milestone >= 1 ? 'Indépendance financière atteinte 🎉' : `Palier franchi : ${pct(milestone)} de ton indépendance`, tone: 'gold' });
      set({ lastMilestone: milestone });
    }
  }, [milestone]); // eslint-disable-line react-hooks/exhaustive-deps

  const hero = (
    <Card level="raised" tone={main.months === 0 ? 'gold' : 'neutral'} glow={main.months !== null && main.months > 0}>
      <div className="flex items-center gap-4">
        <Ring value={progress} size={wide ? 132 : 108} stroke={10} tone="gold" label={`${pct(progress)} du capital visé`}>
          <span className="num font-display text-[22px] font-semibold">{pct(progress)}</span>
        </Ring>
        <div className="min-w-0 flex-1">
          <p className="t-label text-muted">Au rythme actuel</p>
          <p className={`t-title mt-0.5 ${main.months === 0 ? 'text-gold' : ''}`}>{main.months === 0 ? 'Indépendance atteinte' : `Dans ${duration(main.months)}`}</p>
          {year && main.months !== 0 && (
            <p className="t-small text-secondary">
              vers {year}
              {f.birthYear ? `, à ${year - f.birthYear} ans` : ''}
            </p>
          )}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Metric label="Capital visé" value={formatCents(main.target, { short: true })} hint={`${formatCents(breakdown.annual, { short: true })}/an ÷ ${bp(f.withdrawalBp)}${tax > 0.005 ? ` · impôts ${pct(tax, 1)}` : ''}`} />
        <Metric label="Aujourd’hui" value={formatCents(current, { short: true })} hint={`+ ${formatCents(monthly, { short: true })} par mois`} />
      </div>
    </Card>
  );

  const tiersCard = (
    <Card>
      <p className="t-headline">Trois paliers</p>
      <p className="t-caption text-muted">Lean : tes dépenses essentielles. FI : ton train de vie. Fat : 50 % de marge.</p>
      <Divider />
      {tiers.map((t) => (
        <TierRow key={t.id} tier={t} current={current} birthYear={f.birthYear} />
      ))}
    </Card>
  );

  const coastCard = (
    <Card>
      <p className="t-headline">Coast FI</p>
      {coast === null ? (
        <p className="t-small mt-1 text-secondary">Indique ton année de naissance (Retraite et fiscalité, plus bas) pour savoir à partir de quand tu pourrais arrêter d’épargner.</p>
      ) : current >= coast ? (
        <p className="t-small mt-1 text-secondary">
          <strong className="text-gold">Atteint.</strong> Même sans épargner un euro de plus, ton capital devrait suffire à {f.retirementAge} ans, par le seul rendement.
        </p>
      ) : (
        <>
          <p className="t-small mt-1 text-secondary">
            Avec <strong className="text-ink">{formatCents(coast, { short: true })}</strong> placés, tu pourrais arrêter d’épargner : le rendement seul t’amènerait à l’indépendance à {f.retirementAge} ans.
          </p>
          <ProgressBar value={current} max={coast} tone="gold" height={6} label={`Coast FI : ${pct(current / coast)}`} />
          <p className="t-caption mt-1 text-muted">{pct(current / coast)} du chemin</p>
        </>
      )}
    </Card>
  );

  const leversCard = (
    <Card>
      <p className="t-headline">Ce qui change la donne</p>
      <div className="mt-2 space-y-1.5">
        {levers.map((l) => (
          <div key={l.id} className="flex items-baseline justify-between gap-3">
            <span className="t-small min-w-0 text-secondary">{l.label}</span>
            <span className={`num t-body-strong shrink-0 whitespace-nowrap ${l.months === null ? 'text-muted' : l.months >= 0 ? 'text-success' : 'text-danger'}`}>
              {l.months === null ? '—' : l.months === 0 ? '±0' : `${l.months > 0 ? '−' : '+'}${shortDuration(Math.abs(l.months))}`}
            </span>
          </div>
        ))}
      </div>
      <Divider />
      <MoneyField label="Versement mensuel simulé" value={monthly} onCommit={(v) => setMonthly(v === null ? null : Math.abs(v))} hint={`Prévu dans ton budget : ${formatCents(settings.savings.mode === 'manual' ? settings.savings.manual : planned)} par mois.`} />
    </Card>
  );

  const chartCard = (
    <Card>
      <p className="t-headline">Trajectoire</p>
      <p className="t-caption text-muted">Prudent, médian et optimiste (±2 % de rendement réel).</p>
      <LineChart
        series={[
          { id: 'mid', label: 'Médian', values: scenarios[1]!.values, look: 'primary' },
          { id: 'low', label: 'Prudent', values: scenarios[0]!.values, look: 'secondary' },
          { id: 'high', label: 'Optimiste', values: scenarios[2]!.values, look: 'secondary' },
          { id: 't', label: 'Capital visé', values: scenarios[1]!.values.map(() => main.target), look: 'dashed' },
        ]}
        xLabels={scenarios[1]!.values.map((_, i) => String(new Date().getFullYear() + i))}
        formatY={(v) => formatCents(v, { short: true })}
        ariaLabel={`Projection : ${formatCents(current)} aujourd’hui, objectif ${formatCents(main.target)} ${main.months === null ? 'non atteint' : `atteint dans ${duration(main.months)}`} au scénario médian.`}
      />
    </Card>
  );

  const probaCard = (
    <Card>
      <p className="t-headline">Avec les aléas des marchés</p>
      {!sim ? (
        <p className="t-small mt-1 text-secondary">Simulation de 1 000 trajectoires…</p>
      ) : (
        <>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <Metric label={year ? `Atteinte d’ici ${year}` : 'Atteinte'} value={pct(sim.reachedByMedianDate)} tone={sim.reachedByMedianDate >= 0.5 ? 'success' : 'warning'} />
            <Metric label="Retraits tenables 40 ans" value={pct(sim.sustainable40)} tone={sim.sustainable40 >= 0.85 ? 'success' : sim.sustainable40 >= 0.6 ? 'warning' : 'danger'} />
          </div>
          <p className="t-caption mt-2 text-muted">
            8 trajectoires sur 10 atteignent l’objectif entre {yearOf(sim.p10) ?? '—'} et {yearOf(sim.p90) ?? 'plus de 60 ans'}. Volatilité retenue : 15 %/an (actions mondiales).
          </p>
        </>
      )}
    </Card>
  );

  const savingsCard = (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="t-headline">Taux d’épargne</p>
        {avgRate !== null && <span className={`num t-body-strong ${avgRate >= 0.2 ? 'text-success' : avgRate >= 0 ? '' : 'text-danger'}`}>{pct(avgRate)} en moyenne</span>}
      </div>
      <p className="t-caption text-muted">(revenus − dépenses) ÷ revenus, mois par mois, d’après tes opérations.</p>
      {withIncome.length > 0 ? (
        <ColumnChart
          data={rates.map((r) => ({ label: MONTHS[Number(r.month.slice(5)) - 1] ?? r.month, value: Math.round((r.rate ?? 0) * 100), lit: r.rate !== null, tone: (r.rate ?? 0) < 0 ? 'danger' : 'accent' }))}
          format={(v) => `${v} %`}
          height={130}
          label={`Taux d’épargne des 12 derniers mois, moyenne ${avgRate === null ? 'inconnue' : pct(avgRate)}`}
        />
      ) : (
        <p className="t-small mt-2 text-secondary">Pas encore de revenus classés « Revenus » sur la période.</p>
      )}
      <Divider />
      <div className="flex items-baseline justify-between gap-3">
        <span className="t-small text-secondary">Revenus passifs (12 mois)</span>
        <span className="num t-body-strong">{formatCents(passive)}</span>
      </div>
      <p className="t-caption text-muted">Couvrent {pct(breakdown.annual > 0 ? Math.max(0, passive) / breakdown.annual : 0, 1)} de tes dépenses (dividendes et intérêts, frais déduits).</p>
    </Card>
  );

  return (
    <Screen stack title="Indépendance financière" kicker="En euros d’aujourd’hui" mood="wealth" back="/patrimoine">
      <Reveal index={0}>{hero}</Reveal>
      <div className={wide ? 'mt-3 grid grid-cols-2 items-start gap-3' : 'mt-3 space-y-3'}>
        <div className="space-y-3">
          <Reveal index={1}>{tiersCard}</Reveal>
          <Reveal index={2}>{coastCard}</Reveal>
          <Reveal index={3}>{leversCard}</Reveal>
        </div>
        <div className="space-y-3">
          <Reveal index={4}>{chartCard}</Reveal>
          <Reveal index={5}>{probaCard}</Reveal>
          <Reveal index={6}>{savingsCard}</Reveal>
        </div>
      </div>

      <Reveal index={7}>
        <Disclosure title="Dépenses prises en compte" summary={`${formatCents(breakdown.annual, { short: true })}/an · essentielles ${pct(breakdown.annual ? breakdown.essential / breakdown.annual : 0)}`}>
          <Card className="space-y-3">
            <ToggleRow
              label="D’après tes dépenses réelles"
              hint={f.annualSpendingOverride === null ? `${formatCents(breakdownReal.annual)} par an (${breakdownReal.source === 'history' ? 'tes 12 derniers mois' : 'ton budget × 12'})` : 'Montant saisi'}
              checked={f.annualSpendingOverride === null}
              onChange={(on) => set({ annualSpendingOverride: on ? null : breakdownReal.annual })}
            />
            {f.annualSpendingOverride !== null && <MoneyField label="Dépenses annuelles visées une fois indépendant" value={f.annualSpendingOverride} onCommit={(v) => set({ annualSpendingOverride: Math.abs(v ?? 0) })} />}
            {breakdownReal.byCategory.slice(0, 8).map((c) => (
              <div key={c.id} className="flex items-baseline justify-between gap-3">
                <span className="t-small min-w-0 truncate text-secondary">
                  {cats.get(c.id)?.emoji ?? '❔'} {cats.get(c.id)?.name ?? 'À classer'} {c.essential && <Badge>essentiel</Badge>}
                </span>
                <span className="num t-small">{formatCents(c.annual, { short: true })}/an</span>
              </div>
            ))}
            <Chip small icon="edit" onClick={() => setEssentialSheet(true)}>
              Choisir les dépenses essentielles
            </Chip>
          </Card>
        </Disclosure>
      </Reveal>

      <Reveal index={8}>
        <Disclosure title="Patrimoine pris en compte" summary={formatCents(current, { short: true })}>
          <Card className="space-y-1">
            <p className="t-caption text-muted">Exclus ce qui ne financera pas ta liberté : épargne de précaution, apport immobilier, projet.</p>
            {w.summaries.map((s) => (
              <ToggleRow key={s.portfolio.id} label={s.portfolio.name} hint={`${s.portfolio.wrapper} · ${formatCents(s.value, { short: true })}`} checked={!excluded.has(s.portfolio.id)} onChange={(on) => set({ excludedIds: on ? f.excludedIds.filter((id) => id !== s.portfolio.id) : [...f.excludedIds, s.portfolio.id] })} />
            ))}
            {savingsAccounts.map((a) => (
              <ToggleRow key={a.id} label={a.nickname ?? a.name} hint={`Compte épargne · ${formatCents(a.balance ?? 0, { short: true })}`} checked={!excluded.has(a.id)} onChange={(on) => set({ excludedIds: on ? f.excludedIds.filter((id) => id !== a.id) : [...f.excludedIds, a.id] })} />
            ))}
            {w.summaries.length + savingsAccounts.length === 0 && <p className="t-small text-secondary">Aucun placement ni compte épargne pour l’instant.</p>}
          </Card>
        </Disclosure>
      </Reveal>

      <Reveal index={9}>
        <Disclosure title="Retraite et fiscalité" summary={`${f.birthYear ? `né·e en ${f.birthYear} · ` : ''}impôts ${pct(tax, 1)}`}>
          <Card className="space-y-2">
            <StepperRow label="Année de naissance" value={f.birthYear ?? 1995} min={1940} max={2015} format={(v) => (f.birthYear ? String(v) : '—')} onChange={(birthYear) => set({ birthYear })} />
            <StepperRow label="Âge de la retraite légale" value={f.retirementAge} min={55} max={70} format={(v) => `${v} ans`} onChange={(retirementAge) => set({ retirementAge })} />
            <MoneyField label="Pension nette estimée (par mois)" value={f.pensionMonthly} onCommit={(v) => set({ pensionMonthly: Math.abs(v ?? 0) })} hint="Voir ton relevé sur info-retraite.fr. En euros d’aujourd’hui." />
            {f.pensionMonthly > 0 && (
              <p className="t-small text-secondary">
                À partir de {f.retirementAge} ans, ta pension couvrira {pct(Math.min(1, pensionYear / Math.max(1, breakdown.annual)))} de tes dépenses : le capital nécessaire tombera alors à {formatCents(afterPensionTarget, { short: true })}.
              </p>
            )}
            <Divider />
            <p className="t-small text-secondary">
              Impôt moyen sur tes retraits : <strong className="text-ink">{pct(tax, 1)}</strong>, déjà intégré au capital visé. PEA (+5 ans) et assurance-vie (+8 ans) : 17,2 % de prélèvements sociaux sur la plus-value ; compte-titres et crypto : 30 %.
            </p>
          </Card>
        </Disclosure>
      </Reveal>

      <Reveal index={10}>
        <Disclosure title="Hypothèses" summary={`${bp(f.annualReturnBp)} − ${bp(f.inflationBp)} − frais ${bp(f.feesBp)} · retrait ${bp(f.withdrawalBp)}`}>
          <Card className="space-y-2">
            <StepperRow label="Rendement annuel" hint="Moyenne long terme visée, avant frais." value={f.annualReturnBp} step={25} min={0} max={1500} format={bp} onChange={(annualReturnBp) => set({ annualReturnBp })} />
            <StepperRow label="Inflation" value={f.inflationBp} step={25} min={0} max={1000} format={bp} onChange={(inflationBp) => set({ inflationBp })} />
            <StepperRow label="Frais des placements" hint="Moyenne pondérée (ETF ≈ 0,2 %)." value={f.feesBp} step={5} min={0} max={300} format={bp} onChange={(feesBp) => set({ feesBp })} />
            <StepperRow label="Taux de retrait" hint="4 % = 25 ans de dépenses (étude Trinity)." value={f.withdrawalBp} step={25} min={200} max={800} format={bp} onChange={(withdrawalBp) => set({ withdrawalBp })} />
            <p className="t-caption text-muted">Rendement réel net retenu : {(realNet * 100).toFixed(2).replace('.', ',')} % par an. Une projection n’est pas une promesse : les marchés ne montent pas en ligne droite.</p>
          </Card>
        </Disclosure>
      </Reveal>

      <Sheet open={essentialSheet} onClose={() => setEssentialSheet(false)} title="Dépenses essentielles">
        <p className="t-small mb-3 text-secondary">Ce qui resterait indispensable même avec un train de vie minimal (palier Lean FI).</p>
        <div className="flex flex-wrap gap-2">
          {categories
            .filter((c) => c.kind === 'variable' || c.kind === 'fixed')
            .map((c) => {
              const on = isEssential(c, f.essentialCategoryIds);
              return (
                <Chip
                  key={c.id}
                  selected={on}
                  onClick={() => {
                    const base = f.essentialCategoryIds ?? categories.filter((x) => isEssential(x, null)).map((x) => x.id);
                    set({ essentialCategoryIds: on ? base.filter((id) => id !== c.id) : [...base, c.id] });
                  }}
                >
                  {c.emoji} {c.name}
                </Chip>
              );
            })}
        </div>
      </Sheet>
    </Screen>
  );
}
