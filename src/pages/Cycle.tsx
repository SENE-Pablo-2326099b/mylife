import { refreshEverything } from '../sync/refresh';
import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSearchParams } from 'react-router-dom';
import { db } from '../db/db';
import type { Transaction } from '../db/types';
import { dailySeries } from '../domain/budget';
import { categoryBreakdown, summarize } from '../domain/cycleStats';
import { totalFixed } from '../domain/defaults';
import { cycleEnvelope, payDates, resolveCycle } from '../domain/budgetEngine';
import { useBudgetContext } from '../domain/useBudget';
import { personBalances } from '../domain/people';
import { useAccounts, useCategoryMap, useSettings } from '../hooks';
import { addDays, cycleLength, formatCycle, formatShort, todayISO, type Cycle, type ISODate } from '../lib/dates';
import { formatCents } from '../lib/money';
import { AllocationBar, ColumnChart, LineChart, SpendCalendar } from '../ui/charts';
import { seriesColors } from '../ui/themes';
import { TxRow } from '../components/TxRow';
import { biggestExpenses, cycleHeatmap, cycleHistory, topMerchants, weekdayProfile } from '../domain/cycleInsights';
import { useRecentTransactions } from '../domain/recentTransactions';
import { Card, Disclosure, EmptyState, Group, IconButton, Metric, Money, ProgressBar, Reveal, Row, SectionTitle, Tap, useTheme } from '../ui/index';
import { Screen } from '../ui/Screen';
import { HeaderActions } from '../components/HeaderActions';

const NO_TX: Transaction[] = [];

/** Cycle décalé de n (paies en avance comprises, comme le budget du jour). */
function shiftCycle(c: Cycle, n: number, payday: number, pays: readonly ISODate[]): Cycle {
  let cur = c;
  for (let i = 0; i < Math.abs(n); i++) cur = resolveCycle(n < 0 ? addDays(cur.start, -1) : addDays(cur.end, 1), payday, pays);
  return cur;
}

const euros = (v: number) => formatCents(v, { short: true });
const WEEKDAY_LONG = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const WEEKDAY_SHORT = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
/** Libellé court d'un cycle : son mois de départ (« oct. »). */
const cycleMonth = (c: Cycle) => MONTHS[Number(c.start.slice(5, 7)) - 1] ?? c.start;

