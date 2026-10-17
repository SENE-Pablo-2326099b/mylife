import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useSearchParams } from 'react-router-dom';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from 'recharts';
import { Card, EmptyState, Money, PageTitle } from '../components/ui';
import { db } from '../db/db';
import type { Transaction } from '../db/types';
import { dailySeries } from '../domain/budget';
import { categoryBreakdown, summarize } from '../domain/cycleStats';
import { computeEnvelope } from '../domain/defaults';
import { personBalances } from '../domain/people';
import { useCategoryMap, useSettings } from '../hooks';
import { addDays, cycleFor, cycleLength, formatCycle, formatShort, previousCycle, todayISO, type Cycle } from '../lib/dates';
import { formatCents } from '../lib/money';

const NO_TX: Transaction[] = [];
const COLORS = { current: '#3987e5', previous: '#d95926', ideal: 'rgb(var(--muted))' };

function shiftCycle(c: Cycle, n: number, payday: number): Cycle {
  let cur = c;
  for (let i = 0; i < Math.abs(n); i++) cur = n < 0 ? previousCycle(cur, payday) : cycleFor(addDays(cur.end, 1), payday);
  return cur;
}

interface Point {
  day: number;
  date: string;
  current?: number;
  previous?: number;
  ideal: number;
}

function ChartTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as Point;
  const rows: [string, string, number | undefined, boolean?][] = [
    ['Ce cycle', COLORS.current, p.current],
    ['Cycle précédent', COLORS.previous, p.previous],
    ['Trajectoire idéale', COLORS.ideal, p.ideal, true],
  ];
  return (
    <div className="rounded-xl border border-line bg-raised px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 text-muted">
        Jour {p.day} · {formatShort(p.date)}
      </p>
      {rows
        .filter((r) => r[2] !== undefined)
        .map(([name, color, value, dashed]) => (
          <p key={name} className="flex items-center gap-2">
            <svg width="14" height="4" aria-hidden>
              <line x1="0" y1="2" x2="14" y2="2" stroke={color} strokeWidth="2" strokeDasharray={dashed ? '3 2' : undefined} />
            </svg>
            <strong className="num">{formatCents(value!, { compact: true })}</strong>
            <span className="text-muted">{name}</span>
          </p>
        ))}
    </div>
  );
}

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

  const { lines, summary, prevSummary, prevSameStage, points } = useMemo(() => {
    const lines = categoryBreakdown(txs, cats, cycle, prev);
    const summary = summarize(txs, cats, cycle, until);
    const prevSummary = summarize(txs, cats, prev);
    const stage = addDays(prev.start, summary.daysElapsed - 1);
    const prevSameStage = summarize(txs, cats, prev, stage < prev.end ? stage : prev.end);
    const cur = dailySeries(txs, cats, cycle, envelope, until);
    const old = dailySeries(txs, cats, prev, envelope);
    const len = Math.max(cycleLength(cycle), cycleLength(prev));
    const points: Point[] = [];
    const curLen = cycleLength(cycle);
    for (let i = 0; i < len; i++) {
      points.push({
        day: i + 1,
        date: addDays(cycle.start, i),
        current: cur[i]?.cumulative,
        previous: old[i]?.cumulative,
        ideal: Math.round((envelope * Math.min(i + 1, curLen)) / curLen),
      });
    }
    return { lines, summary, prevSummary, prevSameStage, points };
  }, [txs, cats, cycle.start, cycle.end, prev.start, prev.end, until, envelope]); // eslint-disable-line react-hooks/exhaustive-deps

  const people = useMemo(() => personBalances(refunds), [refunds]);
  const maxSpent = Math.max(1, ...lines.map((l) => Math.max(l.spent, l.category?.target ?? 0)));
  const delta = summary.variable - prevSameStage.variable;
  const expectedNow = Math.round((envelope * summary.daysElapsed) / summary.length);
  const go = (n: number) => setParams(n === 0 ? {} : { n: String(n) }, { replace: true });
  const periodParam = isCurrent ? '' : offset === -1 ? '&periode=previous' : '&periode=all';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <PageTitle sub={formatCycle(cycle)}>{isCurrent ? 'Cycle en cours' : 'Cycle passé'}</PageTitle>
        <div className="flex gap-1">
          <button className="h-11 w-11 rounded-xl border border-line hover:bg-raised" onClick={() => go(offset - 1)} aria-label="Cycle précédent">
            ←
          </button>
          <button className="h-11 w-11 rounded-xl border border-line hover:bg-raised disabled:opacity-30" onClick={() => go(offset + 1)} disabled={isCurrent} aria-label="Cycle suivant">
            →
          </button>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-2">
        <div className="rounded-2xl border border-line/60 bg-surface p-3">
          <dt className="text-xs text-muted">Vie courante</dt>
          <dd>
            <span className={`num text-xl font-bold ${summary.variable > envelope ? 'text-bad' : ''}`}>{formatCents(summary.variable, { compact: true })}</span>
            <span className="text-sm text-muted"> / {formatCents(envelope, { compact: true })}</span>
          </dd>
          <dd className="mt-2 h-1.5 overflow-hidden rounded-full bg-raised" aria-hidden>
            <div
              className={`h-full rounded-full ${summary.variable > envelope ? 'bg-bad' : summary.variable > expectedNow ? 'bg-warn' : 'bg-good'}`}
              style={{ width: `${Math.min(100, (summary.variable * 100) / Math.max(1, envelope))}%` }}
            />
          </dd>
          <dd className="mt-1 text-[11px] text-muted">
            {summary.variable > expectedNow ? 'Au-dessus' : 'En dessous'} de la trajectoire ({formatCents(expectedNow, { compact: true })} au jour {summary.daysElapsed})
          </dd>
        </div>
        <div className="rounded-2xl border border-line/60 bg-surface p-3">
          <dt className="text-xs text-muted">Part de la nourriture</dt>
          <dd className="num text-xl font-bold">{summary.foodPercent} %</dd>
          <dd className="text-[11px] text-muted">
            {formatCents(summary.food, { compact: true })} sur {formatCents(summary.total, { compact: true })} de dépenses (charges fixes incluses)
          </dd>
        </div>
        <div className="rounded-2xl border border-line/60 bg-surface p-3">
          <dt className="text-xs text-muted">vs cycle précédent, même stade</dt>
          <dd className={`num text-xl font-bold ${delta > 0 ? 'text-bad' : 'text-good'}`}>{formatCents(delta, { sign: true, compact: true })}</dd>
          <dd className="text-[11px] text-muted">
            {formatCents(prevSameStage.variable, { compact: true })} au jour {summary.daysElapsed} · total {formatCents(prevSummary.variable, { compact: true })}
          </dd>
        </div>
        <div className="rounded-2xl border border-line/60 bg-surface p-3">
          <dt className="text-xs text-muted">Charges fixes</dt>
          <dd className="num text-xl font-bold">{formatCents(summary.fixed, { compact: true })}</dd>
          <dd className="text-[11px] text-muted">prévu : {formatCents(settings.fixedCharges, { compact: true })}</dd>
        </div>
      </dl>

      <Card title="Dépenses cumulées">
        <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Légende">
          <li className="flex items-center gap-1.5">
            <svg width="16" height="4" aria-hidden>
              <line x1="0" y1="2" x2="16" y2="2" stroke={COLORS.current} strokeWidth="2" />
            </svg>
            Ce cycle
          </li>
          <li className="flex items-center gap-1.5">
            <svg width="16" height="4" aria-hidden>
              <line x1="0" y1="2" x2="16" y2="2" stroke={COLORS.previous} strokeWidth="2" />
            </svg>
            Cycle précédent
          </li>
          <li className="flex items-center gap-1.5">
            <svg width="16" height="4" aria-hidden>
              <line x1="0" y1="2" x2="16" y2="2" stroke={COLORS.ideal} strokeWidth="2" strokeDasharray="3 2" />
            </svg>
            Trajectoire idéale
          </li>
        </ul>
        <div className="h-56" role="img" aria-label={`Dépenses courantes cumulées : ${formatCents(summary.variable)} au jour ${summary.daysElapsed}, trajectoire idéale ${formatCents(expectedNow)}.`}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
              <CartesianGrid stroke="rgb(var(--line))" strokeOpacity={0.5} vertical={false} />
              <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fill: 'rgb(var(--muted))', fontSize: 11 }} interval={6} tickFormatter={(d: number) => `J${d}`} />
              <YAxis tickLine={false} axisLine={false} width={44} tick={{ fill: 'rgb(var(--muted))', fontSize: 11 }} tickFormatter={(v: number) => `${Math.round(v / 100)}€`} />
              <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'rgb(var(--muted))', strokeWidth: 1 }} />
              <Line type="monotone" dataKey="ideal" stroke={COLORS.ideal} strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="previous" stroke={COLORS.previous} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
              <Line type="monotone" dataKey="current" stroke={COLORS.current} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-muted">Voir les données</summary>
          <table className="mt-2 w-full text-right">
            <thead className="text-muted">
              <tr>
                <th className="text-left font-normal">Jour</th>
                <th className="font-normal">Ce cycle</th>
                <th className="font-normal">Précédent</th>
                <th className="font-normal">Idéal</th>
              </tr>
            </thead>
            <tbody className="num">
              {points.map((p) => (
                <tr key={p.day}>
                  <td className="text-left">{formatShort(p.date)}</td>
                  <td>{p.current !== undefined ? formatCents(p.current, { compact: true }) : '–'}</td>
                  <td>{p.previous !== undefined ? formatCents(p.previous, { compact: true }) : '–'}</td>
                  <td>{formatCents(p.ideal, { compact: true })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </Card>

      <Card title="Par catégorie" action={<span className="text-xs text-muted">vs cycle précédent</span>}>
        {lines.length === 0 ? (
          <EmptyState title="Aucune dépense sur ce cycle" />
        ) : (
          <ul className="space-y-3">
            {lines.map((l) => {
              const target = l.category?.target ?? null;
              const over = target !== null && l.spent > target;
              const diff = l.spent - l.previous;
              return (
                <li key={l.id}>
                  <Link to={`/transactions?cat=${l.id}${periodParam}`} className="block rounded-lg p-1 hover:bg-raised">
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="truncate">
                        <span aria-hidden>{l.category?.emoji ?? '•'}</span> {l.category?.name ?? l.id}
                        {l.category?.kind === 'fixed' && <span className="text-xs text-muted"> · fixe</span>}
                      </span>
                      <span className="shrink-0">
                        <Money cents={l.spent} compact className={`font-semibold ${over ? 'text-bad' : ''}`} />
                        <span className="num ml-1.5 text-xs text-muted">{l.percent} %</span>
                      </span>
                    </div>
                    <div className="relative mt-1 h-2 rounded-full bg-raised">
                      <div className={`h-full rounded-full ${over ? 'bg-bad' : 'bg-accent'}`} style={{ width: `${Math.max(1, (Math.max(0, l.spent) * 100) / maxSpent)}%` }} />
                      {target !== null && (
                        <div className="absolute -top-1 h-4 w-0.5 rounded bg-ink/80" style={{ left: `${(target * 100) / maxSpent}%` }} title={`Objectif ${formatCents(target)}`} />
                      )}
                    </div>
                    <div className="mt-0.5 flex justify-between text-[11px] text-muted">
                      <span>{target !== null ? `objectif ${formatCents(target, { compact: true })}` : `${l.count} opération${l.count > 1 ? 's' : ''}`}</span>
                      <span className={diff > 0 ? 'text-bad' : diff < 0 ? 'text-good' : ''}>
                        {l.previous === 0 && l.spent > 0 ? 'nouveau' : `${formatCents(diff, { sign: true, compact: true })}`}
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {people.length > 0 && (
        <Card title="Entre amis" action={<span className="text-xs text-muted">solde cumulé, hors budget</span>}>
          <ul className="divide-y divide-line/60">
            {people.map((p) => (
              <li key={p.person} className="flex items-center justify-between py-2 text-sm">
                <span>
                  <span className="font-medium">{p.person}</span>
                  <span className="block text-xs text-muted">
                    reçu {formatCents(p.received, { compact: true })} · versé {formatCents(p.sent, { compact: true })} · {p.count} opération{p.count > 1 ? 's' : ''}
                  </span>
                </span>
                <span className="text-right">
                  <Money cents={p.net} sign className={`font-semibold ${p.net > 0 ? 'text-good' : p.net < 0 ? 'text-warn' : ''}`} />
                  <span className="block text-[11px] text-muted">{p.net > 0 ? 'reçu en plus' : p.net < 0 ? 'versé en plus' : 'à l’équilibre'}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
