import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button, Field, List, ListRow, Notice, Segmented } from '@mylife/kit';
import type { Position } from '../core/budget';
import { todayISO } from '../core/dates';
import { euros } from '../core/format';
import type { Goal, InvestmentOp } from '../core/model';
import { uid } from '../core/text';
import { facts, factsChanged } from '../data/facts';
import type { InvestmentPlan } from '../data/trImport';
import { recordSnapshot } from '../data/upkeep';
import { addGoalMove, ASSET_CLASSES, removeGoal, removeHolding, removeOp, removePortfolio, saveGoal, saveHolding, saveOp, savePortfolio, searchAsset, type AssetClass, type AssetHit, type OpType, type RawGoal, type RawPortfolio } from '../data/wealth';
import type { Account } from '../engine/schema';
import { Form, Select } from './controls';
import { cents, day } from './labels';

/**
 * Les feuilles du patrimoine : un placement (portefeuille), une ligne et ses mouvements, un recalage sur le courtier,
 * un investissement programmé, un objectif et ses versements. Chacune écrit dans la base des faits (`data/wealth.ts`).
 */
const text = (v: number | null | undefined) => (v === null || v === undefined ? '' : (v / 100).toFixed(2).replace('.', ',').replace(',00', ''));
const qty = (v: string) => {
  const n = Number(v.replace(/\s/g, '').replace(',', '.'));
  return v.trim() && Number.isFinite(n) && n >= 0 ? n : null;
};

// ---------------------------------------------------------------- un placement

const PROVIDERS = ['Trade Republic', 'Boursobank', 'Fortuneo', 'Degiro', 'Scalable Capital', 'Bitstack', 'Binance', 'Coinbase', 'Linxea'];
const WRAPPERS = ['PEA', 'CTO', 'Assurance vie', 'PER', 'Crypto', 'Livret', 'Autre'] as const;
const KINDS: readonly (readonly [RawPortfolio['kind'], string])[] = [
  ['broker', 'Bourse (actions, ETF)'],
  ['crypto', 'Crypto'],
  ['savings', 'Épargne (fonds en euros, livret)'],
  ['other', 'Autre'],
];

export function PortfolioSheet({ value, onClose, onSaved }: { value: RawPortfolio | 'new' | null; onClose: () => void; onSaved?: (accountId: string) => void }) {
  const existing = value && value !== 'new' ? value : null;
  const [p, setP] = useState({ name: '', provider: '', wrapper: 'PEA', kind: 'broker' as RawPortfolio['kind'] });
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    setP(existing ? { name: existing.name, provider: existing.provider, wrapper: existing.wrapper, kind: existing.kind } : { name: '', provider: '', wrapper: 'PEA', kind: 'broker' });
    setConfirm(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  if (!value) return null;
  const pick = (provider: string) => {
    const crypto = /bitstack|binance|coinbase/i.test(provider);
    setP((x) => ({ ...x, provider, name: x.name || provider, kind: crypto ? 'crypto' : x.kind, wrapper: crypto ? 'Crypto' : /linxea/i.test(provider) ? 'Assurance vie' : x.wrapper }));
  };
  return (
    <Form open title={existing ? existing.name : 'Nouveau placement'} onClose={onClose}>
      <Field id="pf-provider" label="Établissement" hint="Il sert aussi à reconnaître tes virements vers ce placement.">
        <input id="pf-provider" value={p.provider} onChange={(e) => setP({ ...p, provider: e.target.value })} placeholder="Trade Republic, Bitstack…" />
      </Field>
      <div className="fin-choices">
        {PROVIDERS.map((name) => (
          <button key={name} type="button" className="fin-choice" aria-pressed={p.provider === name} onClick={() => pick(name)}>
            {name}
          </button>
        ))}
      </div>
      <Field id="pf-name" label="Nom">
        <input id="pf-name" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} placeholder="PEA, crypto…" />
      </Field>
      <Select id="pf-wrapper" label="Enveloppe" value={p.wrapper} options={WRAPPERS.map((w) => [w, w] as const)} onChange={(wrapper) => setP({ ...p, wrapper })} />
      <Select id="pf-kind" label="Il contient" value={p.kind} options={KINDS} onChange={(kind) => setP({ ...p, kind })} />
      <Button
        variant="action"
        block
        disabled={!p.name.trim() && !p.provider.trim()}
        onClick={async () => {
          const id = await savePortfolio({ ...existing, ...p });
          onSaved?.(`pf:${id}`);
          onClose();
        }}
      >
        {existing ? 'Enregistrer' : 'Créer le placement'}
      </Button>
      {existing &&
        (confirm ? (
          <>
            <Notice tone="warn">Le placement, ses lignes et leurs mouvements seront supprimés, sur tous tes appareils.</Notice>
            <Button
              variant="danger"
              block
              onClick={async () => {
                await removePortfolio(existing.id);
                onClose();
              }}
            >
              Supprimer définitivement
            </Button>
          </>
        ) : (
          <Button variant="danger" block onClick={() => setConfirm(true)}>
            Supprimer ce placement
          </Button>
        ))}
    </Form>
  );
}

