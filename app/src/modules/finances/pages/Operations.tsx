import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button, EmptyState, Glass, Icon, Segmented } from '@mylife/kit';
import { addDays, diffDays } from '../core/dates';
import { euros } from '../core/format';
import { useEngine } from '../data/engineStore';
import { toClassify } from '../engine/automation';
import type { Flow } from '../engine/schema';
import { addManual, addReceivable, classifyAllocation, classifyMerchant, patchAllocation, removeManual, setSplit } from '../engine/state';
import { byCategory, cashflow, categoryDetail, lastCycles, settledIn, spendByDay, topMerchants } from '../engine/views';
import { CashflowBars, Donut, Histogram } from './charts';
import { Avatar, Screen, Sec, type Ready } from './common';
import { opViews, type OpView } from './opViews';
import { Form, Select } from './controls';
import { categoryOptions, day, FLOW, FLOWS } from './labels';
import { AddSheet, OperationSheet } from './OperationSheets';

/**
 * Opérations : « où est passé mon argent ? ». Tous les comptes dans une seule liste, par jour, avec la recherche,
 * les filtres, le cycle jour par jour, la sélection multiple, la fiche d'une opération et la saisie à la main ;
 * et une vue Analyse (par catégorie, face au cycle dernier, revenus contre dépenses, marchands).
 */
