import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useSearchParams } from 'react-router-dom';
import { TxEditor } from '../components/TxEditor';
import { TxRow } from '../components/TxRow';
import { Button, EmptyState, Money, PageTitle, inputClass } from '../components/ui';
import { db } from '../db/db';
import type { Transaction } from '../db/types';
import { useAccounts, useCategories, useSettings } from '../hooks';
import { addDays, cycleFor, formatDay, previousCycle, todayISO } from '../lib/dates';
import { normalizeText } from '../lib/text';

const PERIODS = {
  cycle: 'Cycle en cours',
  previous: 'Cycle précédent',
  '30d': '30 derniers jours',
  all: 'Tout',
} as const;
type Period = keyof typeof PERIODS;
const NO_TX: Transaction[] = [];

export default function TransactionsPage() {
  const [params, setParams] = useSearchParams();
  const settings = useSettings();
  const categories = useCategories();
  const accounts = useAccounts();
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [limit, setLimit] = useState(150);

  const q = params.get('q') ?? '';
  const account = params.get('compte') ?? '';
  const cat = params.get('cat') ?? '';
  const period = (params.get('periode') as Period) || 'cycle';

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
    setLimit(150);
  };

  const range = useMemo(() => {
    const today = todayISO();
    const cycle = cycleFor(today, settings.payday);
    if (period === 'cycle') return cycle;
    if (period === 'previous') return previousCycle(cycle, settings.payday);
    if (period === '30d') return { start: addDays(today, -29), end: today };
    return { start: '0000-01-01', end: '9999-12-31' };
  }, [period, settings.payday]);

  const all = useLiveQuery(() => db.transactions.where('date').between(range.start, range.end, true, true).toArray(), [range.start, range.end]) ?? NO_TX;
  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const accMap = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  const filtered = useMemo(() => {
    const nq = normalizeText(q);
    return all
      .filter((t) => {
        if (account && t.accountId !== account) return false;
        if (cat === '_none' ? t.categoryId !== null : cat && t.categoryId !== cat) return false;
        if (nq && !normalizeText(`${t.label} ${t.rawText} ${t.note}`).includes(nq)) return false;
        return true;
      })
      .sort((a, b) => b.date.localeCompare(a.date) || a.createdAt - b.createdAt);
  }, [all, q, account, cat]);

  const total = filtered.reduce((s, t) => s + t.amount, 0);
  const shown = filtered.slice(0, limit);
  const groups: [string, Transaction[]][] = [];
  for (const t of shown) {
    const last = groups[groups.length - 1];
    if (last && last[0] === t.date) last[1].push(t);
    else groups.push([t.date, [t]]);
  }
  const unclassified = all.filter((t) => t.categoryId === null).length;

  return (
    <div className="space-y-4">
      <PageTitle sub={`${filtered.length} opération${filtered.length > 1 ? 's' : ''} · solde ${total >= 0 ? '+' : ''}${(total / 100).toFixed(2).replace('.', ',')} €`}>Opérations</PageTitle>

      <div className="space-y-2">
        <input type="search" className={inputClass} placeholder="Rechercher un libellé, une note…" value={q} onChange={(e) => setParam('q', e.target.value)} aria-label="Rechercher" />
        <div className="grid grid-cols-3 gap-2">
          <select className={inputClass} value={period} onChange={(e) => setParam('periode', e.target.value === 'cycle' ? '' : e.target.value)} aria-label="Période">
            {Object.entries(PERIODS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select className={inputClass} value={account} onChange={(e) => setParam('compte', e.target.value)} aria-label="Compte">
            <option value="">Tous comptes</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.bank} {a.name}
              </option>
            ))}
          </select>
          <select className={inputClass} value={cat} onChange={(e) => setParam('cat', e.target.value)} aria-label="Catégorie">
            <option value="">Toutes catégories</option>
            <option value="_none">❔ À classer</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.emoji} {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {unclassified > 0 && cat !== '_none' && (
        <Link to="/a-classer" className="block rounded-2xl border border-warn/40 bg-warn/10 p-3 text-sm">
          <strong>{unclassified}</strong> opération{unclassified > 1 ? 's' : ''} à classer sur cette période →
        </Link>
      )}

      {filtered.length === 0 ? (
        <EmptyState title="Aucune opération">
          {all.length === 0 ? (
            <>
              Connecte ta banque dans <Link to="/synchro" className="text-accent underline">Synchro</Link> ou charge les données de démo dans{' '}
              <Link to="/reglages/donnees" className="text-accent underline">Réglages</Link>.
            </>
          ) : (
            'Aucun résultat pour ces filtres.'
          )}
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {groups.map(([date, txs]) => {
            const dayTotal = txs.reduce((s, t) => s + t.amount, 0);
            return (
              <section key={date} aria-label={formatDay(date)}>
                <h2 className="mb-1 flex justify-between px-2 text-xs font-semibold uppercase tracking-wide text-muted">
                  <span>{formatDay(date)}</span>
                  <Money cents={dayTotal} sign />
                </h2>
                <ul className="rounded-2xl border border-line/60 bg-surface px-1">
                  {txs.map((t) => (
                    <TxRow key={t.id} tx={t} category={t.categoryId ? catMap.get(t.categoryId) : undefined} account={accMap.get(t.accountId)} onClick={() => setEditing(t)} />
                  ))}
                </ul>
              </section>
            );
          })}
          {filtered.length > limit && (
            <Button variant="ghost" className="w-full" onClick={() => setLimit((l) => l + 300)}>
              Afficher plus ({filtered.length - limit} restantes)
            </Button>
          )}
        </div>
      )}
      {editing && <TxEditor tx={editing} categories={categories} onClose={() => setEditing(null)} />}
    </div>
  );
}