// ---------------------------------------------------------------- une ligne

/** Chercher un titre par son nom ou son code ISIN (relais) ; sans relais, la ligne reste à cours manuel. */
function AssetSearch({ onPick }: { onPick: (hit: AssetHit) => void }) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<AssetHit[]>([]);
  const [state, setState] = useState<'idle' | 'busy' | 'none' | 'off'>('idle');
  useEffect(() => {
    if (query.trim().length < 2) {
      setHits([]);
      setState('idle');
      return;
    }
    let live = true;
    setState('busy');
    const t = setTimeout(() => {
      searchAsset(query)
        .then((r) => {
          if (!live) return;
          setHits(r.slice(0, 6));
          setState(r.length ? 'idle' : 'none');
        })
        .catch(() => live && setState('off'));
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query]);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <Field id="asset-search" label="Chercher un titre (nom, ISIN, crypto)" hint={state === 'busy' ? 'Recherche…' : state === 'none' ? 'Rien trouvé : la ligne peut garder un cours saisi à la main.' : state === 'off' ? 'Recherche indisponible : saisis le cours à la main.' : 'Avec un titre trouvé, le cours se met à jour tout seul.'}>
        <input id="asset-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="MSCI World, Bitcoin, FR0011871128…" />
      </Field>
      {hits.length > 0 && (
        <List>
          {hits.map((h) => (
            <ListRow
              key={`${h.source}:${h.symbol}`}
              title={h.name}
              detail={[h.symbol, h.exchange, h.source === 'coingecko' ? 'crypto' : null].filter(Boolean).join(' · ')}
              onClick={() => {
                onPick(h);
                setQuery('');
                setHits([]);
              }}
            />
          ))}
        </List>
      )}
    </div>
  );
}

export interface LineValue {
  portfolioId: string;
  kind: RawPortfolio['kind'];
  position: Position | null;
}