export default function CyclePage() {
  const settings = useSettings();
  const cats = useCategoryMap();
  const [params, setParams] = useSearchParams();
  const offset = Math.min(0, parseInt(params.get('n') ?? '0', 10) || 0);
  const today = todayISO();
  const credits = useLiveQuery(() => db.transactions.filter((t) => t.amount > 0 && t.categoryId !== null).toArray(), []) ?? NO_TX;
  const pays = useMemo(() => payDates(credits, cats, settings), [credits, cats, settings]);
  const current = resolveCycle(today, settings.payday, pays);
  const cycle = shiftCycle(current, offset, settings.payday, pays);
  const prev = shiftCycle(cycle, -1, settings.payday, pays);
  const isCurrent = offset === 0;
  const until = isCurrent ? today : cycle.end;
  const context = useBudgetContext();

  const txs = useLiveQuery(() => db.transactions.where('date').between(prev.start, cycle.end, true, true).toArray(), [prev.start, cycle.end]) ?? NO_TX;
  const envelope = cycleEnvelope({ txs, cats, settings, ...context }, cycle).total;
  const refunds = useLiveQuery(() => db.transactions.where('categoryId').equals('remboursements').toArray(), []) ?? NO_TX;

  const { lines, summary, prevSummary, prevSameStage, chart } = useMemo(() => {
    const lines = categoryBreakdown(txs, cats, cycle, prev);
    const summary = summarize(txs, cats, cycle, until);
    const prevSummary = summarize(txs, cats, prev);
    const stage = addDays(prev.start, summary.daysElapsed - 1);
    const prevSameStage = summarize(txs, cats, prev, stage < prev.end ? stage : prev.end);
    const cur = dailySeries(txs, cats, cycle, envelope, until);
    const old = dailySeries(txs, cats, prev, envelope);
    const len = Math.max(cycleLength(cycle), cycleLength(prev));
    const curLen = cycleLength(cycle);
    const labels: string[] = [];
    const c: (number | null)[] = [];
    const p: (number | null)[] = [];
    const ideal: number[] = [];
    for (let i = 0; i < len; i++) {
      labels.push(i < curLen ? formatShort(addDays(cycle.start, i)) : `J${i + 1}`);
      c.push(cur[i]?.cumulative ?? null);
      p.push(old[i]?.cumulative ?? null);
      ideal.push(Math.round((envelope * Math.min(i + 1, curLen)) / curLen));
    }
    return { lines, summary, prevSummary, prevSameStage, chart: { labels, c, p, ideal } };
  }, [txs, cats, cycle.start, cycle.end, prev.start, prev.end, until, envelope]); // eslint-disable-line react-hooks/exhaustive-deps

  const people = useMemo(() => personBalances(refunds), [refunds]);
  const t = useTheme();
  const accounts = useAccounts();
  const accMap = new Map(accounts.map((a) => [a.id, a]));

  // Au-delà du total : jour par jour, habitudes, cycle après cycle, où part l'argent.
  const recent = useRecentTransactions() ?? NO_TX;
  const insights = useMemo(() => {
    const heat = cycleHeatmap(txs, cats, cycle, envelope, until);
    const history = cycleHistory(
      recent,
      cats,
      [5, 4, 3, 2, 1, 0].map((n) => shiftCycle(cycle, -n, settings.payday, pays)),
      (c) => cycleEnvelope({ txs: recent, cats, settings, ...context }, c).total,
    ).filter((h) => h.spent > 0 || h.cycle.start === cycle.start);
    const habitStart = shiftCycle(cycle, -2, settings.payday, pays).start;
    const weekdays = weekdayProfile(recent, cats, habitStart, until);
    return {
      heat,
      history,
      weekdays,
      merchants: topMerchants(txs, cats, cycle.start, until),
      biggest: biggestExpenses(txs, cats, cycle.start, until),
    };
  }, [txs, recent, cats, cycle.start, cycle.end, until, envelope, settings, pays, context]); // eslint-disable-line react-hooks/exhaustive-deps
  const busiest = insights.weekdays.reduce((m, d) => (d.average > m.average ? d : m), insights.weekdays[0]!);
  const calmest = insights.weekdays.reduce((m, d) => (d.average < m.average ? d : m), insights.weekdays[0]!);
  const historyAvg = insights.history.length ? Math.round(insights.history.reduce((s2, h) => s2 + h.spent, 0) / insights.history.length) : 0;
  const daysLeft = Math.max(0, summary.length - summary.daysElapsed);
  const perDay = summary.daysElapsed > 0 ? Math.round(summary.variable / summary.daysElapsed) : 0;
  const projected = summary.variable + perDay * daysLeft;
  const leftPerDay = daysLeft > 0 ? Math.max(0, Math.floor((envelope - summary.variable) / daysLeft)) : 0;
  const colors = seriesColors(t);
  const shares = lines.filter((l) => l.spent > 0).slice(0, 6);
  const others = lines.filter((l) => l.spent > 0).slice(6).reduce((s2, l) => s2 + l.spent, 0);
  const delta = summary.variable - prevSameStage.variable;
  const expectedNow = Math.round((envelope * summary.daysElapsed) / summary.length);
  const go = (n: number) => setParams(n === 0 ? {} : { n: String(n) }, { replace: true });
  const periodParam = isCurrent ? '' : offset === -1 ? '&periode=previous' : '&periode=all';
  const over = summary.variable > envelope;
  const ahead = summary.variable > expectedNow;
  const maxSpent = Math.max(1, ...lines.map((l) => Math.max(l.spent, l.category?.target ?? 0)));

  return (
    <Screen
      title={isCurrent ? 'Ce cycle' : 'Cycle passé'}
      kicker={`Budget · ${formatCycle(cycle)}`}
      mood="budget"
      onRefresh={refreshEverything}
      right={
        <>
          <IconButton icon="chevron-back" label="Cycle précédent" glass onClick={() => go(offset - 1)} />
          {isCurrent ? <HeaderActions /> : <IconButton icon="chevron-forward" label="Cycle suivant" glass onClick={() => go(offset + 1)} />}
        </>
      }
    >
      <Reveal index={0}>
        <Card level="raised" glow={!over && !ahead} tone={over ? 'danger' : 'neutral'}>
          <p className="t-label text-muted">Vie courante</p>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
            <Money cents={summary.variable} className={`text-[30px] tracking-[-0.8px] ${over ? 'text-danger' : ''}`} />
            <span className="t-body text-secondary">sur {formatCents(envelope)}</span>
          </p>
          <div className="mt-3">
            <ProgressBar value={summary.variable} max={Math.max(envelope, summary.variable)} marker={isCurrent ? expectedNow : null} tone={over ? 'danger' : ahead ? 'warning' : 'success'} label={`${formatCents(summary.variable)} dépensés sur ${formatCents(envelope)}`} />
          </div>
          <p className="t-small mt-2 text-secondary">
            {over
              ? `Enveloppe dépassée de ${formatCents(summary.variable - envelope)}.`
              : isCurrent
                ? `${ahead ? 'Au-dessus' : 'En dessous'} de la trajectoire : ${formatCents(expectedNow)} prévus au jour ${summary.daysElapsed}.`
                : `Reste ${formatCents(envelope - summary.variable)} non dépensés.`}
          </p>
          <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3">
            <Metric label="Par jour" value={euros(perDay)} hint="en moyenne" />
            {isCurrent ? <Metric label="Reste / jour" value={euros(leftPerDay)} hint={`${daysLeft} j restants`} /> : <Metric label="Jours" value={String(summary.length)} hint="dans le cycle" />}
            <Metric label={isCurrent ? 'Fin projetée' : 'Écart'} value={euros(isCurrent ? projected : summary.variable - envelope)} tone={(isCurrent ? projected : summary.variable) > envelope ? 'danger' : 'success'} hint={isCurrent ? 'à ce rythme' : summary.variable > envelope ? 'au-dessus' : 'en dessous'} />
          </div>
        </Card>
      </Reveal>

      <Reveal index={1}>
        <SectionTitle action={<span className="t-caption text-muted">touche un jour</span>}>Jour par jour</SectionTitle>
        <Card>
          <SpendCalendar days={insights.heat} today={today} format={euros} label={`Dépenses de vie courante jour par jour, du ${formatShort(cycle.start)} au ${formatShort(cycle.end)}`} />
        </Card>
      </Reveal>

      <Reveal index={1}>
        <SectionTitle>Dépenses cumulées</SectionTitle>
        <Card>
          <LineChart
            series={[
              { id: 'cur', label: 'Ce cycle', values: chart.c, look: 'primary' },
              { id: 'prev', label: 'Cycle précédent', values: chart.p, look: 'secondary' },
              { id: 'ideal', label: 'Trajectoire idéale', values: chart.ideal, look: 'dashed' },
            ]}
            xLabels={chart.labels}
            formatY={euros}
            ariaLabel={`Dépenses courantes cumulées : ${formatCents(summary.variable)} au jour ${summary.daysElapsed}, trajectoire idéale ${formatCents(expectedNow)}.`}
          />
          <Disclosure title="Voir les données">
            <div className="max-h-64 overflow-auto">
              <table className="t-small w-full text-right">
                <thead className="text-muted">
                  <tr>
                    <th className="text-left font-medium">Jour</th>
                    <th className="font-medium">Ce cycle</th>
                    <th className="font-medium">Précédent</th>
                    <th className="font-medium">Idéal</th>
                  </tr>
                </thead>
                <tbody className="num">
                  {chart.labels.map((l, i) => (
                    <tr key={i}>
                      <td className="text-left text-secondary">{l}</td>
                      <td>{chart.c[i] != null ? euros(chart.c[i] as number) : '–'}</td>
                      <td>{chart.p[i] != null ? euros(chart.p[i] as number) : '–'}</td>
                      <td>{euros(chart.ideal[i] as number)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Disclosure>
        </Card>
      </Reveal>

      <Reveal index={2}>
        <SectionTitle action={<span className="t-caption text-muted">vs cycle précédent</span>}>Par catégorie</SectionTitle>
        {lines.length === 0 ? (
          <Card>
            <EmptyState icon="pie" title="Aucune dépense sur ce cycle" />
          </Card>
        ) : (
          <>
          <Card className="mb-2">
            <AllocationBar
              items={[
                ...shares.map((l, i) => ({ label: `${l.category?.emoji ?? ''} ${l.category?.name ?? l.id}`.trim(), value: l.spent, color: colors[i % colors.length] as string })),
                ...(others > 0 ? [{ label: 'Autres', value: others, color: 'var(--text-muted)' }] : []),
              ]}
              format={euros}
              label="Répartition des dépenses du cycle par catégorie"
            />
          </Card>
          <Group>
            {lines.map((l) => {
              const target = l.category?.target ?? null;
              const isOver = target !== null && l.spent > target;
              const diff = l.spent - l.previous;
              // Or : objectif tenu sur un cycle terminé (ce qui est précieux).
              const precious = !isCurrent && target !== null && l.spent > 0 && l.spent <= target;
              return (
                <Tap key={l.id} to={`/operations?cat=${l.id}${periodParam}`} scaleTo={0.985} className="block px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span aria-hidden className="text-[18px]">
                      {l.category?.emoji ?? '•'}
                    </span>
                    <span className="t-body-strong min-w-0 flex-1 truncate">
                      {l.category?.name ?? l.id}
                      {l.category?.kind === 'fixed' && <span className="t-caption text-muted"> · fixe</span>}
                    </span>
                    <Money cents={l.spent} compact className={isOver ? 'text-danger' : precious ? 'text-gold' : ''} />
                    <span className="num t-caption w-9 text-right text-muted">{l.percent} %</span>
                  </div>
                  <div className="mt-2 pl-[30px]">
                    <ProgressBar value={Math.max(0, l.spent)} max={maxSpent} marker={target} tone={isOver ? 'danger' : precious ? 'gold' : 'accent'} height={6} />
                    <div className="t-caption mt-1 flex justify-between text-muted">
                      <span>{target !== null ? `${precious ? 'objectif tenu · ' : 'objectif '}${euros(target)}` : `${l.count} opération${l.count > 1 ? 's' : ''}`}</span>
                      <span className={diff > 0 ? 'text-danger' : diff < 0 ? 'text-success' : ''}>{l.previous === 0 && l.spent > 0 ? 'nouveau' : formatCents(diff, { sign: true, compact: true })}</span>
                    </div>
                  </div>
                </Tap>
              );
            })}
          </Group>
          </>
        )}
      </Reveal>

      {busiest && busiest.average > 0 && (
        <Reveal index={3}>
          <SectionTitle action={<span className="t-caption text-muted">3 derniers cycles</span>}>Tes habitudes</SectionTitle>
          <Card>
            <p className="t-body mb-3">
              Tu dépenses le plus le <strong className="font-semibold">{WEEKDAY_LONG[busiest.day]}</strong> ({euros(busiest.average)} en moyenne), le moins le {WEEKDAY_LONG[calmest.day]} ({euros(calmest.average)}).
            </p>
            <ColumnChart
              data={insights.weekdays.map((d) => ({ label: WEEKDAY_SHORT[d.day] ?? '', value: d.average, lit: d.day === busiest.day }))}
              format={euros}
              height={140}
              label={`Dépense moyenne par jour de la semaine : ${insights.weekdays.map((d) => `${WEEKDAY_LONG[d.day]} ${euros(d.average)}`).join(', ')}.`}
            />
          </Card>
        </Reveal>
      )}

      {insights.history.length > 1 && (
        <Reveal index={4}>
          <SectionTitle action={<span className="t-caption text-muted">moyenne {euros(historyAvg)}</span>}>Cycle après cycle</SectionTitle>
          <Card>
            <ColumnChart
              data={insights.history.map((h) => ({ label: cycleMonth(h.cycle), value: h.spent, tone: h.spent > h.envelope && h.envelope > 0 ? ('danger' as const) : undefined, lit: h.cycle.start === cycle.start }))}
              format={euros}
              height={150}
              label={`Vie courante par cycle : ${insights.history.map((h) => `${cycleMonth(h.cycle)} ${euros(h.spent)} sur ${euros(h.envelope)}`).join(', ')}.`}
            />
            <p className="t-caption mt-2 text-muted">En rouge : enveloppe dépassée. Le cycle affiché est en surbrillance.</p>
          </Card>
        </Reveal>
      )}

      {insights.merchants.length > 0 && (
        <Reveal index={5}>
          <SectionTitle>Où part l’argent</SectionTitle>
          <Group>
            {insights.merchants.map((m) => (
              <Row
                key={m.label}
                emoji={m.categoryId ? (cats.get(m.categoryId)?.emoji ?? '❔') : '❔'}
                title={m.label}
                subtitle={`${m.count} fois · ${m.categoryId ? (cats.get(m.categoryId)?.name ?? '') : 'À classer'}`}
                right={<Money cents={m.total} compact />}
              />
            ))}
          </Group>
        </Reveal>
      )}

      {insights.biggest.length > 0 && (
        <Reveal index={6}>
          <SectionTitle>Plus grosses dépenses</SectionTitle>
          <Group>
            {insights.biggest.map((tx) => (
              <TxRow key={tx.id} tx={tx} category={tx.categoryId ? cats.get(tx.categoryId) : undefined} account={accMap.get(tx.accountId)} />
            ))}
          </Group>
        </Reveal>
      )}

      <Reveal index={7}>
        <Disclosure title="Plus de chiffres" summary={`Nourriture ${summary.foodPercent} %`}>
          <div className="grid grid-cols-2 gap-2">
            <Card>
              <Metric label="Part de la nourriture" value={`${summary.foodPercent} %`} hint={`${euros(summary.food)} sur ${euros(summary.total)}`} />
            </Card>
            <Card>
              <Metric label="vs précédent, même stade" value={formatCents(delta, { sign: true, compact: true })} tone={delta > 0 ? 'danger' : 'success'} hint={`total précédent ${euros(prevSummary.variable)}`} />
            </Card>
            <Card>
              <Metric label="Charges fixes" value={euros(summary.fixed)} hint={`prévu ${euros(totalFixed(settings))}`} />
            </Card>
            <Card>
              <Metric label="Revenus reçus" value={euros(summary.income)} tone="success" />
            </Card>
          </div>
        </Disclosure>
        {people.length > 0 && (
          <Disclosure title="Entre amis" summary={`${people.length} personne${people.length > 1 ? 's' : ''}`}>
            <Group>
              {people.map((p) => (
                <Row
                  key={p.person}
                  title={p.person}
                  subtitle={`reçu ${euros(p.received)} · versé ${euros(p.sent)} · ${p.count} opération${p.count > 1 ? 's' : ''}`}
                  right={
                    <span className="text-right">
                      <Money cents={p.net} sign tone={p.net > 0 ? 'success' : p.net < 0 ? 'danger' : undefined} />
                      <span className="t-caption block text-muted">{p.net > 0 ? 'reçu en plus' : p.net < 0 ? 'versé en plus' : 'à l’équilibre'}</span>
                    </span>
                  }
                />
              ))}
            </Group>
          </Disclosure>
        )}
        <Disclosure title="Aller plus loin">
          <Group>
            <Row icon="trend-up" title="Prévision de trésorerie" subtitle="Ton solde jour par jour jusqu’à la paie" to="/previsions" />
            <Row icon="repeat" title="Abonnements et récurrents" subtitle="Détectés automatiquement" to="/recurrents" />
          </Group>
        </Disclosure>
      </Reveal>
    </Screen>
  );
}
