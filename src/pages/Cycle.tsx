import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSearchParams } from 'react-router-dom';
import { db } from '../db/db';
import type { Transaction } from '../db/types';
import { dailySeries } from '../domain/budget';
import { categoryBreakdown, summarize } from '../domain/cycleStats';
import { computeEnvelope, totalFixed } from '../domain/defaults';
import { personBalances } from '../domain/people';
import { useCategoryMap, useSettings } from '../hooks';
import { addDays, cycleFor, cycleLength, formatCycle, formatShort, previousCycle, todayISO, type Cycle } from '../lib/dates';
import { formatCents } from '../lib/money';
import { LineChart } from '../ui/charts';
import { Card, Disclosure, EmptyState, Group, IconButton, Metric, Money, ProgressBar, Reveal, Row, SectionTitle, Tap } from '../ui/index';
import { Screen } from '../ui/Screen';
import { HeaderActions } from './Today';

const NO_TX: Transaction[] = [];

function shiftCycle(c: Cycle, n: number, payday: number): Cycle {
  let cur = c;
  for (let i = 0; i < Math.abs(n); i++) cur = n < 0 ? previousCycle(cur, payday) : cycleFor(addDays(cur.end, 1), payday);
  return cur;
}

const euros = (v: number) => formatCents(v, { short: true });

export default function CyclePage() {
  const settings = useSettings();
  const cats = useCategoryMap();
  const [params, setParams] = useSearchParams();
  const offset = Math.min(0, parseInt(params.get('n') ?? '0', 10) || 0);
  const today = todayISO();
  const current = cycleFor(today, settings.payday);
  const cycle = shiftCycle(current, offset, settings.payday);
  const prev = previousCycle(cycle, settings.payday);
  const isCurrent = offset === 0;
  const until = isCurrent ? today : cycle.end;
  const envelope = computeEnvelope(settings);

  const txs = useLiveQuery(() => db.transactions.where('date').between(prev.start, cycle.end, true, true).toArray(), [prev.start, cycle.end]) ?? NO_TX;
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
        )}
      </Reveal>

      <Reveal index={3}>
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