export function HoldingSheet({ value, onClose }: { value: LineValue | null; onClose: () => void }) {
  const existing = value?.position?.holding ?? null;
  const [name, setName] = useState('');
  const [cls, setCls] = useState<AssetClass>('etf');
  const [quote, setQuote] = useState<{ source: 'yahoo' | 'coingecko' | 'manual'; symbol: string | null }>({ source: 'manual', symbol: null });
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [invested, setInvested] = useState('');
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!value) return;
    setName(existing?.name ?? '');
    setCls((existing?.assetClass as AssetClass | undefined) ?? (value.kind === 'crypto' ? 'crypto' : value.kind === 'savings' ? 'cash' : 'etf'));
    setQuote({ source: existing?.quoteSource ?? 'manual', symbol: existing?.symbol ?? null });
    setPrice(existing?.quoteSource === 'manual' ? text(existing.price) : '');
    setQuantity('');
    setInvested('');
    setConfirm(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  if (!value) return null;
  const cash = cls === 'cash';
  const manualPrice = cents(price);
  return (
    <Form open title={existing ? existing.name : 'Nouvelle ligne'} onClose={onClose}>
      {!cash && (
        <AssetSearch
          onPick={(h) => {
            setName(h.name);
            setCls(h.assetClass === 'other' ? 'other' : h.assetClass);
            setQuote({ source: h.source, symbol: h.symbol });
          }}
        />
      )}
      <Field id="line-name" label="Nom de la ligne">
        <input id="line-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="ETF MSCI World, Bitcoin, fonds en euros…" />
      </Field>
      <Select id="line-class" label="Type" value={cls} options={ASSET_CLASSES} onChange={setCls} />
      {quote.source !== 'manual' && quote.symbol ? (
        <div className="row">
          <span className="grow t-small muted">Cours automatique : {quote.symbol}</span>
          <button type="button" className="link t-small" onClick={() => setQuote({ source: 'manual', symbol: null })}>
            Saisir le cours à la main
          </button>
        </div>
      ) : (
        !cash && (
          <Field id="line-price" label="Cours actuel, par unité (€)" hint="Facultatif : sans cours, la ligne vaut ce qui a été investi.">
            <input id="line-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0" />
          </Field>
        )
      )}
      {!existing && (
        <div className="grid-2">
          {!cash && (
            <Field id="line-qty" label="Quantité détenue">
              <input id="line-qty" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="0" />
            </Field>
          )}
          <Field id="line-invested" label={cash ? 'Montant placé (€)' : 'Total investi (€)'}>
            <input id="line-invested" inputMode="decimal" value={invested} onChange={(e) => setInvested(e.target.value)} placeholder="0" />
          </Field>
        </div>
      )}
      <Button
        variant="action"
        block
        disabled={!name.trim()}
        onClick={async () => {
          await saveHolding(
            { id: existing?.id, portfolioId: value.portfolioId, name, assetClass: cls, symbol: quote.source === 'manual' ? null : quote.symbol, quoteSource: quote.source, price: quote.source === 'manual' ? (cash ? null : manualPrice) : undefined },
            existing ? undefined : { quantity: cash ? 0 : (qty(quantity) ?? 0), invested: cents(invested) ?? 0 },
          );
          onClose();
        }}
      >
        {existing ? 'Enregistrer' : 'Ajouter la ligne'}
      </Button>
      {existing &&
        (confirm ? (
          <Button
            variant="danger"
            block
            onClick={async () => {
              await removeHolding(existing.id);
              onClose();
            }}
          >
            Supprimer la ligne et ses mouvements
          </Button>
        ) : (
          <Button variant="danger" block onClick={() => setConfirm(true)}>
            Supprimer la ligne
          </Button>
        ))}
    </Form>
  );
}

// ---------------------------------------------------------------- un mouvement, un recalage

