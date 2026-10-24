import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { updateSettings } from '../../db/seed';
import type { FireSettings } from '../../db/types';
import { compoundSchedule, computeFire, cutsMonthly, effectiveRate, milestoneReached, monthlyNeeded, monthsToReach, passiveMonthly, reducibleSpending } from '../../domain/fire';
import { useRecurring } from '../../domain/useInsights';
import { useWealth } from '../../domain/useWealth';
import { useCategoryMap, useSettings } from '../../hooks';
import { todayISO } from '../../lib/dates';
import { formatCents } from '../../ui/money';
import { StackedColumns } from '../../ui/charts';
import { Button, Card, Chip, Disclosure, Divider, MoneyField, ProgressBar, Reveal, Rolling, Sheet, StepperRow, ToggleRow, toast, useTheme } from '../../ui/index';
import { Screen } from '../../ui/Screen';
import { Tilt } from '../../ui/Tilt';
import { useBreakpoint } from '../../ui/responsive';
import { plannedSavings } from '../../domain/defaults';

/**
 * Simulateur d'intérêts composés, branché sur tes données : capital de départ, épargne mensuelle,
 * horizon et taux (comme les calculatrices usuelles), puis ce que ça change pour toi — revenu que ce
 * capital te verserait, date d'indépendance financière, épargne nécessaire, épargne à trouver dans tes
 * dépenses. Capital, épargne et horizon vivent dans l'adresse (partageables, retour arrière fidèle) ;
 * rendement, frais, inflation et taux de retrait sont tes hypothèses enregistrées.
 */

const pct = (v: number, digits = 0) => `${(v * 100).toLocaleString('fr-FR', { maximumFractionDigits: digits })} %`;
const bp = (v: number) => `${(v / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`;
const euros = (cents: number) => formatCents(cents, { short: true });
/** À l'euro près, comme une calculatrice : « 67 113 € ». */
const full = (cents: number) => formatCents(Math.round(cents / 100) * 100, { compact: true });
const perMonth = (cents: number) => `${euros(cents)}/mois`;
const CUT_STEPS = [0, 0.1, 0.25, 0.5] as const;
const RATE_PRESETS = [
  { bp: 300, label: 'Prudent' },
  { bp: 500, label: 'Équilibré' },
  { bp: 700, label: 'Actions' },
] as const;

/** Nombre entier lu dans l'adresse (null s'il manque ou n'est pas valide). */
function intParam(params: URLSearchParams, key: string): number | null {
  const v = params.get(key);
  if (v === null || !/^\d+$/.test(v)) return null;
  return Number(v);
}

function yearsWord(n: number): string {
  return `${n} an${n > 1 ? 's' : ''}`;
}

