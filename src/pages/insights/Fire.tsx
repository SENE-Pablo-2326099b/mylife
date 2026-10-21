import { useEffect, useMemo, useState } from 'react';
import { updateSettings } from '../../db/seed';
import type { FireSettings } from '../../db/types';
import {
  affordableSpending,
  capitalSeries,
  computeFire,
  cutsMonthly,
  milestoneReached,
  reducibleSpending,
  requiredMonthly,
  spendingCutNeeded,
  type FireState,
} from '../../domain/fire';
import { plannedMonthlySavings } from '../../domain/plans';
import { useRecurring } from '../../domain/useInsights';
import { useWealth } from '../../domain/useWealth';
import { useCategoryMap, useSettings } from '../../hooks';
import { todayISO } from '../../lib/dates';
import { formatCents } from '../../lib/money';
import { LineChart } from '../../ui/charts';
import { Button, Card, Chip, Disclosure, Divider, Group, MoneyField, ProgressBar, Reveal, Row, Sheet, StepperRow, ToggleRow, toast } from '../../ui/index';
import { Screen } from '../../ui/Screen';
import { useBreakpoint } from '../../ui/responsive';

/**
 * Indépendance financière, en simple : un objectif (un revenu, une année), ce qu'il faut faire pour
 * l'atteindre, et un rythme à simuler (investir plus, dépenser moins) qu'on peut garder comme plan.
 * Tout est en euros d'aujourd'hui ; les réglages fins restent repliés en bas.
 */

const pct = (v: number, digits = 0) => `${(v * 100).toLocaleString('fr-FR', { maximumFractionDigits: digits })} %`;
const bp = (v: number) => `${(v / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`;
const euros = (cents: number) => formatCents(cents, { short: true });
const perMonth = (cents: number) => `${euros(cents)}/mois`;
const CUT_STEPS = [0, 0.1, 0.25, 0.5] as const;

/** Année atteinte dans `months` mois (null : hors de portée). */
function reachedYear(months: number | null, now = new Date()): number | null {
  if (months === null) return null;
  return new Date(now.getFullYear(), now.getMonth() + months, 1).getFullYear();
}

/** Mois d'ici la fin de l'année visée. */
function monthsUntil(year: number, now = new Date()): number {
  return (year - now.getFullYear()) * 12 + (11 - now.getMonth());
}

const yearsWord = (n: number) => `${n} an${n > 1 ? 's' : ''}`;

/** « 8 mois », « 3 ans ». */
function span(months: number): string {
  return months < 12 ? `${months} mois` : yearsWord(Math.round(months / 12));
}

interface Rhythm {
  monthly: number;
  cuts: Record<string, number>;
}