const VIEWS = [
  { id: 'liste', label: 'Liste' },
  { id: 'analyse', label: 'Analyse' },
] as const;
const PERIODS = { cycle: 'Ce cycle', mois: '30 jours', tout: 'Tout' } as const;
type Period = keyof typeof PERIODS;
const NATURES: readonly (readonly [string, string])[] = [['', 'Toutes'], ['A_CLASSER', 'À classer'], ...FLOWS];
const dayTitle = (iso: string, today: string) => (iso === today ? 'Aujourd’hui' : iso === addDays(today, -1) ? 'Hier' : new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${iso}T12:00:00`)).replace(/^./, (c) => c.toUpperCase()));
const month = (iso: string) => new Intl.DateTimeFormat('fr-FR', { month: 'short' }).format(new Date(`${iso}T12:00:00`));
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** La fiche de l'opération ouverte (`?op=`), dans la liste comme dans l'analyse. */
function OpenedSheet({ r }: { r: Ready }) {
  const { db, update } = r;
  const [params, setParams] = useSearchParams();
  const all = useMemo(() => opViews(db), [db]);
  const opened = all.find((o) => o.tx.id === params.get('op')) ?? null;
  const categories = db.categories.filter((c) => !c.archivedAt && !c.mergedIntoId && c.scope === 'EXPENSE');
  const accounts = db.accounts.filter((a) => !a.archivedAt);
  const close = (key: string) => {
    params.delete(key);
    setParams(params, { replace: true });
  };
  return (
    <>
        <OperationSheet
        op={opened}
        account={accounts.find((a) => a.id === opened?.tx.accountId)?.name ?? ''}
        categories={categories}
        tags={db.tags.filter((t) => !t.archivedAt)}
        onClose={() => close('op')}
        onClassify={(op: OpView, flow, cat, whole) => {
          update((s) => (whole && op.tx.merchantId ? classifyMerchant(s, op.tx.merchantId, flow, cat) : classifyAllocation(s, op.lines[0]!.id, flow, cat)));
          close('op');
        }}
        onPatch={(id, patch) => update((s) => patchAllocation(s, id, patch))}
        onAdvance={(allocationId, person, amount) => update((s) => addReceivable(s, { id: `avance:${crypto.randomUUID().slice(0, 8)}`, person, amount, allocationId }))}
        onSplit={(id, parts) => update((s) => setSplit(s, id, parts))}
        onRemove={(id) => {
          update((s) => removeManual(s, id, db.accounts.find((a) => a.id === opened?.tx.accountId)));
          close('op');
        }}
        />
    </>
  );
}

function Liste({ r }: { r: Ready }) {
  const { db, e, today, update } = r;
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [period, setPeriod] = useState<Period>('cycle');
  const [accountId, setAccountId] = useState('');
  const [nature, setNature] = useState('');
  const [categoryId, setCategoryId] = useState(() => params.get('categorie') ?? '');
  const [dayOnly, setDayOnly] = useState<string | null>(null);
  const [filters, setFilters] = useState(false);
  const [limit, setLimit] = useState(60);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [bulk, setBulk] = useState(false);
  const [bulkFlow, setBulkFlow] = useState<Flow>('EXPENSE');
  const [bulkCat, setBulkCat] = useState('');

  const all = useMemo(() => opViews(db), [db]);
  const categories = db.categories.filter((c) => !c.archivedAt && !c.mergedIntoId && c.scope === 'EXPENSE');
  const accounts = db.accounts.filter((a) => !a.archivedAt);
  const cats = new Map(db.categories.map((c) => [c.id, c]));
  const topOf = (id: string | null) => (id ? (cats.get(cats.get(id)?.mergedIntoId ?? id)?.parentId ?? cats.get(id)?.mergedIntoId ?? id) : null);
  const from = period === 'cycle' ? e.cycle.start : period === 'mois' ? addDays(today, -30) : '0000-00-00';
  const needle = fold(q.trim());
  const shown = all
    .filter((o) => o.tx.date >= from && o.tx.date <= today)
    .filter((o) => !dayOnly || o.tx.date === dayOnly)
    .filter((o) => !accountId || o.tx.accountId === accountId)
    .filter((o) => !nature || (nature === 'A_CLASSER' ? o.unclassified : o.lines.some((a) => a.flow === nature)))
    .filter((o) => !categoryId || o.lines.some((a) => a.categoryId === categoryId || topOf(a.categoryId) === categoryId))
    .filter((o) => !needle || fold(`${o.name} ${o.tx.rawLabel} ${o.detail} ${(Math.abs(o.tx.amount) / 100).toFixed(2).replace('.', ',')}`).includes(needle))
    .sort((a, b) => b.tx.date.localeCompare(a.tx.date) || a.tx.amount - b.tx.amount);
  const days = [...new Set(shown.slice(0, limit).map((o) => o.tx.date))];
  const settled = useMemo(() => settledIn(db, [e.cycle]), [db, e.cycle]);
  const spend = useMemo(() => spendByDay(db, settled, e.cycle.start, today), [db, settled, e.cycle.start, today]);
  const histogram = Array.from({ length: diffDays(e.cycle.start, today) + 1 }, (_, i) => addDays(e.cycle.start, i)).map((date) => ({ date, value: Math.max(0, spend.get(date) ?? 0) }));
  const groups = toClassify(db);
  const adding = params.get('ajouter') === '1';
  const close = (key: string) => {
    params.delete(key);
    setParams(params, { replace: true });
  };
  const open = (id: string) => {
    params.set('op', id);
    setParams(params, { replace: true });
  };
  const active = [accountId && accounts.find((a) => a.id === accountId)?.name, nature && NATURES.find(([id]) => id === nature)?.[1], categoryId && categoryOptions(categories).find(([id]) => id === categoryId)?.[1], dayOnly && day(dayOnly)].filter(Boolean);
  const total = shown.reduce((s, o) => s + o.lines.reduce((n, a) => n + (a.flow === 'EXPENSE' || a.flow === null ? Math.min(0, a.amount) : a.flow === 'REFUND' ? a.amount : 0), 0), 0);

  return (
    <>
      <div className="field fin-search">
        <Icon name="search" size={18} />
        <input aria-label="Chercher une opération" value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Marchand, montant, note" enterKeyHint="search" />
      </div>
      <div className="fin-chips">
        {(Object.keys(PERIODS) as Period[]).map((p) => (
          <button key={p} type="button" className="fin-chip" aria-pressed={period === p} onClick={() => setPeriod(p)}>
            {PERIODS[p]}
          </button>
        ))}
        <button type="button" className="fin-chip" aria-pressed={active.length > 0} onClick={() => setFilters(true)}>
          Filtres{active.length ? ` · ${active.length}` : ''}
        </button>
        <button
          type="button"
          className="fin-chip"
          aria-pressed={selecting}
          onClick={() => {
            setSelecting(!selecting);
            setPicked([]);
          }}
        >
          {selecting ? 'Annuler' : 'Sélectionner'}
        </button>
      </div>

      {period === 'cycle' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span>
              <span className="fin-num" style={{ fontSize: 26 }}>{euros(e.spent, { round: true })}</span> <span className="t-small muted">dépensés ce cycle</span>
            </span>
            <span className="t-small muted">{dayOnly ? `le ${day(dayOnly)}` : 'touche un jour'}</span>
          </div>
          <Histogram days={histogram} selected={dayOnly} onSelect={setDayOnly} label="Dépenses jour par jour depuis le début du cycle" />
        </div>
      )}

      {groups.length > 0 && !selecting && (
        <Link to="/argent/classer" className="glass row" style={{ padding: '12px 16px', borderRadius: 16 }}>
          <span className="grow" style={{ display: 'flex', flexDirection: 'column' }}>
            <span className="t-strong">{groups.length} marchand{groups.length > 1 ? 's' : ''} à classer</span>
            <span className="t-small muted">{groups.reduce((n, g) => n + g.count, 0)} opérations, en un geste par marchand</span>
          </span>
          <Icon name="chevron" size={16} />
        </Link>
      )}

      {active.length > 0 && <span className="t-small muted">{active.join(' · ')} : {shown.length} opération{shown.length > 1 ? 's' : ''}, {euros(-total)} dépensés</span>}
      {shown.length === 0 && <EmptyState title="Aucune opération" body={q || active.length ? 'Rien ne correspond à ces critères.' : 'Rien sur cette période.'} action={<Button onClick={() => { setQ(''); setAccountId(''); setNature(''); setCategoryId(''); setDayOnly(null); setPeriod('tout'); }}>Tout afficher</Button>} />}

      {days.map((d) => {
        const rows = shown.slice(0, limit).filter((o) => o.tx.date === d);
        const spent = Math.max(0, spend.get(d) ?? 0);
        return (
          <div key={d} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Sec action={spent > 0 ? euros(spent) : undefined}>{dayTitle(d, today)}</Sec>
            {rows.map((o) => {
              const on = picked.includes(o.tx.id);
              return (
                <button key={o.tx.id} type="button" className="fin-op" style={o.tx.pending ? { opacity: 0.6 } : undefined} onClick={() => (selecting ? setPicked(on ? picked.filter((x) => x !== o.tx.id) : [...picked, o.tx.id]) : open(o.tx.id))} aria-pressed={selecting ? on : undefined}>
                  {selecting ? (
                    <span className="fin-check" data-on={on}>
                      {on && <Icon name="check" size={14} strong />}
                    </span>
                  ) : null}
                  <Avatar op={o} />
                  <span className="grow" style={{ display: 'flex', flexDirection: 'column' }}>
                    <span className="t-strong" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.name}</span>
                    <span className="t-small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {o.tag && <span className="fin-tag">{o.tag}</span>}
                      {o.detail}
                    </span>
                  </span>
                  <span className={`t-strong ${o.tag === 'Virement' || o.tag === 'Mise de côté' ? 'muted' : o.tx.amount > 0 ? 'c-ok' : ''}`}>{euros(o.tag === 'Virement' || o.tag === 'Mise de côté' ? Math.abs(o.tx.amount) : o.tx.amount, { sign: o.tx.amount > 0 && o.tag !== 'Virement' })}</span>
                </button>
              );
            })}
          </div>
        );
      })}
      {shown.length > limit && (
        <Button block onClick={() => setLimit(limit + 100)}>
          Afficher plus ({shown.length - limit} restantes)
        </Button>
      )}

      {selecting && (
        <Glass className="fin-selectbar">
          <span className="grow t-strong">{picked.length} sélectionnée{picked.length > 1 ? 's' : ''}</span>
          <Button variant="action" disabled={picked.length === 0} onClick={() => setBulk(true)}>
            Classer
          </Button>
        </Glass>
      )}

      <Form open={filters} title="Filtres" onClose={() => setFilters(false)}>
        <Select id="f-account" label="Compte" value={accountId} options={[['', 'Tous les comptes'], ...accounts.map((a) => [a.id, a.name] as const)]} onChange={setAccountId} />
        <Select id="f-nature" label="Nature" value={nature} options={NATURES} onChange={setNature} />
        <Select id="f-cat" label="Catégorie" value={categoryId} options={[['', 'Toutes'], ...categoryOptions(categories)]} onChange={setCategoryId} />
        <Link to="/argent/categories" className="link t-small">Gérer les catégories</Link>
        <div className="grid-2">
          <Button onClick={() => { setAccountId(''); setNature(''); setCategoryId(''); setDayOnly(null); }}>Tout retirer</Button>
          <Button variant="action" onClick={() => setFilters(false)}>Voir</Button>
        </div>
      </Form>

      <Form open={bulk} title={`Classer ${picked.length} opération${picked.length > 1 ? 's' : ''}`} onClose={() => setBulk(false)}>
        <Select id="b-flow" label="Ce sont" value={bulkFlow} options={FLOWS} onChange={setBulkFlow} />
        {bulkFlow === 'EXPENSE' && <Select id="b-cat" label="Catégorie" value={bulkCat} options={[['', 'Choisir…'], ...categoryOptions(categories)]} onChange={setBulkCat} />}
        <Button
          variant="action"
          block
          disabled={bulkFlow === 'EXPENSE' && !bulkCat}
          onClick={() => {
            const ids = all.filter((o) => picked.includes(o.tx.id) && o.lines.length === 1).map((o) => o.lines[0]!.id);
            update((s) => ids.reduce((x, id) => classifyAllocation(x, id, bulkFlow, bulkFlow === 'EXPENSE' ? bulkCat : null), s));
            setBulk(false);
            setSelecting(false);
            setPicked([]);
          }}
        >
          Classer en {FLOW[bulkFlow].toLowerCase()}
        </Button>
      </Form>

      <OpenedSheet r={r} />
      <AddSheet
        open={adding}
        today={today}
        accounts={accounts.filter((a) => a.role === 'CHECKING' || a.role === 'CASH')}
        categories={categories}
        onClose={() => close('ajouter')}
        onSave={(entry) => {
          const account = db.accounts.find((a) => a.id === entry.transaction.accountId);
          if (account) update((s) => addManual(s, entry, account));
          close('ajouter');
        }}
      />
    </>
  );
}

const SPANS = [
  { id: 'cycle', label: 'Ce cycle' },
  { id: 'avant', label: 'Cycle dernier' },
  { id: 'trois', label: '3 cycles' },
] as const;

function Analyse({ r }: { r: Ready }) {
  const { db, e, today } = r;
  const [params, setParams] = useSearchParams();
  const [period, setPeriod] = useState<(typeof SPANS)[number]['id']>('cycle');
  const [open, setOpen] = useState<string | null | undefined>(undefined);
  const cycles = lastCycles(db, today, 6);
  const previous = cycles[cycles.length - 2]!;
  // La période analysée : le cycle en cours (jusqu'à aujourd'hui), le précédent en entier, ou les trois derniers.
  const [from, to] = period === 'cycle' ? [e.cycle.start, today] : period === 'avant' ? [previous.start, previous.end] : [cycles[cycles.length - 3]!.start, today];
  const slices = byCategory(db, from, to);
  const total = slices.reduce((s, x) => s + x.amount, 0);
  // Toutes les catégories de dépense, même celles qui n'ont rien eu sur la période : on voit aussi ce qui ne coûte rien.
  const idle = db.categories.filter((c) => c.scope === 'EXPENSE' && !c.parentId && !c.archivedAt && !c.mergedIntoId && !slices.some((x) => x.id === c.id));
  // Le cycle dernier, arrêté au même nombre de jours : on compare ce qui est comparable (seulement pour le cycle en cours).
  const before = new Map(byCategory(db, previous.start, addDays(previous.start, diffDays(e.cycle.start, today))).map((x) => [x.id, x.amount]));
  const views = useMemo(() => new Map(opViews(db).map((o) => [o.tx.id, o])), [db]);
  const selected = open === undefined ? undefined : slices.find((x) => x.id === open) ?? null;
  const detail = open === undefined ? null : categoryDetail(db, open, from, to);
  const openOp = (id: string) => {
    params.set('op', id);
    setParams(params, { replace: true });
  };
  const diffs = slices
    .map((x) => ({ ...x, diff: x.amount - (before.get(x.id) ?? 0) }))
    .filter((x) => x.diff !== 0 && x.id !== null)
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
    .slice(0, 5);
  const span = Math.max(...diffs.map((x) => Math.abs(x.diff)), 1);
  const flows = cashflow(db, cycles, today);
  const past = flows.slice(0, -1).filter((x) => x.income > 0 || x.expense > 0);
  const net = past.length ? Math.round(past.reduce((s, x) => s + x.income - x.expense, 0) / past.length) : 0;
  const merchants = topMerchants(db, from, to, 5);
  const top = merchants[0]?.amount ?? 1;
  const biggest = slices[0]?.amount ?? 1;
  if (total === 0 && past.length === 0 && period === 'cycle') return <EmptyState title="Rien à analyser encore" body="Les graphiques apparaissent dès les premières dépenses du cycle." />;
  return (
    <>
      <Segmented label="Période analysée" value={period} options={SPANS} onChange={(v) => { setPeriod(v); setOpen(undefined); }} />
      <Glass style={{ padding: 18, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
        <Donut
          slices={slices.map((x) => ({ key: x.id ?? 'null', color: x.color, amount: x.amount }))}
          selected={open === undefined ? null : (open ?? 'null')}
          onSelect={(key) => setOpen(key === null ? undefined : key === 'null' ? null : key)}
          label={`Dépenses par catégorie : ${slices.map((x) => `${x.name} ${euros(x.amount, { round: true })}`).join(', ')}`}
        >
          <span className="fin-num" style={{ fontSize: 24 }}>{euros(selected ? selected.amount : total, { round: true })}</span>
          <span className="t-small muted" style={{ maxWidth: 110, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected ? `${selected.name} · ${Math.round((selected.amount / (total || 1)) * 100)} %` : SPANS.find((p) => p.id === period)!.label.toLowerCase()}</span>
        </Donut>
      </Glass>

      <Sec action={`${slices.length} catégorie${slices.length > 1 ? 's' : ''}`}>Où part l’argent, catégorie par catégorie</Sec>
      <Glass className="list" style={{ padding: '4px 16px' }}>
        {slices.map((x) => {
          const shown = open !== undefined && open === x.id;
          const was = period === 'cycle' ? before.get(x.id) : undefined;
          return (
            <div key={x.id ?? 'null'} className="fin-cat" data-open={shown}>
              <button type="button" className="fin-cat-row" aria-expanded={shown} onClick={() => setOpen(shown ? undefined : x.id)}>
                <span className="fin-dot" style={{ background: x.color, width: 12, height: 12 }} />
                <span className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
                  <span className="row" style={{ gap: 8 }}>
                    <span className="grow t-strong" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.name}</span>
                    <span className="t-small muted">{Math.round((x.amount / (total || 1)) * 100)} %</span>
                    <span className="t-strong" style={{ minWidth: 64, textAlign: 'right' }}>{euros(x.amount, { round: true })}</span>
                  </span>
                  <span className="fin-hbar" style={{ width: `${Math.max(3, (x.amount / biggest) * 100)}%`, background: x.color }} />
                  {was !== undefined && was !== x.amount && <span className="t-small" style={{ color: x.amount > was ? '#ff9a62' : 'var(--ok)' }}>{euros(x.amount - was, { round: true, sign: true })} par rapport au cycle dernier, au même jour</span>}
                </span>
              </button>
              {shown && detail && (
                <div className="fin-cat-detail">
                  {detail.subs.length > 1 && (
                    <div className="fin-subs">
                      {detail.subs.map((s) => (
                        <span key={s.id ?? 'null'} className="fin-sub"><span className="fin-dot" style={{ background: s.color }} />{s.name}<b>{euros(s.amount, { round: true })}</b></span>
                      ))}
                    </div>
                  )}
                  {detail.lines.slice(0, 40).map((l, i) => {
                    const v = views.get(l.transactionId);
                    return (
                      <button key={`${l.transactionId}${i}`} type="button" className="fin-cat-op" onClick={() => openOp(l.transactionId)}>
                        {v ? <Avatar op={v} /> : null}
                        <span className="grow" style={{ display: 'flex', flexDirection: 'column', minWidth: 0, textAlign: 'left' }}>
                          <span className="t-body" style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v?.name ?? '?'}</span>
                          <span className="t-small muted">{day(l.date)}</span>
                        </span>
                        <span className={`t-strong ${l.amount < 0 ? 'c-ok' : ''}`}>{euros(-l.amount, { sign: l.amount < 0 })}</span>
                      </button>
                    );
                  })}
                  {detail.lines.length > 40 && <span className="t-small muted">Et {detail.lines.length - 40} autres.</span>}
                  {x.id && (
                    <Link to={`/argent/operations?categorie=${encodeURIComponent(x.id)}`} className="link t-small" style={{ alignSelf: 'flex-start', padding: '6px 0 10px' }}>
                      Voir dans la liste des opérations
                    </Link>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {idle.map((c) => (
          <div key={c.id} className="fin-cat-row" style={{ opacity: 0.5 }}>
            <span className="fin-dot" style={{ background: c.color, width: 12, height: 12 }} />
            <span className="grow t-body">{c.name}</span>
            <span className="t-small muted">rien</span>
          </div>
        ))}
        {slices.length === 0 && idle.length === 0 && <span className="t-small muted" style={{ padding: '12px 0', display: 'block' }}>Aucune dépense sur cette période.</span>}
      </Glass>
      <OpenedSheet r={r} />

      {period === 'cycle' && diffs.length > 0 && (
        <>
          <Sec>Par rapport au cycle dernier, au même jour</Sec>
          <Glass className="fin-diff" style={{ padding: 16 }}>
            {diffs.flatMap((x) => [
              <span key={`${x.id}n`} className="t-small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.name}</span>,
              <span key={`${x.id}l`} style={{ display: 'flex', justifyContent: 'flex-end', borderRight: '1px solid var(--field-border-hover)', height: 18, alignItems: 'center' }}>
                {x.diff < 0 && <span className="fin-hbar" style={{ width: `${(Math.abs(x.diff) / span) * 100}%`, background: 'var(--ok)' }} />}
              </span>,
              <span key={`${x.id}r`} style={{ display: 'flex', alignItems: 'center', height: 18 }}>
                {x.diff > 0 && <span className="fin-hbar" style={{ width: `${(x.diff / span) * 100}%`, background: '#ff9a62' }} />}
              </span>,
              <span key={`${x.id}v`} className={`t-small ${x.diff < 0 ? 'c-ok' : ''}`} style={{ textAlign: 'right', fontWeight: 600, color: x.diff > 0 ? '#ff9a62' : undefined }}>{euros(x.diff, { round: true, sign: true })}</span>,
            ])}
          </Glass>
        </>
      )}

      <Sec>Revenus et dépenses, cycle après cycle</Sec>
      <Glass style={{ padding: '16px 16px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <CashflowBars items={flows.map((x, i) => ({ key: x.cycle.start, name: month(x.cycle.end), income: x.income, expense: x.expense, current: i === flows.length - 1 }))} label={`Revenus et dépenses des ${flows.length} derniers cycles`} />
        <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
          <span className="fin-legend"><span className="fin-dot" style={{ background: '#5ccbe6' }} />Revenus</span>
          <span className="fin-legend"><span className="fin-dot" style={{ background: '#a58bff' }} />Dépenses</span>
          <span className="grow" />
          {past.length > 0 && <span className={`t-small ${net >= 0 ? 'c-ok' : ''}`} style={{ fontWeight: 600 }}>{euros(net, { round: true, sign: true })} par cycle</span>}
        </div>
      </Glass>

      {merchants.length > 0 && (
        <>
          <Sec action="marchands">Où part l’argent</Sec>
          <Glass style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {merchants.map((m) => (
              <div key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="t-body" style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
                  <span className="t-small muted" style={{ flex: 'none' }}>{m.count} fois · {euros(m.amount, { round: true })}</span>
                </div>
                <span className="fin-hbar" style={{ width: `${Math.max(4, (m.amount / top) * 100)}%`, background: m.color }} />
              </div>
            ))}
          </Glass>
        </>
      )}
    </>
  );
}

export function OperationsPage() {
  const engine = useEngine();
  const [params, setParams] = useSearchParams();
  const view = params.get('vue') === 'analyse' ? 'analyse' : 'liste';
  return (
    <Screen engine={engine} tone="ops" title="Opérations" kicker="Tous tes comptes, une seule liste">
      {(r) => (
        <>
          <Segmented
            label="Vue"
            value={view}
            options={VIEWS}
            onChange={(v) => {
              if (v === 'analyse') params.set('vue', 'analyse');
              else params.delete('vue');
              setParams(params, { replace: true });
            }}
          />
          {view === 'analyse' ? <Analyse r={r} /> : <Liste r={r} />}
        </>
      )}
    </Screen>
  );
}
