import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { Gauge, StatusPill } from '../components/Gauge';
import { TxEditor } from '../components/TxEditor';
import { TxRow } from '../components/TxRow';
import { Card, EmptyState, Money } from '../components/ui';
import { db, getMeta } from '../db/db';
import type { Transaction } from '../db/types';
import { computeDailyBudget, isVariable } from '../domain/budget';
import { useAccounts, useCategories, useCategoryMap, useSettings } from '../hooks';
import { cycleFor, formatCycle, formatDay, todayISO } from '../lib/dates';
import { formatCents } from '../lib/money';
import { relativeTime } from '../lib/relative';
import { useAlerts } from '../domain/useAlerts';

const NO_TX: Transaction[] = [];

export default function TodayPage() {
  const settings = useSettings();
  const categories = useCategories();
  const cats = useCategoryMap();
  const accounts = useAccounts();
  const today = todayISO();
  const cycle = cycleFor(today, settings.payday);
  const txs = useLiveQuery(() => db.transactions.where('date').between(cycle.start, cycle.end, true, true).toArray(), [cycle.start, cycle.end]) ?? NO_TX;
  const total = useLiveQuery(() => db.transactions.count(), []);
  const toClassify = useLiveQuery(() => db.transactions.filter((t) => t.categoryId === null).count(), []) ?? 0;
  const lastSync = useLiveQuery(() => getMeta<number>('lastSyncAt'), []);
  const alerts = useAlerts();
  const [editing, setEditing] = useState<Transaction | null>(null);

  const b = useMemo(() => computeDailyBudget(txs, cats, settings, today), [txs, cats, settings, today]);
  const todayTxs = txs.filter((t) => t.date === today).sort((a, b2) => a.amount - b2.amount);
  const accMap = new Map(accounts.map((a) => [a.id, a]));
  const serious = alerts.filter((a) => a.level !== 'info');

  if (total === 0) {
    return (
      <div className="space-y-4 pt-4">
        <h1 className="text-2xl font-bold">Bienvenue 👋</h1>
        <EmptyState title="Aucune opération pour l’instant">
          <p>Connecte BNP Paribas et Revolut via Enable Banking pour suivre tes dépenses au jour près.</p>
          <div className="mt-4 flex flex-col gap-2">
            <Link to="/synchro" className="rounded-xl bg-accent px-4 py-3 font-semibold text-black">
              Connecter ma banque
            </Link>
            <Link to="/reglages/donnees" className="rounded-xl border border-line px-4 py-3">
              Essayer avec des données de démo
            </Link>
          </div>
        </EmptyState>
      </div>
    );
  }

  const remaining = b.remainingToday;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold first-letter:uppercase">{formatDay(today)}</h1>
        <span className="text-xs text-muted">synchro {relativeTime(lastSync)}</span>
      </div>

      <section aria-labelledby="reste" className="rounded-3xl border border-line/60 bg-surface p-5">
        <Gauge percent={b.usedPercent} status={b.status}>
          <span id="reste" className="text-sm text-muted">
            {remaining >= 0 ? 'Reste aujourd’hui' : 'Dépassement'}
          </span>
          <span className={`num text-4xl font-bold tracking-tight ${remaining < 0 ? 'text-bad' : ''}`}>{formatCents(Math.abs(remaining))}</span>
          <span className="mt-2">
            <StatusPill status={b.status} />
          </span>
        </Gauge>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-center">
          <div className="rounded-2xl bg-raised p-3">
            <dt className="text-xs text-muted">Budget du jour</dt>
            <dd className="num text-lg font-semibold">{formatCents(b.dailyBudget)}</dd>
          </div>
          <div className="rounded-2xl bg-raised p-3">
            <dt className="text-xs text-muted">Dépensé aujourd’hui</dt>
            <dd className="num text-lg font-semibold">{formatCents(b.spentToday)}</dd>
          </div>
        </dl>
      </section>

      <dl className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-2xl border border-line/60 bg-surface p-3">
          <dt className="text-[11px] text-muted">Reste du cycle</dt>
          <dd className={`num font-semibold ${b.remainingCycle < 0 ? 'text-bad' : ''}`}>{formatCents(b.remainingCycle, { compact: true })}</dd>
        </div>
        <div className="rounded-2xl border border-line/60 bg-surface p-3">
          <dt className="text-[11px] text-muted">Jours restants</dt>
          <dd className="num font-semibold">{b.daysLeft}</dd>
        </div>
        <div className="rounded-2xl border border-line/60 bg-surface p-3">
          <dt className="text-[11px] text-muted">Demain</dt>
          <dd className="num font-semibold">{formatCents(b.nextDailyBudget, { compact: true })}/j</dd>
        </div>
      </dl>

      {toClassify > 0 && (
        <Link to="/a-classer" className="flex items-center justify-between rounded-2xl border border-warn/40 bg-warn/10 p-3 text-sm">
          <span>
            <strong>{toClassify}</strong> opération{toClassify > 1 ? 's' : ''} à classer
          </span>
          <span aria-hidden>→</span>
        </Link>
      )}
      {serious.length > 0 && (
        <Link to="/alertes" className="flex items-center justify-between rounded-2xl border border-bad/40 bg-bad/10 p-3 text-sm">
          <span>
            <strong>{serious.length}</strong> alerte{serious.length > 1 ? 's' : ''} : {serious[0].title}
          </span>
          <span aria-hidden>→</span>
        </Link>
      )}

      <Card title="Aujourd’hui" action={<span className="text-xs text-muted">{formatCycle(cycle)}</span>}>
        {todayTxs.length === 0 ? (
          <p className="text-sm text-muted">Aucune dépense aujourd’hui.</p>
        ) : (
          <ul className="-mx-2">
            {todayTxs.map((t) => (
              <TxRow key={t.id} tx={t} category={t.categoryId ? cats.get(t.categoryId) : undefined} account={accMap.get(t.accountId)} onClick={() => setEditing(t)} />
            ))}
          </ul>
        )}
        {todayTxs.some((t) => !isVariable(t, cats)) && <p className="mt-2 text-xs text-muted">Les transferts, l’épargne et les charges fixes ne comptent pas dans le budget du jour.</p>}
      </Card>

      <p className="text-center text-xs text-muted">
        Enveloppe vie courante : <Money cents={b.envelope} compact /> · déjà dépensé <Money cents={b.spentBefore + b.spentToday} compact />
      </p>
      {editing && <TxEditor tx={editing} categories={categories} onClose={() => setEditing(null)} />}
    </div>
  );
}