export default function FirePage() {
  const settings = useSettings();
  const cats = useCategoryMap();
  const w = useWealth();
  const { txs } = useRecurring();
  const today = todayISO();
  const wide = useBreakpoint() === 'expanded';
  const f = settings.fire;
  const set = (patch: Partial<FireSettings>) => void updateSettings({ fire: { ...f, ...patch } });
  const [sheet, setSheet] = useState<'income' | 'year' | null>(null);

  const savingsAccounts = useMemo(() => w.accounts.filter((a) => a.kind === 'savings' && !a.hidden), [w.accounts]);
  const excluded = new Set(f.excludedIds);
  const currentMonthly = settings.savings.mode === 'manual' ? settings.savings.manual : plannedMonthlySavings(w.plans, w.goals);
  const fire = (r: Rhythm, reducible: readonly { id: string; monthly: number }[]) =>
    computeFire({ summaries: w.summaries, savingsAccounts, txs, cats, settings, today, monthly: r.monthly, cutMonthly: cutsMonthly(reducible, r.cuts) });

  // Rythme actuel, plan gardé, et simulation en cours (partie du plan, ou du rythme actuel).
  const base = useMemo(() => fire({ monthly: currentMonthly, cuts: {} }, []), [w.summaries, savingsAccounts, txs, cats, settings, today, currentMonthly]); // eslint-disable-line react-hooks/exhaustive-deps
  const reducible = useMemo(() => reducibleSpending(base.breakdown, cats, 5), [base.breakdown, cats]);
  const plan: Rhythm | null = f.plan;
  const reference: Rhythm = plan ?? { monthly: currentMonthly, cuts: {} };
  const active = plan ? fire(plan, reducible) : base;
  const [draft, setDraft] = useState<Rhythm | null>(null);
  const sim = draft ?? reference;
  const simState = fire(sim, reducible);
  const simDirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(reference);

  // Paliers : chacun fêté une seule fois.
  const milestone = milestoneReached(base.progress);
  useEffect(() => {
    if (milestone > f.lastMilestone) {
      toast({ message: milestone >= 1 ? 'Indépendance financière atteinte 🎉' : `Palier franchi : ${pct(milestone)} de ton indépendance`, tone: 'gold' });
      set({ lastMilestone: milestone });
    }
  }, [milestone]); // eslint-disable-line react-hooks/exhaustive-deps

  const thisYear = new Date().getFullYear();
  const age = (year: number) => (f.birthYear ? ` (à ${year - f.birthYear} ans)` : '');
  const editable = 'rounded-md px-1 text-accent underline decoration-dotted underline-offset-4';

  // ------------------------------------------------------------------ objectif
  const hero = (
    <Card level="raised" glow className="space-y-4">
      <div>
        <p className="t-label text-gold">Ton objectif</p>
        <p className="t-title mt-2 leading-snug">
          Vivre de mes placements avec{' '}
          <button type="button" className={editable} onClick={() => setSheet('income')}>
            {perMonth(active.annualSpending / 12)}
          </button>{' '}
          {f.goalYear ? (
            <>
              dès{' '}
              <button type="button" className={editable} onClick={() => setSheet('year')}>
                {f.goalYear}
              </button>
              {age(f.goalYear)}
            </>
          ) : (
            <button type="button" className={editable} onClick={() => setSheet('year')}>
              à partir de quand ?
            </button>
          )}
        </p>
      </div>
      <div>
        <ProgressBar value={active.current} max={Math.max(1, active.target)} tone="gold" height={8} label={`${pct(active.progress)} du capital nécessaire`} />
        <p className="t-small mt-2 text-secondary">
          <strong className="num text-ink">{euros(active.current)}</strong> sur <strong className="num text-ink">{euros(active.target)}</strong> nécessaires ({pct(active.progress)})
        </p>
        <p className="t-caption mt-1 text-muted">
          Capital nécessaire = revenu visé ÷ {bp(f.withdrawalBp)} de retrait par an{active.tax > 0 ? `, impôt sur les retraits compris (${pct(active.tax, 1)})` : ''}.
        </p>
      </div>
    </Card>
  );

  // ------------------------------------------------------------------ simulateur de rythme
  const simYear = reachedYear(simState.months);
  const baseYear = reachedYear(base.months);
  const gained = simState.months !== null && base.months !== null ? base.months - simState.months : null;
  const freed = cutsMonthly(reducible, sim.cuts);
  const income = settings.incomes.reduce((s, l) => s + l.amount, 0);
  const editDraft = (patch: Partial<Rhythm>) => setDraft({ ...sim, ...patch });
  const simulator = (
    <Card className="space-y-4">
      <div>
        <p className="t-headline">Simule ton rythme</p>
        <p className="t-small mt-1 text-secondary">Investir un peu plus, dépenser un peu moins : regarde ce que ça change, puis garde-le comme plan.</p>
      </div>
      <div>
        <MoneyField
          label="J’investis chaque mois"
          value={sim.monthly}
          onCommit={(v) => editDraft({ monthly: Math.max(0, v ?? 0) })}
          hint={`Aujourd’hui : ${perMonth(currentMonthly)} (${settings.savings.mode === 'manual' ? 'montant saisi dans ton budget' : 'tes plans d’investissement et objectifs'}).`}
        />
        <div className="mt-2 flex flex-wrap gap-2">
          {[5000, 10000, 20000].map((step) => (
            <Chip key={step} small icon="add" onClick={() => editDraft({ monthly: sim.monthly + step })}>
              {euros(step)}
            </Chip>
          ))}
        </div>
      </div>

      {reducible.length > 0 && (
        <div>
          <p className="t-body-strong">Où dépenser moins</p>
          <p className="t-caption text-muted">Tes plus gros postes hors charges fixes (moyenne de tes 12 derniers mois). L’argent économisé est investi, et ton train de vie visé baisse d’autant.</p>
          <div className="mt-2 divide-y divide-line">
            {reducible.map((c) => {
              const cat = cats.get(c.id);
              const cur = sim.cuts[c.id] ?? 0;
              return (
                <div key={c.id} className="py-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="t-body min-w-0 truncate">
                      {cat?.emoji} {cat?.name ?? 'Autre'}
                    </span>
                    <span className="num t-small shrink-0 text-secondary">
                      {cur > 0 ? <span className="text-success">−{euros(Math.round(c.monthly * cur))} · </span> : null}
                      {perMonth(c.monthly)}
                    </span>
                  </div>
                  <div className="mt-1.5 flex gap-1.5" role="group" aria-label={`Baisse : ${cat?.name ?? 'poste'}`}>
                    {CUT_STEPS.map((step) => (
                      <Chip key={step} small selected={Math.abs(cur - step) < 0.001} onClick={() => editDraft({ cuts: { ...sim.cuts, [c.id]: step } })}>
                        {step === 0 ? 'Pareil' : `−${pct(step)}`}
                      </Chip>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="rounded-lg p-4" style={{ background: 'var(--accent-soft)' }} aria-live="polite">
        <p className="t-body">
          Avec ce rythme : <strong className="font-semibold">{simYear === null ? 'hors de portée' : `${simYear}${age(simYear)}`}</strong>
          {gained !== null && gained > 0 && <span className="text-success"> · {span(gained)} plus tôt</span>}
          {gained !== null && gained < 0 && <span className="text-danger"> · {span(-gained)} plus tard</span>}
          {gained === 0 && baseYear !== null && <span className="text-secondary"> · comme aujourd’hui</span>}
        </p>
        <p className="t-small mt-1 text-secondary">
          {perMonth(simState.monthly)} investis{freed > 0 ? ` (dont ${euros(freed)} économisés)` : ''}
          {income > 0 ? ` · ${pct(simState.monthly / income)} de tes revenus` : ''} · revenu visé {perMonth(simState.annualSpending / 12)}
        </p>
      </div>

      {(simDirty || plan) && (
        <div className="flex flex-wrap gap-2">
          {simDirty && (
            <Button
              icon="check"
              onClick={() => {
                set({ plan: sim });
                setDraft(null);
                toast({ message: 'Plan gardé : il devient ta référence', tone: 'gold' });
              }}
            >
              Garder comme mon plan
            </Button>
          )}
          {simDirty && (
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Annuler
            </Button>
          )}
          {plan && !simDirty && (
            <Button
              variant="ghost"
              onClick={() => {
                set({ plan: null });
                setDraft(null);
              }}
            >
              Revenir à mon rythme actuel
            </Button>
          )}
        </div>
      )}
    </Card>
  );

  // ------------------------------------------------------------------ trajectoire
  const horizon = Math.max(f.goalYear ? f.goalYear - thisYear : 0, ...[base.months, simState.months].map((m) => (m === null ? 30 : Math.ceil(m / 12))));
  const years = Math.min(50, Math.max(10, horizon + 3));
  const baseSeries = capitalSeries(base.current, base.monthly, base.realRate, years);
  const simSeries = capitalSeries(simState.current, simState.monthly, simState.realRate, years);
  const sameAsBase = simState.monthly === base.monthly && simState.target === base.target;
  const goalIndex = f.goalYear && f.goalYear - thisYear <= years ? f.goalYear - thisYear : undefined;
  const chart = (
    <Card>
      <p className="t-headline">Trajectoire</p>
      <p className="t-small mb-3 text-secondary">Ton capital année après année, face au capital nécessaire{goalIndex !== undefined ? ` (repère : ${f.goalYear})` : ''}.</p>
      <LineChart
        series={[
          ...(sameAsBase ? [] : [{ id: 'sim', label: simDirty ? 'Simulation' : 'Ton plan', values: simSeries, look: 'primary' as const }]),
          { id: 'base', label: 'Rythme actuel', values: baseSeries, look: sameAsBase ? ('primary' as const) : ('secondary' as const) },
          { id: 'target', label: 'Capital nécessaire', values: simSeries.map(() => simState.target), look: 'dashed' as const },
        ]}
        xLabels={simSeries.map((_, i) => String(thisYear + i))}
        formatY={(v) => euros(v)}
        marker={goalIndex}
        ariaLabel={`Capital : ${euros(base.current)} aujourd’hui. Au rythme actuel, objectif ${baseYear ? `atteint en ${baseYear}` : 'hors de portée'}${sameAsBase ? '' : ` ; avec ${simDirty ? 'la simulation' : 'ton plan'}, ${simYear ? `en ${simYear}` : 'hors de portée'}`}.`}
      />
    </Card>
  );

  return (
    <Screen stack title="Indépendance financière" kicker="En euros d’aujourd’hui" mood="wealth" back="/patrimoine">
      <Reveal index={0}>{hero}</Reveal>
      <div className={wide ? 'mt-3 grid grid-cols-2 items-start gap-3' : 'mt-3 space-y-3'}>
        <div className="space-y-3">
          <Reveal index={1}>
            <Verdict state={active} label={plan ? 'Ton plan' : 'Ton rythme actuel'} goalYear={f.goalYear} age={age} onPickYear={() => setSheet('year')} />
          </Reveal>
          <Reveal index={2}>{chart}</Reveal>
        </div>
        <Reveal index={3}>{simulator}</Reveal>
      </div>

      <Reveal index={4}>
        <Disclosure title="Patrimoine pris en compte" summary={euros(base.current)}>
          <Card className="space-y-1">
            <p className="t-caption text-muted">Exclus ce qui ne financera pas ta liberté : épargne de précaution, apport immobilier, projet.</p>
            {w.summaries.map((s) => (
              <ToggleRow key={s.portfolio.id} label={s.portfolio.name} hint={`${s.portfolio.wrapper} · ${euros(s.value)}`} checked={!excluded.has(s.portfolio.id)} onChange={(on) => set({ excludedIds: on ? f.excludedIds.filter((id) => id !== s.portfolio.id) : [...f.excludedIds, s.portfolio.id] })} />
            ))}
            {savingsAccounts.map((a) => (
              <ToggleRow key={a.id} label={a.nickname ?? a.name} hint={`Compte épargne · ${euros(a.balance ?? 0)}`} checked={!excluded.has(a.id)} onChange={(on) => set({ excludedIds: on ? f.excludedIds.filter((id) => id !== a.id) : [...f.excludedIds, a.id] })} />
            ))}
            {w.summaries.length + savingsAccounts.length === 0 && <p className="t-small text-secondary">Aucun placement ni compte épargne pour l’instant.</p>}
          </Card>
        </Disclosure>
      </Reveal>

      <Reveal index={5}>
        <Disclosure title="Hypothèses" summary={`rendement ${bp(f.annualReturnBp)} · retrait ${bp(f.withdrawalBp)}`}>
          <Card className="space-y-2">
            <StepperRow label="Rendement annuel moyen" hint="Long terme, avant frais et inflation (actions mondiales ≈ 6 à 7 % ; prudent : 5 %)." value={f.annualReturnBp} step={25} min={0} max={1500} format={bp} onChange={(annualReturnBp) => set({ annualReturnBp })} />
            <StepperRow label="Inflation" value={f.inflationBp} step={25} min={0} max={1000} format={bp} onChange={(inflationBp) => set({ inflationBp })} />
            <StepperRow label="Frais des placements" hint="Moyenne pondérée (ETF ≈ 0,2 %)." value={f.feesBp} step={5} min={0} max={300} format={bp} onChange={(feesBp) => set({ feesBp })} />
            <StepperRow
              label="Taux de retrait"
              hint="Part du capital retirée chaque année. 4 % : règle classique pour 30 ans de retraite ; 3,5 % ou moins si l’indépendance arrive tôt."
              value={f.withdrawalBp}
              step={25}
              min={200}
              max={600}
              format={bp}
              onChange={(withdrawalBp) => set({ withdrawalBp })}
            />
            <Divider />
            <p className="t-small text-secondary">
              Impôt moyen sur tes retraits : <strong className="text-ink">{pct(base.tax, 1)}</strong>, déjà compté dans le capital nécessaire. Sur la plus-value seulement : PEA de plus de 5 ans 18,6 %, assurance-vie de plus de 8 ans 17,2 %, compte-titres et crypto 31,4 %, livrets 0 %.
            </p>
            <p className="t-caption text-muted">Rendement réel net retenu : {(base.realRate * 100).toFixed(2).replace('.', ',')} % par an. Une projection n’est pas une promesse : les marchés ne montent pas en ligne droite.</p>
          </Card>
        </Disclosure>
      </Reveal>

      <Sheet open={sheet === 'income'} onClose={() => setSheet(null)} title="Revenu visé">
        <p className="t-small mb-3 text-secondary">Ce que tes placements devront te verser chaque mois, en euros d’aujourd’hui. Le plus simple : ton train de vie actuel.</p>
        <ToggleRow
          label="Comme aujourd’hui"
          hint={`${perMonth(base.breakdown.annual / 12)} (${base.breakdown.source === 'history' ? 'tes dépenses des 12 derniers mois' : 'ton budget'})`}
          checked={f.annualSpendingOverride === null}
          onChange={(on) => set({ annualSpendingOverride: on ? null : Math.round(base.breakdown.annual / 1200) * 1200 })}
        />
        {f.annualSpendingOverride !== null && (
          <div className="mt-2">
            <MoneyField label="Revenu mensuel visé" value={Math.round(f.annualSpendingOverride / 12)} onCommit={(v) => set({ annualSpendingOverride: Math.abs(v ?? 0) * 12 })} />
          </div>
        )}
      </Sheet>

      <Sheet open={sheet === 'year'} onClose={() => setSheet(null)} title="Quand ?">
        <p className="t-small mb-3 text-secondary">L’année à partir de laquelle tu voudrais ne plus dépendre de ton salaire.</p>
        <StepperRow label="Année visée" value={f.goalYear ?? reachedYear(base.months) ?? thisYear + 20} min={thisYear + 1} max={thisYear + 60} format={(v) => `${v}${age(v)}`} onChange={(goalYear) => set({ goalYear })} />
        <StepperRow label="Ton année de naissance" hint="Facultatif : pour afficher ton âge." value={f.birthYear ?? 1995} min={1940} max={thisYear - 14} format={(v) => (f.birthYear ? String(v) : '—')} onChange={(birthYear) => set({ birthYear })} />
        {f.goalYear !== null && (
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => set({ goalYear: null })}>
            Pas d’année précise
          </Button>
        )}
      </Sheet>
    </Screen>
  );
}

/** Où j'en suis par rapport à l'objectif et, en retard, les trois façons de rattraper. */
function Verdict({ state, label, goalYear, age, onPickYear }: { state: FireState; label: string; goalYear: number | null; age: (y: number) => string; onPickYear: () => void }) {
  const year = reachedYear(state.months);
  if (state.months === 0) {
    return (
      <Card tone="gold">
        <p className="t-headline">C’est atteint 🎉</p>
        <p className="t-small mt-1 text-secondary">Ton capital peut déjà financer le revenu visé, au taux de retrait choisi.</p>
      </Card>
    );
  }
  const head = (
    <p className="t-body">
      {label} ({perMonth(state.monthly)} investis) :{' '}
      {year === null ? (
        <strong className="font-semibold">objectif hors de portée</strong>
      ) : (
        <strong className="font-semibold">
          indépendant en {year}
          {age(year)}
        </strong>
      )}
    </p>
  );
  if (goalYear === null) {
    return (
      <Card className="space-y-3">
        {head}
        <Button variant="secondary" size="sm" onClick={onPickYear}>
          Choisir une année pour savoir quoi faire
        </Button>
      </Card>
    );
  }
  if (year !== null && year <= goalYear) {
    const ahead = goalYear - year;
    return (
      <Card tone="success" className="space-y-1">
        {head}
        <p className="t-small text-success">{ahead > 0 ? `${yearsWord(ahead)} d’avance sur ton objectif. Continue comme ça.` : 'Pile dans les temps. Continue comme ça.'}</p>
      </Card>
    );
  }
  const months = monthsUntil(goalYear);
  const need = requiredMonthly(state.current, state.target, state.realRate, months);
  const cut = state.spendingAuto ? spendingCutNeeded(state, state.monthly, state.annualSpending, months) : 0;
  const affordable = affordableSpending(state, state.monthly, months);
  return (
    <Card className="space-y-3">
      {head}
      <p className="t-small text-secondary">
        {year === null ? '' : `${yearsWord(year - goalYear)} après ton objectif. `}Pour y être en {goalYear}, au choix :
      </p>
      <Group>
        {need !== null && <Row icon="trend-up" iconTone="accent" title={`Investir ${perMonth(need)}`} subtitle={`${euros(need - state.monthly)} de plus chaque mois`} />}
        {cut > 0 && <Row icon="wallet" iconTone="success" title={`Dépenser ${euros(cut)} de moins par mois`} subtitle="Investis, et un revenu visé plus léger" />}
        <Row icon="flag" iconTone="gold" title={`Viser ${perMonth(affordable / 12)}`} subtitle={`Ce que ton rythme permettra en ${goalYear}`} />
      </Group>
      <p className="t-caption text-muted">Ou un mélange des trois : essaie-le dans « Simule ton rythme ».</p>
    </Card>
  );
}