export default function FirePage() {
  const settings = useSettings();
  const cats = useCategoryMap();
  const w = useWealth();
  const t = useTheme();
  const { txs } = useRecurring();
  const today = todayISO();
  const wide = useBreakpoint() === 'expanded';
  const f = settings.fire;
  const setFire = (patch: Partial<FireSettings>) => void updateSettings({ fire: { ...f, ...patch } });
  const [sheet, setSheet] = useState<'spending' | null>(null);
  const [cuts, setCuts] = useState<Record<string, number>>({});

  // Tes données : capital pris en compte, rythme d'épargne actuel, dépenses, impôt sur les retraits.
  const savingsAccounts = useMemo(() => w.accounts.filter((a) => a.kind === 'savings' && !a.hidden), [w.accounts]);
  const excluded = new Set(f.excludedIds);
  const myMonthly = plannedSavings(settings);
  const me = useMemo(
    () => computeFire({ summaries: w.summaries, savingsAccounts, txs, cats, settings, today, monthly: myMonthly }),
    [w.summaries, savingsAccounts, txs, cats, settings, today, myMonthly],
  );
  const reducible = useMemo(() => reducibleSpending(me.breakdown, cats, 5), [me.breakdown, cats]);

  // Paramètres de la simulation : l'adresse d'abord, sinon tes données (arrondies à l'euro).
  const [params, setParams] = useSearchParams();
  const capital = (intParam(params, 'capital') ?? Math.round(me.current / 100)) * 100;
  const savings = (intParam(params, 'epargne') ?? Math.round(myMonthly / 100)) * 100;
  const horizon = Math.min(60, Math.max(1, intParam(params, 'horizon') ?? 20));
  const real = params.get('reel') === '1';
  const growthBp = Math.min(1000, intParam(params, 'hausse') ?? 0);
  const setParam = (key: string, value: number | boolean | null) => {
    const next = new URLSearchParams(params);
    if (value === null || value === false) next.delete(key);
    else next.set(key, value === true ? '1' : String(value));
    setParams(next, { replace: true });
  };

  // Paliers de l'indépendance (sur tes vraies données) : chacun fêté une seule fois.
  const milestone = milestoneReached(me.progress);
  useEffect(() => {
    if (milestone > f.lastMilestone) {
      toast({ message: milestone >= 1 ? 'Indépendance financière atteinte 🎉' : `Palier franchi : ${pct(milestone)} de ton indépendance`, tone: 'gold' });
      setFire({ lastMilestone: milestone });
    }
  }, [milestone]); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------------ calcul
  const found = cutsMonthly(reducible, cuts);
  const monthly = savings + found;
  const growth = growthBp / 10000;
  const shownRate = effectiveRate(f.annualReturnBp, f.feesBp, real ? f.inflationBp : null);
  const schedule = useMemo(() => compoundSchedule({ initial: capital, monthly, annualRate: shownRate, savingsGrowth: growth }, horizon), [capital, monthly, shownRate, growth, horizon]);
  const end = schedule[schedule.length - 1]!;
  const thisYear = new Date().getFullYear();

  // Indépendance : toujours en euros d'aujourd'hui (rendement réel), quel que soit l'affichage.
  const realParams = { initial: capital, monthly, annualRate: effectiveRate(f.annualReturnBp, f.feesBp, f.inflationBp), savingsGrowth: growth };
  const endToday = real ? end.total : compoundSchedule(realParams, horizon)[horizon]!.total;
  const passive = passiveMonthly(endToday, f.withdrawalBp, me.tax);
  const spendingMonthly = Math.round(me.annualSpending / 12);
  const fiMonths = me.target > 0 ? monthsToReach(realParams, me.target) : null;
  const fiYear = fiMonths === null ? null : new Date(thisYear, new Date().getMonth() + fiMonths, 1).getFullYear();
  const needed = me.target > 0 ? monthlyNeeded({ initial: capital, annualRate: realParams.annualRate, savingsGrowth: growth }, me.target, horizon * 12) : 0;
  const age = (year: number) => (f.birthYear ? ` (à ${year - f.birthYear} ans)` : '');

  // ------------------------------------------------------------------ paramètres
  const inputs = (
    <Card className="space-y-4">
      <div>
        <MoneyField label="Capital de départ" value={capital} onCommit={(v) => setParam('capital', Math.max(0, Math.round((v ?? 0) / 100)))} />
        {Math.abs(capital - me.current) >= 100 && (
          <div className="mt-2">
            <Chip small icon="diamond" onClick={() => setParam('capital', null)}>
              Mon patrimoine placé : {euros(me.current)}
            </Chip>
          </div>
        )}
      </div>
      <div>
        <MoneyField label="Épargne mensuelle" value={savings} onCommit={(v) => setParam('epargne', Math.max(0, Math.round((v ?? 0) / 100)))} />
        {Math.abs(savings - myMonthly) >= 100 && (
          <div className="mt-2">
            <Chip small icon="repeat" onClick={() => setParam('epargne', null)}>
              Mon rythme actuel : {euros(myMonthly)}
            </Chip>
          </div>
        )}
      </div>
      <div>
        <StepperRow label="Horizon de placement" value={horizon} min={1} max={60} format={(v) => `${yearsWord(v)} · ${thisYear + v}`} onChange={(v) => setParam('horizon', v === 20 ? null : v)} />
        <div className="mt-1 flex flex-wrap gap-1.5">
          {[10, 20, 30].map((y) => (
            <Chip key={y} small selected={horizon === y} onClick={() => setParam('horizon', y === 20 ? null : y)}>
              {y} ans
            </Chip>
          ))}
        </div>
      </div>
      <div>
        <StepperRow label="Taux de rendement annuel" hint="Moyenne long terme, avant frais." value={f.annualReturnBp} step={25} min={0} max={1500} format={bp} onChange={(annualReturnBp) => setFire({ annualReturnBp })} />
        <div className="mt-1 flex flex-wrap gap-1.5">
          {RATE_PRESETS.map((r) => (
            <Chip key={r.bp} small selected={f.annualReturnBp === r.bp} onClick={() => setFire({ annualReturnBp: r.bp })}>
              {r.label} {bp(r.bp)}
            </Chip>
          ))}
        </div>
      </div>
      <Disclosure title="Options" summary={[real ? 'euros d’aujourd’hui' : null, f.feesBp ? `frais ${bp(f.feesBp)}` : null, growthBp ? `+${bp(growthBp)}/an` : null].filter(Boolean).join(' · ')}>
        <div className="space-y-1">
          <ToggleRow label="En euros d’aujourd’hui" hint={`Retire l’inflation (${bp(f.inflationBp)} par an) : ce que ce capital vaudra vraiment.`} checked={real} onChange={(on) => setParam('reel', on)} />
          <StepperRow label="Frais annuels" hint="Frais des fonds et de l’enveloppe (ETF ≈ 0,2 %)." value={f.feesBp} step={5} min={0} max={300} format={bp} onChange={(feesBp) => setFire({ feesBp })} />
          <StepperRow label="Hausse de l’épargne chaque année" hint="Si tes versements suivent tes augmentations." value={growthBp} step={50} min={0} max={1000} format={(v) => (v ? `+${bp(v)}` : 'aucune')} onChange={(v) => setParam('hausse', v || null)} />
          <StepperRow label="Inflation" value={f.inflationBp} step={25} min={0} max={1000} format={bp} onChange={(inflationBp) => setFire({ inflationBp })} />
        </div>
      </Disclosure>
    </Card>
  );

  // ------------------------------------------------------------------ résultat (comme une calculatrice)
  const result = (
    <Card level="raised" glow className="space-y-4">
      <div>
        <p className="t-label text-muted">Capital final</p>
        <p className="num t-hero mt-1">
          <Rolling mount text={full(end.total)} />
        </p>
        <p className="t-small text-secondary">
          après {yearsWord(horizon)}, en {thisYear + horizon}
          {real ? ' · en euros d’aujourd’hui' : ''}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="t-caption flex items-center gap-1.5 text-secondary">
            <span aria-hidden className="h-2.5 w-2.5 rounded-[3px]" style={{ background: t.accent }} />
            Versements
          </p>
          <p className="num t-number mt-0.5">{full(end.contributions)}</p>
        </div>
        <div>
          <p className="t-caption flex items-center gap-1.5 text-secondary">
            <span aria-hidden className="h-2.5 w-2.5 rounded-[3px]" style={{ background: t.gold }} />
            Intérêts
          </p>
          <p className="num t-number mt-0.5">{full(end.interest)}</p>
        </div>
      </div>
      <StackedColumns
        labels={schedule.map((y) => String(thisYear + y.year))}
        layers={[
          { id: 'contrib', label: 'Versements', color: t.accent, values: schedule.map((y) => y.contributions) },
          { id: 'interest', label: 'Intérêts', color: t.gold, values: schedule.map((y) => Math.max(0, y.interest)) },
        ]}
        reference={real && me.target > 0 ? { label: 'Capital pour vivre de tes placements', value: me.target } : null}
        legend={false}
        formatY={euros}
        ariaLabel={`Capital année par année : ${full(end.total)} en ${thisYear + horizon}, dont ${full(end.contributions)} de versements et ${full(end.interest)} d’intérêts.`}
      />
      <p className="t-caption text-muted">
        {end.total > 0 && end.interest > 0 ? `Les intérêts font ${pct(end.interest / end.total)} du capital final. ` : ''}
        Taux net retenu : {(shownRate * 100).toFixed(2).replace('.', ',')} % par an{f.feesBp ? ', frais déduits' : ''}{real ? ', inflation déduite' : ''}.
      </p>
    </Card>
  );

  // ------------------------------------------------------------------ vivre de ce capital (tes données)
  const freedom = (
    <Card className="space-y-3">
      <p className="t-headline">Vivre de ce capital</p>
      <p className="t-body">
        Il te verserait <strong className="font-semibold">{perMonth(passive)}</strong> à vie
        <span className="text-secondary"> (en euros d’aujourd’hui, retrait de {bp(f.withdrawalBp)} par an{me.tax > 0 ? ', impôts déduits' : ''})</span>.
      </p>
      <div>
        <ProgressBar value={passive} max={Math.max(1, spendingMonthly)} tone="gold" height={8} label={`${pct(Math.min(1, passive / Math.max(1, spendingMonthly)))} de tes dépenses`} />
        <p className="t-small mt-1.5 text-secondary">
          Soit {pct(Math.min(9.99, passive / Math.max(1, spendingMonthly)))} de ton train de vie :{' '}
          <button type="button" className="text-accent underline decoration-dotted underline-offset-4" onClick={() => setSheet('spending')}>
            {perMonth(spendingMonthly)}
          </button>
          {me.spendingAuto ? ' (tes dépenses réelles)' : ' (montant choisi)'}.
        </p>
      </div>
      <Divider />
      {fiMonths === 0 ? (
        <p className="t-body text-gold">Ton capital suffit déjà à financer ce train de vie. 🎉</p>
      ) : (
        <>
          <p className="t-body">
            Indépendance financière avec ces paramètres : <strong className="font-semibold">{fiYear === null ? 'hors de portée' : `${fiYear}${age(fiYear)}`}</strong>
          </p>
          <p className="t-caption text-muted">Il faut {full(me.target)} de capital (en euros d’aujourd’hui) pour vivre de tes placements.</p>
          {fiYear !== null && fiYear > thisYear + horizon && needed > monthly && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="t-small text-secondary">
                Pour y être en {thisYear + horizon} : épargner <strong className="text-ink">{perMonth(needed)}</strong>
              </span>
              <Button size="sm" variant="secondary" onClick={() => setParam('epargne', Math.round(Math.max(0, needed - found) / 100))}>
                Essayer
              </Button>
            </div>
          )}
          {fiYear !== null && fiYear <= thisYear + horizon && <p className="t-small text-success">Atteinte avant la fin de ton horizon de {yearsWord(horizon)}.</p>}
        </>
      )}
    </Card>
  );

  // ------------------------------------------------------------------ épargne à trouver dans tes dépenses
  const finder =
    reducible.length > 0 ? (
      <Card className="space-y-2">
        <p className="t-headline">Trouver de l’épargne</p>
        <p className="t-small text-secondary">Tes plus gros postes hors charges fixes (moyenne de tes 12 derniers mois). Ce que tu réduis s’ajoute à l’épargne mensuelle de la simulation.</p>
        <div className="divide-y divide-line">
          {reducible.map((c) => {
            const cat = cats.get(c.id);
            const cur = cuts[c.id] ?? 0;
            return (
              <div key={c.id} className="py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="t-body min-w-0 truncate">
                    {cat?.emoji} {cat?.name ?? 'Autre'}
                  </span>
                  <span className="num t-small shrink-0 text-secondary">
                    {cur > 0 ? <span className="text-success">+{euros(Math.round(c.monthly * cur))} · </span> : null}
                    {perMonth(c.monthly)}
                  </span>
                </div>
                <div className="mt-1.5 flex gap-1.5" role="group" aria-label={`Baisse : ${cat?.name ?? 'poste'}`}>
                  {CUT_STEPS.map((step) => (
                    <Chip key={step} small selected={Math.abs(cur - step) < 0.001} onClick={() => setCuts({ ...cuts, [c.id]: step })}>
                      {step === 0 ? 'Pareil' : `−${pct(step)}`}
                    </Chip>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        {found > 0 && (
          <p className="t-small text-secondary">
            <strong className="text-success">+{perMonth(found)}</strong> trouvés : la simulation épargne {perMonth(monthly)}.
          </p>
        )}
      </Card>
    ) : null;

  // ------------------------------------------------------------------ tableau
  const table = (
    <Disclosure title="Année par année" summary={`${schedule.length - 1} lignes`}>
      <Card className="overflow-x-auto p-0">
        <table className="t-small w-full min-w-[300px] text-right">
          <thead className="text-muted">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium">Année</th>
              <th scope="col" className="px-3 py-2 font-medium">Versements</th>
              <th scope="col" className="px-3 py-2 font-medium">Intérêts</th>
              <th scope="col" className="px-3 py-2 font-medium">Capital</th>
            </tr>
          </thead>
          <tbody className="num">
            {schedule.slice(1).map((y) => (
              <tr key={y.year} className="border-t border-line">
                <td className="px-3 py-1.5 text-left text-secondary">{thisYear + y.year}</td>
                <td className="px-3 py-1.5">{euros(y.contributions)}</td>
                <td className="px-3 py-1.5">{euros(y.interest)}</td>
                <td className="px-3 py-1.5 font-semibold">{euros(y.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </Disclosure>
  );

  return (
    <Screen stack title="Indépendance financière" kicker="Simulateur d’intérêts composés" mood="wealth" back="/patrimoine">
      <div className={wide ? 'grid grid-cols-[minmax(0,5fr)_minmax(0,7fr)] items-start gap-3' : 'space-y-3'}>
        <div className="space-y-3">
          <Reveal index={0}>{inputs}</Reveal>
          {wide && finder && <Reveal index={2}>{finder}</Reveal>}
        </div>
        <div className="space-y-3">
          <Reveal index={1}>
            <Tilt>{result}</Tilt>
          </Reveal>
          <Reveal index={2}>{freedom}</Reveal>
        </div>
      </div>
      {!wide && finder && (
        <Reveal index={3} className="mt-3">
          {finder}
        </Reveal>
      )}

      <Reveal index={4}>{table}</Reveal>

      <Reveal index={5}>
        <Disclosure title="Vivre de ses placements : réglages" summary={`retrait ${bp(f.withdrawalBp)} · ${euros(me.current)} pris en compte`}>
          <Card className="space-y-1">
            <StepperRow
              label="Taux de retrait"
              hint="Part du capital retirée chaque année. 4 % : règle classique pour 30 ans de retraite ; 3,5 % ou moins si l’indépendance arrive tôt."
              value={f.withdrawalBp}
              step={25}
              min={200}
              max={600}
              format={bp}
              onChange={(withdrawalBp) => setFire({ withdrawalBp })}
            />
            <StepperRow label="Ton année de naissance" hint="Facultatif : pour afficher ton âge." value={f.birthYear ?? 1995} min={1940} max={thisYear - 14} format={(v) => (f.birthYear ? String(v) : '—')} onChange={(birthYear) => setFire({ birthYear })} />
            <p className="t-small py-2 text-secondary">
              Impôt moyen sur tes retraits : <strong className="text-ink">{pct(me.tax, 1)}</strong> (sur la plus-value : PEA de plus de 5 ans 18,6 %, assurance-vie de plus de 8 ans 17,2 %, compte-titres et crypto 31,4 %, livrets 0 %).
            </p>
            <Divider />
            <p className="t-caption pt-2 text-muted">Patrimoine pris en compte (exclus ce qui ne financera pas ta liberté : épargne de précaution, apport, projet) :</p>
            {w.summaries.map((s) => (
              <ToggleRow key={s.portfolio.id} label={s.portfolio.name} hint={`${s.portfolio.wrapper} · ${euros(s.value)}`} checked={!excluded.has(s.portfolio.id)} onChange={(on) => setFire({ excludedIds: on ? f.excludedIds.filter((id) => id !== s.portfolio.id) : [...f.excludedIds, s.portfolio.id] })} />
            ))}
            {savingsAccounts.map((a) => (
              <ToggleRow key={a.id} label={a.nickname ?? a.name} hint={`Compte épargne · ${euros(a.balance ?? 0)}`} checked={!excluded.has(a.id)} onChange={(on) => setFire({ excludedIds: on ? f.excludedIds.filter((id) => id !== a.id) : [...f.excludedIds, a.id] })} />
            ))}
            {w.summaries.length + savingsAccounts.length === 0 && <p className="t-small text-secondary">Aucun placement ni compte épargne pour l’instant.</p>}
          </Card>
        </Disclosure>
      </Reveal>

      <p className="t-caption mt-6 text-center text-muted">
        Taux annuel effectif ; versements en fin de mois au taux mensuel équivalent. Simulation indicative : les marchés ne montent pas en ligne droite.
      </p>

      <Sheet open={sheet === 'spending'} onClose={() => setSheet(null)} title="Train de vie visé">
        <p className="t-small mb-3 text-secondary">Ce que tes placements devront te verser chaque mois, en euros d’aujourd’hui. Le plus simple : tes dépenses actuelles.</p>
        <ToggleRow
          label="Mes dépenses actuelles"
          hint={`${perMonth(me.breakdown.annual / 12)} (${me.breakdown.source === 'history' ? 'moyenne de tes 12 derniers mois' : 'ton budget'})`}
          checked={f.annualSpendingOverride === null}
          onChange={(on) => setFire({ annualSpendingOverride: on ? null : Math.round(me.breakdown.annual / 1200) * 1200 })}
        />
        {f.annualSpendingOverride !== null && (
          <div className="mt-2">
            <MoneyField label="Revenu mensuel visé" value={Math.round(f.annualSpendingOverride / 12)} onCommit={(v) => setFire({ annualSpendingOverride: Math.abs(v ?? 0) * 12 })} />
          </div>
        )}
      </Sheet>
    </Screen>
  );
}
