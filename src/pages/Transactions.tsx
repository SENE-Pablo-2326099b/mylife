import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSearchParams } from 'react-router-dom';
import { TxEditor } from '../components/TxEditor';
import { TxRow } from '../components/TxRow';
import { db } from '../db/db';
import type { Transaction } from '../db/types';
import { useAccounts, useCategories, useSettings } from '../hooks';
import { addDays, cycleFor, formatDay, previousCycle, todayISO } from '../lib/dates';
import { formatCents } from '../lib/money';
import { normalizeText } from '../lib/text';
import { Button, Card, Chip, EmptyState, Group, Icon, Money, Reveal, Segmented, SelectField, Sheet } from '../ui/index';
import { Screen } from '../ui/Screen';
import { Pending } from '../ui/extras';
import { HeaderActions } from '../components/HeaderActions';
import { refreshEverything } from '../sync/refresh';

const PERIODS = [
  { value: 'cycle', label: 'Cycle' },
  { value: 'previous', label: 'Précédent' },
  { value: '30d', label: '30 jours' },
  { value: 'all', label: 'Tout' },
] as const;
type Period = (typeof PERIODS)[number]['value'];
const NO_TX: Transaction[] = [];

export default function TransactionsPage() {
  const [params, setParams] = useSearchParams();
  const settings = useSettings();
  const categories = useCategories();
  const accounts = useAccounts();
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [limit, setLimit] = useState(150);

  const q = params.get('q') ?? '';
  const account = params.get('compte') ?? '';
  const cat = params.get('cat') ?? '';
  const period = (PERIODS.some((p) => p.value === params.get('periode')) ? params.get('periode') : 'cycle') as Period;

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

  const allRaw = useLiveQuery(() => db.transactions.where('date').between(range.start, range.end, true, true).toArray(), [range.start, range.end]);
  const all = allRaw ?? NO_TX;
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
  const catLabel = cat === '_none' ? '❔ À classer' : cat ? `${catMap.get(cat)?.emoji ?? ''} ${catMap.get(cat)?.name ?? cat}` : null;
  const accLabel = account ? `${accMap.get(account)?.bank ?? ''} ${accMap.get(account)?.nickname ?? accMap.get(account)?.name ?? ''}` : null;

  return (
    <Screen title="Opérations" kicker="Dépenses et revenus" mood="activity" right={<HeaderActions />} onRefresh={refreshEverything}>
      <Reveal index={0} className="space-y-3">
        <div className="relative">
          <Icon name="search" size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
          <input type="search" className="field-input pl-10" placeholder="Libellé, note…" value={q} onChange={(e) => setParam('q', e.target.value)} aria-label="Rechercher" />
        </div>
        <Segmented options={PERIODS} value={period} onChange={(v) => setParam('periode', v === 'cycle' ? '' : v)} label="Période" />
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
          <Chip icon="options" onClick={() => setFiltersOpen(true)} selected={!!(cat || account)}>
            Filtres
          </Chip>
          {catLabel && (
            <Chip selected onClick={() => setParam('cat', '')} label="Retirer le filtre catégorie">
              {catLabel} ✕
            </Chip>
          )}
          {accLabel && (
            <Chip selected onClick={() => setParam('compte', '')} label="Retirer le filtre compte">
              {accLabel} ✕
            </Chip>
          )}
          {unclassified > 0 && cat !== '_none' && (
            <Chip tone="warning" selected onClick={() => setParam('cat', '_none')}>
              {unclassified} à classer
            </Chip>
          )}
        </div>
        <p className="t-small px-0.5 text-secondary">
          {filtered.length} opération{filtered.length > 1 ? 's' : ''} · solde <Money cents={total} sign tone="auto" className="text-[13px]" />
        </p>
      </Reveal>

      {cat === '_none' && unclassified > 0 && (
        <Reveal index={1} className="mt-3">
          <Card to="/a-classer" tone="warning" className="flex items-center gap-3">
            <Icon name="flash" className="text-warning" />
            <span className="t-body flex-1">Trier vite, une par une, avec des raccourcis</span>
            <Icon name="chevron-forward" size={17} className="text-muted" />
          </Card>
        </Reveal>
      )}

      <div className="mt-2">
        {allRaw === undefined ? (
          <Pending />
        ) : filtered.length === 0 ? (
          <Card className="mt-3">
            <EmptyState
              icon="list"
              title="Aucune opération"
              body={all.length === 0 ? 'Connecte ta banque ou charge les données de démo.' : 'Aucun résultat pour ces filtres.'}
              action={
                all.length === 0 ? (
                  <>
                    <Button to="/synchro" icon="bank">
                      Connecter ma banque
                    </Button>
                    <Button to="/reglages/donnees" variant="secondary">
                      Démo
                    </Button>
                  </>
                ) : undefined
              }
            />
          </Card>
        ) : (
          groups.map(([date, txs], gi) => {
            const dayTotal = txs.reduce((s, t) => s + t.amount, 0);
            return (
              <Reveal key={date} index={Math.min(gi + 1, 6)}>
                <section aria-label={formatDay(date)}>
                  <h2 className="t-label mb-2 mt-5 flex justify-between px-0.5 text-muted">
                    <span className="first-letter:uppercase">{formatDay(date)}</span>
                    <span className="num normal-case tracking-normal">{formatCents(dayTotal, { sign: true })}</span>
                  </h2>
                  <Group>
                    {txs.map((t) => (
                      <TxRow key={t.id} tx={t} category={t.categoryId ? catMap.get(t.categoryId) : undefined} account={accMap.get(t.accountId)} onClick={() => setEditing(t)} showDate={false} />
                    ))}
                  </Group>
                </section>
              </Reveal>
            );
          })
        )}
        {filtered.length > limit && (
          <div className="mt-4">
            <Button variant="secondary" className="w-full" onClick={() => setLimit((l) => l + 300)}>
              Afficher plus ({filtered.length - limit} restantes)
            </Button>
          </div>
        )}
      </div>

      <Sheet open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filtres">
        <div className="space-y-3">
          <SelectField
            label="Catégorie"
            value={cat}
            onChange={(v) => setParam('cat', v)}
            options={[{ value: '', label: 'Toutes' }, { value: '_none', label: '❔ À classer' }, ...categories.map((c) => ({ value: c.id, label: `${c.emoji} ${c.name}` }))]}
          />
          <SelectField label="Compte" value={account} onChange={(v) => setParam('compte', v)} options={[{ value: '', label: 'Tous les comptes' }, ...accounts.map((a) => ({ value: a.id, label: `${a.bank} · ${a.nickname ?? a.name}` }))]} />
          <Button className="w-full" onClick={() => setFiltersOpen(false)}>
            Voir {filtered.length} opération{filtered.length > 1 ? 's' : ''}
          </Button>
        </div>
      </Sheet>
      <TxEditor tx={editing} categories={categories} onClose={() => setEditing(null)} />
    </Screen>
  );
}
