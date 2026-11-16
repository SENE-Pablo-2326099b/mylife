import { useEffect, useState } from 'react';
import { Button, Field, Notice } from '@mylife/kit';
import { euros } from '../core/format';
import type { Account, Category, Flow, Tag } from '../engine/schema';
import type { AllocationPatch, ManualEntry, SplitPart } from '../engine/state';
import type { OpView } from './opViews';
import { Form, Select, Toggle } from './controls';
import { categoryOptions, cents, day, FLOWS } from './labels';

/** Les feuilles de l'écran Opérations : la fiche d'une opération, et la saisie à la main. */

export interface OperationActions {
  onClassify: (op: OpView, flow: Flow, categoryId: string | null, wholeMerchant: boolean) => void;
  onPatch: (allocationId: string, patch: AllocationPatch) => void;
  onAdvance: (allocationId: string, person: string, amount: number) => void;
  onSplit: (transactionId: string, parts: SplitPart[]) => void;
  onRemove: (transactionId: string) => void;
}

export function OperationSheet({ op, account, categories, tags, onClose, onClassify, onPatch, onAdvance, onSplit, onRemove }: { op: OpView | null; account: string; categories: Category[]; tags: Tag[]; onClose: () => void } & OperationActions) {
  const first = op?.lines[0];
  const id = op?.tx.id;
  const [flow, setFlow] = useState<Flow>('EXPENSE');
  const [categoryId, setCategoryId] = useState('');
  const [whole, setWhole] = useState(false);
  const [person, setPerson] = useState('');
  const [share, setShare] = useState('');
  const [part, setPart] = useState('');
  const [partCat, setPartCat] = useState('');
  useEffect(() => {
    setFlow(first?.flow ?? ((op?.tx.amount ?? 0) > 0 ? 'INCOME' : 'EXPENSE'));
    setCategoryId(first?.categoryId ?? '');
    setWhole(false);
    setPerson('');
    setShare('');
    setPart('');
    setPartCat('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  if (!op || !first) return null;
  const split = op.lines.length > 1;
  const expense = first.flow === 'EXPENSE' && !split;
  const changed = flow !== first.flow || (flow === 'EXPENSE' && categoryId !== (first.categoryId ?? ''));
  const shareCents = cents(share);
  const room = -first.amount - (first.receivableAmount ?? 0);
  const partCents = cents(part);
  const partOk = partCents !== null && partCents > 0 && partCents < -op.tx.amount && !!partCat;
  return (
    <Form open title={op.name} onClose={onClose}>
      <span className="t-small muted">
        {euros(op.tx.amount, { sign: op.tx.amount > 0 })} · {day(op.tx.date)} · {account}
        {op.name !== op.tx.rawLabel ? ` · ${op.tx.rawLabel}` : ''}
      </span>
      {op.tx.pending && <Notice>En attente à la banque : le montant peut encore changer.</Notice>}
      {split ? (
        <>
          <span className="t-label muted">Ventilée en {op.lines.length} parts</span>
          {op.lines.map((a) => (
            <div key={a.id} className="row" style={{ justifyContent: 'space-between' }}>
              <span className="t-body">{categoryOptions(categories).find(([cid]) => cid === a.categoryId)?.[1] ?? 'À classer'}</span>
              <span className="t-strong">{euros(a.amount)}</span>
            </div>
          ))}
          <Button block onClick={() => onSplit(op.tx.id, [])}>
            Retirer la ventilation
          </Button>
        </>
      ) : (
        <>
          <Select id="op-flow" label="C’est" value={flow} options={FLOWS} onChange={setFlow} />
          {flow === 'EXPENSE' && <Select id="op-cat" label="Catégorie" value={categoryId} options={[['', 'Choisir…'], ...categoryOptions(categories)]} onChange={setCategoryId} />}
          {op.tx.merchantId && changed && <Toggle label="Pour tout ce marchand" detail="Ses opérations passées et à venir seront classées de la même façon." checked={whole} onChange={setWhole} />}
          {changed && (
            <Button variant="action" block disabled={flow === 'EXPENSE' && !categoryId} onClick={() => onClassify(op, flow, flow === 'EXPENSE' ? categoryId : null, whole)}>
              Classer
            </Button>
          )}
        </>
      )}
      {expense && (
        <>
          <Toggle label="Lisser sur le reste du cycle" detail="Elle réduit un peu le budget de chaque jour restant, au lieu de peser sur la seule journée." checked={first.smoothed === true} onChange={(v) => onPatch(first.id, { smoothed: v })} />
          <Toggle label="Financée par l’épargne" detail="Elle ne pèse pas dans le budget du cycle." checked={first.fundedBySavings === true} onChange={(v) => onPatch(first.id, { fundedBySavings: v })} />
          {tags.length > 0 && <span className="t-label muted">Tags</span>}
          {tags.map((t) => (
            <Toggle key={t.id} label={t.name} checked={first.tagIds.includes(t.id)} onChange={(v) => onPatch(first.id, { tagIds: v ? [...first.tagIds, t.id] : first.tagIds.filter((x) => x !== t.id) })} />
          ))}
          <span className="t-label muted" style={{ paddingTop: 6 }}>Ventiler : une partie dans une autre catégorie</span>
          <div className="grid-2">
            <Field id="op-part" label="Montant de la part">
              <input id="op-part" inputMode="decimal" value={part} onChange={(e) => setPart(e.target.value)} placeholder="0" />
            </Field>
            <Select id="op-part-cat" label="Sa catégorie" value={partCat} options={[['', 'Choisir…'], ...categoryOptions(categories)]} onChange={setPartCat} />
          </div>
          <Button block disabled={!partOk} onClick={() => onSplit(op.tx.id, [{ categoryId: first.categoryId, amount: op.tx.amount + (partCents ?? 0) }, { categoryId: partCat, amount: -(partCents ?? 0) }])}>
            Ventiler
          </Button>
          <span className="t-label muted" style={{ paddingTop: 6 }}>Avancé pour quelqu’un{first.receivableAmount ? ` · déjà ${euros(first.receivableAmount)}` : ''}</span>
          <div className="grid-2">
            <Field id="op-person" label="Pour qui">
              <input id="op-person" value={person} onChange={(e) => setPerson(e.target.value)} placeholder="Prénom" />
            </Field>
            <Field id="op-share" label="Sa part" error={shareCents !== null && shareCents > room ? `Au plus ${euros(room)}.` : null}>
              <input id="op-share" inputMode="decimal" value={share} onChange={(e) => setShare(e.target.value)} placeholder="0" />
            </Field>
          </div>
          <Button
            block
            disabled={!person.trim() || shareCents === null || shareCents === 0 || shareCents > room}
            onClick={() => {
              onAdvance(first.id, person.trim(), shareCents ?? 0);
              setPerson('');
              setShare('');
            }}
          >
            Ajouter cette avance
          </Button>
        </>
      )}
      {op.tx.source === 'manual' && (
        <Button variant="danger" block onClick={() => onRemove(op.tx.id)}>
          Supprimer cette saisie
        </Button>
      )}
      <Button variant="quiet" onClick={onClose}>
        Terminé
      </Button>
    </Form>
  );
}

/** Saisir une opération à la main : le montant et la catégorie, le reste est facultatif. */
export function AddSheet({ open, today, accounts, categories, onClose, onSave }: { open: boolean; today: string; accounts: Account[]; categories: Category[]; onClose: () => void; onSave: (entry: ManualEntry) => void }) {
  const [amount, setAmount] = useState('');
  const [income, setIncome] = useState(false);
  const [label, setLabel] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [date, setDate] = useState(today);
  const preferred = accounts.find((a) => a.role === 'CASH')?.id ?? accounts.find((a) => a.includeInDailyCash)?.id ?? accounts[0]?.id ?? '';
  useEffect(() => {
    if (!open) return;
    setAmount('');
    setIncome(false);
    setLabel('');
    setCategoryId('');
    setAccountId(preferred);
    setDate(today);
  }, [open, today, preferred]);
  const value = cents(amount);
  const account = accounts.find((a) => a.id === accountId);
  const ready = value !== null && value > 0 && !!account && !!date && (income || !!categoryId);
  const name = label.trim() || (income ? 'Revenu' : (categoryOptions(categories).find(([id]) => id === categoryId)?.[1] ?? 'Dépense'));
  return (
    <Form open={open} title={income ? 'Un revenu' : 'Une dépense'} onClose={onClose}>
      <Field id="add-amount" label="Montant">
        <input id="add-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" autoFocus style={{ fontSize: 24, height: 60, fontWeight: 700 }} />
      </Field>
      {!income && <Select id="add-cat" label="Catégorie" value={categoryId} options={[['', 'Choisir…'], ...categoryOptions(categories)]} onChange={setCategoryId} />}
      <Field id="add-label" label="Libellé (facultatif)">
        <input id="add-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Café, marché…" />
      </Field>
      <div className="grid-2">
        <Select id="add-account" label="Compte" value={accountId} options={accounts.map((a) => [a.id, a.name] as const)} onChange={setAccountId} />
        <Field id="add-date" label="Date">
          <input id="add-date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <Toggle label="C’est une rentrée d’argent" checked={income} onChange={setIncome} />
      {account?.source === 'bank' && <span className="t-small muted">Sur un compte suivi par la banque : quand la banque enverra cette opération, ta saisie s’effacera devant elle. Elle ne sera pas comptée deux fois.</span>}
      <Button
        variant="action"
        block
        disabled={!ready}
        onClick={() => onSave({ transaction: { id: `main:${crypto.randomUUID().slice(0, 8)}`, accountId, date, valueDate: null, amount: income ? (value ?? 0) : -(value ?? 0), rawLabel: name, pending: false, source: 'manual', merchantId: null, createdAt: Date.now() }, flow: income ? 'INCOME' : 'EXPENSE', categoryId: income ? null : categoryId })}
      >
        Ajouter
      </Button>
    </Form>
  );
}