export function OpSheet({ value, onClose }: { value: { position: Position; op: InvestmentOp | 'new' | 'adjust' } | null; onClose: () => void }) {
  const op = value && value.op !== 'new' && value.op !== 'adjust' ? value.op : null;
  const adjusting = value?.op === 'adjust' || op?.type === 'adjust';
  const [type, setType] = useState<OpType>('buy');
  const [date, setDate] = useState(todayISO());
  const [quantity, setQuantity] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [mode, setMode] = useState<'average' | 'total'>('average');
  useEffect(() => {
    if (!value) return;
    const p = value.position;
    setType(op ? (op.type as OpType) : adjusting ? 'adjust' : 'buy');
    setDate(op?.date ?? todayISO());
    setQuantity(op ? String(op.quantity).replace('.', ',') : adjusting ? String(p.quantity).replace('.', ',') : '');
    setAmount(op ? text(op.amount) : adjusting && p.quantity > 0 ? text(Math.round(p.invested / p.quantity)) : '');
    setMode(op || !adjusting ? 'total' : 'average');
    setNote(op?.note ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  if (!value) return null;
  const h = value.position.holding;
  const cash = h.assetClass === 'cash';
  const withQty = (type === 'buy' || type === 'sell' || type === 'adjust') && !cash;
  const q = qty(quantity) ?? 0;
  const money = cents(amount) ?? 0;
  const total = adjusting && mode === 'average' ? Math.round(q * money) : money;
  return (
    <Form open title={adjusting ? `Recaler ${h.name}` : op ? 'Mouvement' : `Nouveau mouvement · ${h.name}`} onClose={onClose}>
      {adjusting ? (
        <span className="t-small muted">Recopie ce qu’affiche l’app de ton courtier. Tout ce qui précède cette date est remplacé par ces chiffres ; les achats suivants s’y ajoutent.</span>
      ) : (
        <Segmented
          label="Type de mouvement"
          value={type === 'interest' ? 'dividend' : type}
          options={[
            { id: 'buy', label: cash ? 'Versement' : 'Achat' },
            { id: 'sell', label: cash ? 'Retrait' : 'Vente' },
            { id: 'dividend', label: 'Dividende' },
            { id: 'fee', label: 'Frais' },
          ]}
          onChange={(v) => setType(v as OpType)}
        />
      )}
      <Field id="op-date" label="Date">
        <input id="op-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      {withQty && (
        <Field id="op-qty" label={adjusting ? 'Quantité détenue' : 'Quantité'}>
          <input id="op-qty" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="0" />
        </Field>
      )}
      {adjusting && <Segmented label="Ce que tu connais" value={mode} options={[{ id: 'average', label: 'Prix moyen' }, { id: 'total', label: 'Total investi' }]} onChange={(v) => setMode(v as 'average' | 'total')} />}
      <Field
        id="op-amount"
        label={adjusting ? (mode === 'average' ? 'Prix d’achat moyen, par unité (€)' : 'Total investi (€)') : 'Montant (€)'}
        hint={withQty && q > 0 && total > 0 ? (adjusting && mode === 'average' ? `soit ${euros(total)} investis` : `soit ${euros(Math.round(total / q))} par unité`) : undefined}
      >
        <input id="op-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
      </Field>
      {!adjusting && (
        <Field id="op-note" label="Note">
          <input id="op-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Facultatif" />
        </Field>
      )}
      {op?.estimated && <Notice tone="warn">Quantité estimée au dernier cours connu : corrige-la avec celle de ton relevé.</Notice>}
      <Button
        variant="action"
        block
        disabled={adjusting ? q <= 0 || total <= 0 : total <= 0 && !(withQty && q > 0)}
        onClick={async () => {
          await saveOp({ id: op?.id, holdingId: h.id, type: adjusting ? 'adjust' : type, date, quantity: withQty ? q : 0, amount: total, note: adjusting ? undefined : note, createdAt: op?.createdAt });
          onClose();
        }}
      >
        {adjusting ? 'Recaler' : 'Enregistrer'}
      </Button>
      {op && (
        <Button
          variant="danger"
          block
          onClick={async () => {
            await removeOp(op.id);
            onClose();
          }}
        >
          Supprimer ce mouvement
        </Button>
      )}
    </Form>
  );
}

// ---------------------------------------------------------------- un investissement programmé

const FREQ: readonly (readonly [InvestmentPlan['frequency'], string])[] = [
  ['monthly', 'Chaque mois'],
  ['biweekly', 'Toutes les deux semaines'],
  ['weekly', 'Chaque semaine'],
];
const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

/** L'investissement programmé d'une ligne : chaque échéance devient un achat, au cours du jour. */
export function PlanSheet({ value, onClose }: { value: Position | null; onClose: () => void }) {
  const plan = useLiveQuery(() => (value ? facts.table<InvestmentPlan, string>('plans').where('holdingId').equals(value.holding.id).first() : undefined), [value?.holding.id]);
  const [amount, setAmount] = useState('');
  const [frequency, setFrequency] = useState<InvestmentPlan['frequency']>('monthly');
  const [dayOf, setDayOf] = useState('5');
  const [active, setActive] = useState(true);
  useEffect(() => {
    setAmount(text(plan?.amount));
    setFrequency(plan?.frequency ?? 'monthly');
    setDayOf(String(plan?.day ?? 5));
    setActive(plan?.active ?? true);
  }, [plan]);
  if (!value) return null;
  const n = Math.trunc(Number(dayOf));
  const dayValid = frequency === 'monthly' ? n >= 1 && n <= 31 : n >= 0 && n <= 6;
  const save = async () => {
    const now = Date.now();
    await facts.table<InvestmentPlan, string>('plans').put({ id: plan?.id ?? uid('plan'), holdingId: value.holding.id, amount: cents(amount) ?? 0, frequency, day: n, startDate: plan?.startDate ?? todayISO(), active, lastRunDate: plan?.lastRunDate ?? todayISO(), createdAt: plan?.createdAt ?? now });
    await recordSnapshot();
    factsChanged();
    onClose();
  };
  return (
    <Form open title={`Investissement programmé · ${value.holding.name}`} onClose={onClose}>
      <span className="t-small muted">À chaque échéance, un achat est noté au cours du jour. Les échéances passées avant aujourd’hui ne sont pas recréées.</span>
      <Field id="plan-amount" label="Montant par échéance (€)">
        <input id="plan-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
      </Field>
      <Select id="plan-freq" label="Rythme" value={frequency} options={FREQ} onChange={(f) => { setFrequency(f); setDayOf(f === 'monthly' ? '5' : '1'); }} />
      {frequency === 'monthly' ? (
        <Field id="plan-day" label="Jour du mois">
          <input id="plan-day" inputMode="numeric" value={dayOf} onChange={(e) => setDayOf(e.target.value)} />
        </Field>
      ) : (
        <Select id="plan-weekday" label="Jour" value={String(n) as string} options={WEEKDAYS.map((w, i) => [String(i), w] as const)} onChange={setDayOf} />
      )}
      {plan && <Segmented label="État" value={active ? 'on' : 'off'} options={[{ id: 'on', label: 'Actif' }, { id: 'off', label: 'En pause' }]} onChange={(v) => setActive(v === 'on')} />}
      <Button variant="action" block disabled={(cents(amount) ?? 0) <= 0 || !dayValid} onClick={() => void save()}>
        Enregistrer
      </Button>
      {plan && (
        <Button
          variant="danger"
          block
          onClick={async () => {
            await facts.table('plans').delete(plan.id);
            factsChanged();
            onClose();
          }}
        >
          Arrêter ce programme
        </Button>
      )}
    </Form>
  );
}

// ---------------------------------------------------------------- un objectif

export function GoalSheet({ value, accounts, onClose }: { value: Goal | 'new' | null; accounts: readonly Account[]; onClose: () => void }) {
  const existing = value && value !== 'new' ? value : null;
  const raw = useLiveQuery(() => (existing ? facts.table<RawGoal, string>('goals').get(existing.id) : undefined), [existing?.id]);
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [deadline, setDeadline] = useState('');
  const [link, setLink] = useState('');
  const [monthly, setMonthly] = useState('');
  const [move, setMove] = useState('');
  useEffect(() => {
    setName(existing?.name ?? '');
    setTarget(text(existing?.target));
    setDeadline(existing?.deadline ?? '');
    setLink(existing?.accountId ?? '');
    setMove('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  useEffect(() => setMonthly(text(raw?.monthly || null)), [raw]);
  if (!value) return null;
  const save = async () => {
    const portfolio = link.startsWith('pf:') ? link.slice(3) : null;
    await saveGoal({ id: existing?.id, name, target: cents(target) ?? 0, deadline: deadline || null, monthly: cents(monthly) ?? 0, linkKind: !link ? 'manual' : portfolio ? 'portfolio' : 'account', linkId: portfolio ?? (link || null) });
    onClose();
  };
  return (
    <Form open title={existing ? existing.name : 'Nouvel objectif'} onClose={onClose}>
      <Field id="goal-name" label="Nom">
        <input id="goal-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Voyage, apport, matelas de sécurité…" />
      </Field>
      <div className="grid-2">
        <Field id="goal-target" label="Montant visé (€)">
          <input id="goal-target" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="0" />
        </Field>
        <Field id="goal-deadline" label="Pour le">
          <input id="goal-deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </Field>
      </div>
      <Select id="goal-link" label="Avancement suivi par" value={link} options={[['', 'Mes versements, notés à la main'], ...accounts.map((a) => [a.id, `Le solde de ${a.name}`] as const)]} onChange={setLink} />
      <Field id="goal-monthly" label="Je prévois d’y mettre chaque mois (€)" hint="Facultatif : sert à dire si tu es dans les temps.">
        <input id="goal-monthly" inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} placeholder="0" />
      </Field>
      <Button variant="action" block disabled={!name.trim() || (cents(target) ?? 0) <= 0} onClick={() => void save()}>
        {existing ? 'Enregistrer' : 'Créer l’objectif'}
      </Button>
      {existing && !existing.accountId && (
        <div className="stack" style={{ gap: 8 }}>
          <Field id="goal-move" label="Noter un versement (€)" hint="Un montant négatif pour un retrait.">
            <input id="goal-move" inputMode="decimal" value={move} onChange={(e) => setMove(e.target.value)} placeholder="0" />
          </Field>
          <Button
            block
            disabled={!Number.isFinite(Number(move.replace(',', '.'))) || !Number(move.replace(',', '.'))}
            onClick={async () => {
              await addGoalMove(existing.id, Math.round(Number(move.replace(/\s/g, '').replace(',', '.')) * 100));
              setMove('');
            }}
          >
            Noter
          </Button>
        </div>
      )}
      {existing && (
        <>
          <Button
            block
            onClick={async () => {
              await saveGoal({ id: existing.id, name: existing.name, target: existing.target, achievedAt: existing.achievedAt ? null : Date.now() });
              onClose();
            }}
          >
            {existing.achievedAt ? 'Il n’est pas atteint' : 'Objectif atteint'}
          </Button>
          <Button
            variant="danger"
            block
            onClick={async () => {
              await removeGoal(existing.id);
              onClose();
            }}
          >
            Supprimer l’objectif
          </Button>
        </>
      )}
    </Form>
  );
}

/** La liste des mouvements d'une ligne, du plus récent au plus ancien. */
export function OpList({ ops, onOpen }: { ops: readonly InvestmentOp[]; onOpen: (op: InvestmentOp) => void }) {
  const NAMES: Record<string, string> = { buy: 'Achat', sell: 'Vente', dividend: 'Dividende', interest: 'Intérêts', fee: 'Frais', adjust: 'Recalage' };
  if (!ops.length) return <span className="t-small muted">Aucun mouvement.</span>;
  return (
    <List>
      {[...ops]
        .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
        .slice(0, 30)
        .map((o) => (
          <ListRow key={o.id} title={`${NAMES[o.type] ?? o.type}${o.quantity ? ` · ${String(Math.round(o.quantity * 1e6) / 1e6).replace('.', ',')}` : ''}`} detail={[day(o.date), o.estimated ? 'estimé' : null, o.note || null].filter(Boolean).join(' · ')} value={euros(o.type === 'sell' || o.type === 'dividend' || o.type === 'interest' ? o.amount : -o.amount, { sign: true })} onClick={() => onOpen(o)} />
        ))}
    </List>
  );
}
