import { useEffect, useState } from 'react';
import { db } from '../../db/db';
import { getSettings } from '../../db/seed';
import type { Account, AssetClass, Goal, GoalMove, Holding, InvestmentOp, InvestmentOpType, InvestmentPlan, ManualAsset, Portfolio, PortfolioKind, PlanFrequency, QuoteSource } from '../../db/types';
import { FREQUENCY_LABEL } from '../../domain/plans';
import { ASSET_CLASS_LABEL } from '../../domain/wealth';
import { recordSnapshot, refreshPlannedSavings, refreshQuotes, syncBankBuys } from '../../domain/wealthDb';
import { todayISO } from '../../lib/dates';
import { centsToInput, formatCents, tryDecimalToCents } from '../../ui/money';
import { uid } from '../../lib/text';
import { canUseRelay, EbClient, type AssetHit } from '../../sync/ebClient';
import { Badge, Button, Chip, Divider, Field, Icon, MoneyField, Segmented, SelectField, Stepper, Tap, TextField, toast, ToggleRow } from '../../ui/index';

/** Formulaires du patrimoine (dans des feuilles). Après chaque écriture : épargne prévue et photo du jour. */
async function afterWrite(): Promise<void> {
  await refreshPlannedSavings();
  await recordSnapshot();
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <Field label={label}>{(id) => <input id={id} type="date" className="field-input" value={value} onChange={(e) => onChange(e.target.value)} />}</Field>;
}

/** Quantité décimale (parts, BTC) : virgule ou point. */
function QuantityField({ label, value, onChange, hint }: { label: string; value: number; onChange: (v: number) => void; hint?: string }) {
  const [text, setText] = useState(value ? String(value).replace('.', ',') : '');
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <input
          id={id}
          inputMode="decimal"
          className="field-input num font-display font-semibold"
          value={text}
          placeholder="0"
          onChange={(e) => {
            setText(e.target.value);
            const n = parseFloat(e.target.value.replace(',', '.').replace(/\s/g, ''));
            onChange(Number.isFinite(n) && n >= 0 ? n : 0);
          }}
        />
      )}
    </Field>
  );
}

// ---------------------------------------------------------------- portefeuille

const PROVIDERS = ['Trade Republic', 'Bitstack', 'BoursoBank', 'Fortuneo', 'Degiro', 'Scalable Capital', 'Binance', 'Coinbase', 'Linxea', 'Ma banque'];
const WRAPPERS = ['CTO', 'PEA', 'Assurance vie', 'PER', 'Livret', 'Crypto', 'Autre'];

export function PortfolioForm({ initial, onDone }: { initial: Portfolio | null; onDone: (id: string | null) => void }) {
  const [p, setP] = useState<Portfolio>(
    initial ?? { id: uid('p'), name: '', provider: '', kind: 'broker', wrapper: 'CTO', order: Date.now(), createdAt: Date.now() },
  );
  const set = (patch: Partial<Portfolio>) => setP((x) => ({ ...x, ...patch }));
  const save = async () => {
    await db.portfolios.put({ ...p, name: p.name.trim() || p.provider.trim() || 'Placement' });
    await afterWrite();
    onDone(p.id);
  };
  return (
    <div className="space-y-3">
      <TextField label="Établissement" value={p.provider} onChange={(provider) => set({ provider })} placeholder="Trade Republic, Bitstack…" hint="Sert aussi à reconnaître tes virements vers ce placement." />
      <div className="flex flex-wrap gap-1.5">
        {PROVIDERS.map((name) => (
          <Chip
            key={name}
            small
            selected={p.provider === name}
            onClick={() =>
              set({
                provider: name,
                name: p.name || name,
                kind: /bitstack|binance|coinbase/i.test(name) ? 'crypto' : p.kind,
                wrapper: /bitstack|binance|coinbase/i.test(name) ? 'Crypto' : /linxea/i.test(name) ? 'Assurance vie' : p.wrapper,
              })
            }
          >
            {name}
          </Chip>
        ))}
      </div>
      <TextField label="Nom" value={p.name} onChange={(name) => set({ name })} placeholder="Ex. PEA ETF, Bitcoin long terme" />
      <SelectField label="Enveloppe" value={WRAPPERS.includes(p.wrapper) ? p.wrapper : 'Autre'} onChange={(wrapper) => set({ wrapper })} options={WRAPPERS.map((w) => ({ value: w, label: w }))} />
      <SelectField<PortfolioKind>
        label="Type"
        value={p.kind}
        onChange={(kind) => set({ kind })}
        options={[
          { value: 'broker', label: 'Courtier (actions, ETF)' },
          { value: 'crypto', label: 'Crypto' },
          { value: 'savings', label: 'Épargne (livret, fonds euros)' },
          { value: 'retirement', label: 'Retraite' },
          { value: 'other', label: 'Autre' },
        ]}
      />
      <Button className="w-full" disabled={!p.provider.trim() && !p.name.trim()} onClick={() => void save()}>
        {initial ? 'Enregistrer' : 'Créer le placement'}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------- ligne (actif détenu)

function AssetSearch({ onPick }: { onPick: (hit: AssetHit) => void }) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<AssetHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // undefined = en cours de lecture ; null = pas d'accès au relais.
  const [password, setPassword] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    // Mot de passe du relais, ou '' quand le compte MyLife connecté suffit.
    void getSettings().then((s) => setPassword(canUseRelay(s) ? s.bridgePassword : null));
  }, []);
  useEffect(() => {
    if (password == null || query.trim().length < 2) {
      setHits(null);
      return;
    }
    const h = setTimeout(() => {
      new EbClient(password)
        .searchAsset(query.trim())
        .then((r) => {
          setHits(r);
          setError(null);
        })
        .catch((e: Error) => setError(e.message));
    }, 350);
    return () => clearTimeout(h);
  }, [query, password]);
  if (password === null) return <p className="t-caption text-muted">Recherche automatique des cours : connecte ton compte MyLife (Réglages → Compte). Tu peux aussi tout saisir à la main ci-dessous.</p>;
  return (
    <div className="space-y-2">
      <div className="relative">
        <Icon name="search" size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
        <input className="field-input pl-10" placeholder="Nom, ticker ou ISIN (MSCI World, BTC, IE00B4L5Y983…)" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Rechercher un actif" />
      </div>
      {error && <p className="t-caption text-danger">{error}</p>}
      {hits && (
        <div className="-mx-2 max-h-56 overflow-y-auto">
          {hits.length === 0 && <p className="t-small px-2 text-muted">Aucun résultat.</p>}
          {hits.map((h) => (
            <Tap key={`${h.source}:${h.symbol}`} onClick={() => onPick(h)} className="flex min-h-[48px] w-full items-center gap-2 rounded-md px-2 text-left">
              <span className="min-w-0 flex-1">
                <span className="t-body-strong block truncate">{h.name}</span>
                <span className="t-caption block text-muted">
                  {h.symbol} · {h.exchange ?? h.source}
                </span>
              </span>
              <Badge>{ASSET_CLASS_LABEL[h.assetClass]}</Badge>
            </Tap>
          ))}
        </div>
      )}
    </div>
  );
}

export function HoldingForm({ portfolio, initial, onDone }: { portfolio: Portfolio; initial: Holding | null; onDone: () => void }) {
  const [h, setH] = useState<Holding>(
    initial ?? {
      id: uid('h'),
      portfolioId: portfolio.id,
      name: '',
      assetClass: portfolio.kind === 'crypto' ? 'crypto' : portfolio.kind === 'savings' ? 'cash' : 'etf',
      symbol: null,
      quoteSource: 'manual',
      isin: null,
      price: null,
      priceAt: null,
      order: Date.now(),
      createdAt: Date.now(),
    },
  );
  const [quantity, setQuantity] = useState(0);
  const [invested, setInvested] = useState<number | null>(null);
  const [priceText, setPriceText] = useState(h.price !== null ? centsToInput(Math.round(h.price)) : '');
  const set = (patch: Partial<Holding>) => setH((x) => ({ ...x, ...patch }));
  const cash = h.assetClass === 'cash';

  const save = async () => {
    const manualPrice = tryDecimalToCents(priceText);
    const holding: Holding = { ...h, name: h.name.trim() || h.symbol || 'Ligne', price: h.quoteSource === 'manual' ? (cash ? null : manualPrice) : h.price, priceAt: h.quoteSource === 'manual' && manualPrice !== null ? Date.now() : h.priceAt };
    await db.holdings.put(holding);
    if (!initial && (quantity > 0 || (invested ?? 0) > 0)) {
      const op: InvestmentOp = {
        id: uid('op'),
        holdingId: holding.id,
        date: todayISO(),
        type: 'buy',
        quantity: cash ? 0 : quantity,
        amount: invested ?? (holding.price ? Math.round(quantity * holding.price) : 0),
        planId: null,
        estimated: false,
        note: 'Position initiale',
        createdAt: Date.now(),
      };
      await db.investmentOps.put(op);
    }
    if (holding.quoteSource !== 'manual') {
      try {
        const r = await refreshQuotes({ force: true });
        if (r.errors.length) toast({ message: r.errors[0] ?? 'Cours indisponible', tone: 'danger' });
      } catch {
        toast({ message: 'Cours indisponible pour l’instant : il sera mis à jour plus tard.' });
      }
    }
    await afterWrite();
    onDone();
  };

  return (
    <div className="space-y-3">
      {!initial && (
        <AssetSearch
          onPick={(hit) => {
            set({ name: hit.name, symbol: hit.symbol, quoteSource: hit.source, assetClass: hit.assetClass === 'fund' ? 'fund' : hit.assetClass === 'other' ? 'other' : hit.assetClass });
            toast({ message: `${hit.name} : le cours sera suivi automatiquement` });
          }}
        />
      )}
      <TextField label="Nom" value={h.name} onChange={(name) => set({ name })} placeholder="Ex. Amundi MSCI World, Bitcoin, Livret A" />
      <SelectField<AssetClass> label="Classe d’actifs" value={h.assetClass} onChange={(assetClass) => set({ assetClass })} options={Object.entries(ASSET_CLASS_LABEL).map(([value, label]) => ({ value: value as AssetClass, label }))} />
      {!cash && (
        <>
          <SelectField<QuoteSource>
            label="Cours"
            value={h.quoteSource}
            onChange={(quoteSource) => set({ quoteSource })}
            options={[
              { value: 'manual', label: 'Saisi à la main' },
              { value: 'yahoo', label: 'Automatique · Yahoo Finance (ETF, actions)' },
              { value: 'coingecko', label: 'Automatique · CoinGecko (crypto)' },
            ]}
          />
          {h.quoteSource === 'manual' ? (
            <MoneyField label="Cours actuel (par part)" value={tryDecimalToCents(priceText)} allowEmpty onCommit={(v) => setPriceText(v === null ? '' : centsToInput(v))} hint="À mettre à jour de temps en temps." />
          ) : (
            <TextField label={h.quoteSource === 'yahoo' ? 'Ticker Yahoo' : 'Identifiant CoinGecko'} value={h.symbol ?? ''} onChange={(symbol) => set({ symbol: symbol.trim() || null })} mono hint={h.quoteSource === 'yahoo' ? 'Ex. CW8.PA, IWDA.AS, AAPL' : 'Ex. bitcoin, ethereum'} />
          )}
        </>
      )}
      {!initial && (
        <>
          <Divider />
          <p className="t-label text-muted">Ce que tu détiens aujourd’hui</p>
          {!cash && <QuantityField label="Quantité" value={quantity} onChange={setQuantity} hint="Parts, actions, BTC… (0,0123)" />}
          <MoneyField label={cash ? 'Montant' : 'Total investi (prix de revient)'} value={invested} allowEmpty onCommit={setInvested} hint={cash ? undefined : 'Somme que tu as versée pour cette quantité.'} />
        </>
      )}
      <Button className="w-full" disabled={!h.name.trim() && !h.symbol} onClick={() => void save()}>
        {initial ? 'Enregistrer' : 'Ajouter la ligne'}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------- mouvements


export function OpForm({ holding, initial, onDone }: { holding: Holding; initial: InvestmentOp | null; onDone: () => void }) {
  const [op, setOp] = useState<InvestmentOp>(
    initial ?? { id: uid('op'), holdingId: holding.id, date: todayISO(), type: 'buy', quantity: 0, amount: 0, planId: null, estimated: false, note: '', createdAt: Date.now() },
  );
  const set = (patch: Partial<InvestmentOp>) => setOp((x) => ({ ...x, ...patch }));
  const withQty = (op.type === 'buy' || op.type === 'sell') && holding.assetClass !== 'cash';
  const save = async () => {
    await db.investmentOps.put({ ...op, quantity: withQty ? op.quantity : 0, estimated: false });
    await afterWrite();
    onDone();
  };
  return (
    <div className="space-y-3">
      <Segmented<InvestmentOpType>
        options={[
          { value: 'buy', label: holding.assetClass === 'cash' ? 'Versement' : 'Achat' },
          { value: 'sell', label: holding.assetClass === 'cash' ? 'Retrait' : 'Vente' },
          { value: 'dividend', label: 'Dividende' },
          { value: 'fee', label: 'Frais' },
        ]}
        value={op.type === 'interest' ? 'dividend' : op.type}
        onChange={(type) => set({ type })}
        label="Type de mouvement"
      />
      <DateField label="Date" value={op.date} onChange={(date) => set({ date })} />
      {withQty && <QuantityField label="Quantité" value={op.quantity} onChange={(quantity) => set({ quantity })} />}
      <MoneyField label="Montant" value={op.amount} onCommit={(v) => set({ amount: Math.abs(v ?? 0) })} hint={withQty && op.quantity > 0 && op.amount > 0 ? `soit ${formatCents(Math.round(op.amount / op.quantity))} par unité` : undefined} />
      {op.estimated && <p className="t-caption text-warning">Quantité estimée au dernier cours connu : corrige-la avec celle de ton relevé.</p>}
      <TextField label="Note" value={op.note} onChange={(note) => set({ note })} placeholder="Facultatif" />
      <Button className="w-full" disabled={op.amount <= 0 && !(withQty && op.quantity > 0)} onClick={() => void save()}>
        Enregistrer
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------- recalage sur le courtier

/**
 * Recalage : la quantité et le prix d'achat moyen affichés par l'app du courtier (Bitstack, Trade
 * Republic…) deviennent la référence à cette date. Plus-value = valeur − quantité × prix moyen,
 * exactement comme dans l'app ; les achats suivants s'y ajoutent.
 */
export function AdjustForm({ holding, initial, current, onDone }: { holding: Holding; initial: InvestmentOp | null; current: { quantity: number; averageCost: number | null }; onDone: () => void }) {
  const [date, setDate] = useState(initial?.date ?? todayISO());
  const [quantity, setQuantity] = useState(initial?.quantity ?? current.quantity);
  const [mode, setMode] = useState<'average' | 'total'>('average');
  const [average, setAverage] = useState(initial && initial.quantity > 0 ? Math.round(initial.amount / initial.quantity) : (current.averageCost ?? 0));
  const [total, setTotal] = useState(initial?.amount ?? 0);
  const invested = mode === 'average' ? Math.round(quantity * average) : total;
  const save = async () => {
    await db.investmentOps.put({
      id: initial?.id ?? uid('adj'),
      holdingId: holding.id,
      date,
      type: 'adjust',
      quantity,
      amount: invested,
      planId: null,
      estimated: false,
      note: 'Recalé sur l’app du courtier',
      createdAt: initial?.createdAt ?? Date.now(),
    });
    await afterWrite();
    toast({ message: 'Ligne recalée : quantité et prix d’achat moyen à jour', tone: 'gold' });
    onDone();
  };
  return (
    <div className="space-y-3">
      <p className="t-small text-secondary">Recopie ce qu’affiche l’app de ton courtier. Tout ce qui précède cette date est remplacé par ces chiffres ; les achats suivants s’y ajoutent.</p>
      <DateField label="Date" value={date} onChange={setDate} />
      <QuantityField label={holding.assetClass === 'crypto' ? 'Quantité détenue (ex. 0,01234567 BTC)' : 'Quantité détenue'} value={quantity} onChange={setQuantity} />
      <Segmented
        options={[
          { value: 'average', label: 'Prix d’achat moyen' },
          { value: 'total', label: 'Total investi' },
        ]}
        value={mode}
        onChange={setMode}
        label="Ce que tu connais"
      />
      {mode === 'average' ? (
        <MoneyField label="Prix d’achat moyen (par unité)" value={average} onCommit={(v) => setAverage(Math.abs(v ?? 0))} hint={quantity > 0 && average > 0 ? `soit ${formatCents(invested)} investis` : undefined} />
      ) : (
        <MoneyField label="Total investi" value={total} onCommit={(v) => setTotal(Math.abs(v ?? 0))} hint={quantity > 0 && total > 0 ? `soit ${formatCents(Math.round(total / quantity))} par unité` : undefined} />
      )}
      {holding.price !== null && quantity > 0 && invested > 0 && (
        <p className="t-small text-secondary">
          Au cours actuel : {formatCents(Math.round(quantity * holding.price))}, plus-value {formatCents(Math.round(quantity * holding.price) - invested, { sign: true })}.
        </p>
      )}
      <Button className="w-full" disabled={quantity <= 0 || invested <= 0} onClick={() => void save()}>
        Recaler
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------- achats depuis la banque

/** Relier une ligne aux prélèvements bancaires (Bitstack…) : chaque prélèvement devient un achat. */
export function BankLinkForm({ holding, provider, onDone }: { holding: Holding; provider: string; onDone: () => void }) {
  const [on, setOn] = useState(!!holding.bankKeyword);
  const [keyword, setKeyword] = useState(holding.bankKeyword ?? provider.trim().toLowerCase());
  const [from, setFrom] = useState(holding.bankLinkFrom ?? todayISO());
  const save = async () => {
    await db.holdings.update(holding.id, { bankKeyword: on && keyword.trim() ? keyword.trim() : null, bankLinkFrom: on ? from : null });
    if (on) {
      // Le plan programmé ferait doublon : ce sont les prélèvements réels qui font foi.
      const plans = await db.plans.where('holdingId').equals(holding.id).toArray();
      for (const p of plans) if (p.active) await db.plans.update(p.id, { active: false });
      const n = await syncBankBuys();
      toast({ message: n ? `${n} prélèvement${n > 1 ? 's' : ''} ajouté${n > 1 ? 's' : ''} comme achat${n > 1 ? 's' : ''}` : 'Lien enregistré : les prochains prélèvements deviendront des achats' });
    }
    await afterWrite();
    onDone();
  };
  return (
    <div className="space-y-3">
      <ToggleRow
        label="Achats automatiques depuis ma banque"
        hint="Chaque prélèvement dont le libellé contient ce mot devient un achat, au cours du jour du prélèvement. Un virement reçu de ce service devient une vente."
        checked={on}
        onChange={setOn}
      />
      {on && (
        <>
          <TextField label="Mot du libellé bancaire" value={keyword} onChange={setKeyword} mono hint="Ex. « bitstack » : tel qu’il apparaît sur tes opérations BNP / Revolut." />
          <DateField label="Prélèvements pris en compte à partir du" value={from} onChange={setFrom} />
          <p className="t-caption text-muted">Conseil : recale d’abord la ligne sur l’app (quantité + prix moyen) : les prélèvements jusqu’à la date du recalage sont alors déjà comptés, seuls les suivants s’ajoutent. Un plan programmé sur cette ligne est mis en pause pour éviter les doublons.</p>
        </>
      )}
      <Button className="w-full" disabled={on && !keyword.trim()} onClick={() => void save()}>
        Enregistrer
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------- plan programmé

export function PlanForm({ holding, initial, onDone }: { holding: Holding; initial: InvestmentPlan | null; onDone: () => void }) {
  const [plan, setPlan] = useState<InvestmentPlan>(
    initial ?? { id: uid('plan'), holdingId: holding.id, amount: 0, frequency: 'monthly', day: 1, startDate: todayISO(), active: true, lastRunDate: null, createdAt: Date.now() },
  );
  const set = (patch: Partial<InvestmentPlan>) => setPlan((x) => ({ ...x, ...patch }));
  const save = async () => {
    // Un nouveau plan démarre aujourd'hui : rien n'est rétroactif (les achats passés se saisissent à part).
    await db.plans.put({ ...plan, lastRunDate: initial ? plan.lastRunDate : null });
    await afterWrite();
    toast({ message: 'Investissement programmé enregistré', tone: 'gold' });
    onDone();
  };
  const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  return (
    <div className="space-y-3">
      <MoneyField label="Montant par échéance" value={plan.amount} onCommit={(v) => set({ amount: Math.abs(v ?? 0) })} />
      <SelectField<PlanFrequency>
        label="Fréquence"
        value={plan.frequency}
        onChange={(frequency) => set({ frequency, day: frequency === 'monthly' ? 1 : 1 })}
        options={Object.entries(FREQUENCY_LABEL).map(([value, label]) => ({ value: value as PlanFrequency, label }))}
      />
      {plan.frequency === 'monthly' ? (
        <Field label="Jour du mois">{() => <Stepper value={plan.day} min={1} max={31} onChange={(day) => set({ day })} format={(d) => `le ${d}`} label="Jour du mois" />}</Field>
      ) : (
        <SelectField label="Jour de la semaine" value={String(plan.day)} onChange={(d) => set({ day: Number(d) })} options={DAYS.map((label, i) => ({ value: String(i), label }))} />
      )}
      <DateField label="À partir du" value={plan.startDate} onChange={(startDate) => set({ startDate })} />
      <ToggleRow label="Actif" hint="Chaque échéance ajoute un achat au cours du jour (quantité à vérifier)." checked={plan.active} onChange={(active) => set({ active })} />
      <Button className="w-full" disabled={plan.amount <= 0} onClick={() => void save()}>
        Enregistrer
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------- objectifs

const GOAL_EMOJIS = ['🛟', '✈️', '🏠', '🚗', '💻', '🎓', '💍', '🎁', '🌴', '📈'];

export function GoalForm({ initial, accounts, portfolios, onDone }: { initial: Goal | null; accounts: Account[]; portfolios: Portfolio[]; onDone: () => void }) {
  const [g, setG] = useState<Goal>(
    initial ?? { id: uid('g'), name: '', emoji: '🛟', target: 0, deadline: null, monthly: 0, includeInBudget: true, linkKind: 'manual', linkId: null, achievedAt: null, order: Date.now(), createdAt: Date.now() },
  );
  const set = (patch: Partial<Goal>) => setG((x) => ({ ...x, ...patch }));
  const save = async () => {
    await db.goals.put({ ...g, name: g.name.trim() || 'Objectif' });
    await afterWrite();
    onDone();
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Icône">
        {GOAL_EMOJIS.map((e) => (
          <Chip key={e} small selected={g.emoji === e} onClick={() => set({ emoji: e })} label={`Icône ${e}`}>
            <span className="text-[16px]">{e}</span>
          </Chip>
        ))}
      </div>
      <TextField label="Nom" value={g.name} onChange={(name) => set({ name })} placeholder="Fonds d’urgence, voyage, permis…" />
      <MoneyField label="Montant visé" value={g.target} onCommit={(v) => set({ target: Math.abs(v ?? 0) })} />
      <ToggleRow label="Échéance" checked={g.deadline !== null} onChange={(on) => set({ deadline: on ? (g.deadline ?? `${new Date().getFullYear() + 1}-06-30`) : null })} />
      {g.deadline !== null && <DateField label="Date visée" value={g.deadline} onChange={(deadline) => set({ deadline })} />}
      <MoneyField label="Versement prévu par mois" value={g.monthly} onCommit={(v) => set({ monthly: Math.abs(v ?? 0) })} />
      <ToggleRow label="Compter dans le budget" hint="Le versement mensuel est retiré de l’enveloppe vie courante." checked={g.includeInBudget} onChange={(includeInBudget) => set({ includeInBudget })} />
      <SelectField
        label="Suivi"
        value={g.linkKind}
        onChange={(linkKind) => set({ linkKind, linkId: linkKind === 'account' ? (accounts[0]?.id ?? null) : linkKind === 'portfolio' ? (portfolios[0]?.id ?? null) : null })}
        options={[
          { value: 'manual', label: 'Versements que je note' },
          ...(accounts.length ? [{ value: 'account' as const, label: 'Solde d’un compte (livret…)' }] : []),
          ...(portfolios.length ? [{ value: 'portfolio' as const, label: 'Valeur d’un placement' }] : []),
        ]}
      />
      {g.linkKind === 'account' && <SelectField label="Compte" value={g.linkId ?? ''} onChange={(linkId) => set({ linkId })} options={accounts.map((a) => ({ value: a.id, label: `${a.bank} · ${a.nickname ?? a.name}` }))} />}
      {g.linkKind === 'portfolio' && <SelectField label="Placement" value={g.linkId ?? ''} onChange={(linkId) => set({ linkId })} options={portfolios.map((p) => ({ value: p.id, label: p.name }))} />}
      <Button className="w-full" disabled={g.target <= 0} onClick={() => void save()}>
        {initial ? 'Enregistrer' : 'Créer l’objectif'}
      </Button>
    </div>
  );
}

export function GoalMoveForm({ goal, onDone }: { goal: Goal; onDone: (amount: number) => void }) {
  const [amount, setAmount] = useState<number>(goal.monthly || 0);
  const [withdraw, setWithdraw] = useState(false);
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const save = async () => {
    const move: GoalMove = { id: uid('gm'), goalId: goal.id, date, amount: withdraw ? -amount : amount, note, createdAt: Date.now() };
    await db.goalMoves.put(move);
    onDone(move.amount);
  };
  return (
    <div className="space-y-3">
      <Segmented
        options={[
          { value: 'in', label: 'Versement' },
          { value: 'out', label: 'Retrait' },
        ]}
        value={withdraw ? 'out' : 'in'}
        onChange={(v) => setWithdraw(v === 'out')}
        label="Sens"
      />
      <MoneyField label="Montant" value={amount} onCommit={(v) => setAmount(Math.abs(v ?? 0))} />
      <DateField label="Date" value={date} onChange={setDate} />
      <TextField label="Note" value={note} onChange={setNote} placeholder="Facultatif" />
      <Button className="w-full" disabled={amount <= 0} onClick={() => void save()}>
        Enregistrer
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------- autres actifs et dettes

export function AssetForm({ initial, onDone }: { initial: ManualAsset | null; onDone: () => void }) {
  const [a, setA] = useState<ManualAsset>(initial ?? { id: uid('ma'), name: '', kind: 'asset', emoji: '🏠', value: 0, updatedAt: Date.now() });
  const set = (patch: Partial<ManualAsset>) => setA((x) => ({ ...x, ...patch }));
  const save = async () => {
    await db.manualAssets.put({ ...a, name: a.name.trim() || (a.kind === 'debt' ? 'Dette' : 'Actif'), updatedAt: Date.now() });
    await afterWrite();
    onDone();
  };
  return (
    <div className="space-y-3">
      <Segmented
        options={[
          { value: 'asset', label: 'Ce que je possède' },
          { value: 'debt', label: 'Ce que je dois' },
        ]}
        value={a.kind}
        onChange={(kind) => set({ kind, emoji: kind === 'debt' ? '🧾' : '🏠' })}
        label="Type"
      />
      <div className="grid grid-cols-[72px_1fr] gap-3">
        <Field label="Icône">{(id) => <input id={id} className="field-input text-center text-[20px]" value={a.emoji} maxLength={4} onChange={(e) => set({ emoji: e.target.value })} />}</Field>
        <TextField label="Nom" value={a.name} onChange={(name) => set({ name })} placeholder={a.kind === 'debt' ? 'Prêt étudiant, crédit auto…' : 'Appartement, voiture, or…'} />
      </div>
      <MoneyField label={a.kind === 'debt' ? 'Reste à rembourser' : 'Valeur estimée'} value={a.value} onCommit={(v) => set({ value: Math.abs(v ?? 0) })} />
      <Button className="w-full" onClick={() => void save()}>
        Enregistrer
      </Button>
    </div>
  );
}
