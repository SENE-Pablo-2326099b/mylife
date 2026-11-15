import { useEffect, useState, type ReactNode } from 'react';
import { Button, Field, Notice, Sheet, Switch } from '@mylife/kit';
import { euros } from '../core/format';
import type { Occurrence } from '../engine/occurrences';
import type { Account, Category, Commitment, Db, Envelope, OccurrenceOverride, Provision, Rhythm } from '../engine/schema';
import type { AllocationPatch } from '../engine/state';
import { cents, day, END, KIND } from './labels';

/**
 * Les feuilles de réglage de l'étape M2 : une échéance, un engagement, un paiement en plusieurs fois, une poche, une
 * dépense, une enveloppe. Fonctionnelles et sobres : les écrans définitifs viennent en M4 et M5.
 */

const text = (c: number | null | undefined) => (c === null || c === undefined ? '' : String(c / 100).replace('.', ','));
const newId = (prefix: string) => `${prefix}:${crypto.randomUUID().slice(0, 8)}`;

function Toggle({ label, detail, checked, onChange }: { label: string; detail?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="row" style={{ minHeight: 48 }}>
      <span className="grow" style={{ display: 'flex', flexDirection: 'column' }}>
        <span className="t-body" style={{ fontWeight: 500 }}>{label}</span>
        {detail && <span className="t-small muted">{detail}</span>}
      </span>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

function Select<T extends string>({ id, label, value, options, onChange, hint }: { id: string; label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void; hint?: string }) {
  return (
    <Field id={id} label={label} hint={hint}>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </Field>
  );
}

function Form({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  return (
    <Sheet open={open} title={title} onClose={onClose}>
      <div className="stack" style={{ maxHeight: '70dvh', overflowY: 'auto', paddingBottom: 4 }}>{children}</div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- une échéance

export function OccurrenceSheet({ o, onClose, onDecide, onEdit }: { o: Occurrence | null; onClose: () => void; onDecide: (id: string, decision: OccurrenceOverride | null) => void; onEdit: (c: Commitment) => void }) {
  const [paid, setPaid] = useState('');
  useEffect(() => setPaid(o && o.status === 'PARTIAL' ? text(o.paid) : ''), [o]);
  if (!o) return null;
  const amount = cents(paid);
  const tooMuch = amount !== null && amount > o.expected;
  return (
    <Form open title={o.commitment.label} onClose={onClose}>
      <span className="t-small muted">
        {KIND[o.commitment.kind]} de {euros(o.expected)}, le {day(o.dueDate)}. {o.status === 'PARTIAL' ? `${euros(o.paid)} déjà versés, reste ${euros(o.remaining)}.` : ''}
      </span>
      <Field id="occ-paid" label="Déjà versé" hint="Ce qui est déjà sorti de ton compte pour cette échéance : seul le reste sera compté à payer." error={tooMuch ? 'Plus que l’échéance : marque-la plutôt réglée.' : null}>
        <input id="occ-paid" inputMode="decimal" value={paid} onChange={(e) => setPaid(e.target.value)} placeholder="0" />
      </Field>
      <Button variant="action" block disabled={amount === null || amount === 0 || tooMuch} onClick={() => onDecide(o.id, { id: o.id, status: 'PARTIAL', transactionId: null, paid: amount ?? 0 })}>
        Enregistrer
      </Button>
      <div className="grid-2">
        <Button onClick={() => onDecide(o.id, { id: o.id, status: 'PAID', transactionId: null })}>Déjà réglée</Button>
        <Button onClick={() => onDecide(o.id, { id: o.id, status: 'SKIPPED', transactionId: null })}>Sauter ce cycle</Button>
      </div>
      <Button variant="quiet" onClick={() => onDecide(o.id, null)}>
        Laisser le calcul décider
      </Button>
      <Button variant="quiet" onClick={() => onEdit(o.commitment)}>
        Modifier l’engagement
      </Button>
    </Form>
  );
}

// ---------------------------------------------------------------- un engagement

const RHYTHMS: readonly (readonly [Rhythm, string])[] = [
  ['MONTHLY', 'Chaque mois'],
  ['WEEKLY', 'Chaque semaine'],
  ['BIWEEKLY', 'Toutes les deux semaines'],
  ['YEARLY', 'Chaque année'],
  ['ONCE', 'Une seule fois'],
];
const WEEKDAYS = [['1', 'Lundi'], ['2', 'Mardi'], ['3', 'Mercredi'], ['4', 'Jeudi'], ['5', 'Vendredi'], ['6', 'Samedi'], ['0', 'Dimanche']] as const;
const blankCommitment = (): Commitment => ({ id: newId('eng'), kind: 'CHARGE', label: '', amount: 0, tolerance: 0.2, rhythm: 'MONTHLY', anchorDay: null, anchorDate: null, accountId: null, counterAccountId: null, categoryId: null, startDate: null, endDate: null, remainingOccurrences: null, installmentPlanId: null, direct: false, paused: false, reserveInCash: null, provisionMonthly: false });

export function CommitmentSheet({ value, db, onClose, onSave, onRemove }: { value: Commitment | 'new' | null; db: Db; onClose: () => void; onSave: (c: Commitment, opensCycle: boolean) => void; onRemove: (id: string) => void }) {
  const [c, setC] = useState<Commitment>(blankCommitment);
  const [amount, setAmount] = useState('');
  const [opens, setOpens] = useState(false);
  useEffect(() => {
    const next = value && value !== 'new' ? value : blankCommitment();
    setC(next);
    setAmount(text(next.amount || null));
    setOpens(value !== 'new' && value !== null && db.settings.openingCommitmentId === value.id);
  }, [value, db.settings.openingCommitmentId]);
  if (!value) return null;
  const isNew = value === 'new';
  const set = (patch: Partial<Commitment>) => setC((x) => ({ ...x, ...patch }));
  const value_ = cents(amount);
  const needsDate = c.rhythm === 'BIWEEKLY' || c.rhythm === 'YEARLY' || c.rhythm === 'ONCE';
  const ready = c.label.trim().length > 0 && value_ !== null && value_ > 0 && (!needsDate || !!c.anchorDate);
  const reserve = c.kind === 'INCOME' ? false : (c.reserveInCash ?? db.settings.reserveDue[c.kind]);
  const canProvision = c.kind === 'CHARGE' && (c.rhythm === 'YEARLY' || c.rhythm === 'ONCE');
  const daily = db.accounts.filter((a) => a.includeInDailyCash && !a.archivedAt);
  return (
    <Form open title={isNew ? 'Nouvel engagement' : c.label || 'Engagement'} onClose={onClose}>
      {c.kind === 'INSTALLMENT' ? (
        <span className="t-small muted">Échéance d’un paiement en plusieurs fois, du {c.startDate ? day(c.startDate) : '?'} au {c.endDate ? day(c.endDate) : '?'}.</span>
      ) : (
        <Select id="eng-kind" label="Type" value={c.kind} options={[['CHARGE', 'Charge'], ['INCOME', 'Revenu'], ['SAVING', 'Épargne']] as const} onChange={(kind) => set({ kind })} />
      )}
      <Field id="eng-label" label="Libellé" hint="Un mot du libellé bancaire aide à reconnaître l’opération.">
        <input id="eng-label" value={c.label} onChange={(e) => set({ label: e.target.value })} placeholder="Loyer, salaire, assurance…" />
      </Field>
      <Field id="eng-amount" label="Montant par échéance">
        <input id="eng-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
      </Field>
      {c.kind !== 'INSTALLMENT' && <Select id="eng-rhythm" label="Rythme" value={c.rhythm} options={RHYTHMS} onChange={(rhythm) => set({ rhythm, anchorDay: null })} />}
      {c.rhythm === 'MONTHLY' && (
        <Field id="eng-day" label="Jour du mois" hint="Vide : n’importe quand avant la fin du cycle.">
          <input id="eng-day" inputMode="numeric" value={c.anchorDay ?? ''} onChange={(e) => set({ anchorDay: e.target.value ? Math.max(1, Math.min(31, Math.trunc(Number(e.target.value)) || 1)) : null })} placeholder="5" />
        </Field>
      )}
      {c.rhythm === 'WEEKLY' && <Select id="eng-weekday" label="Jour" value={String(c.anchorDay ?? 1) as (typeof WEEKDAYS)[number][0]} options={WEEKDAYS} onChange={(d) => set({ anchorDay: Number(d) })} />}
      {needsDate && (
        <Field id="eng-date" label={c.rhythm === 'ONCE' ? 'Date' : c.rhythm === 'YEARLY' ? 'Prochaine date' : 'Une date de référence'}>
          <input id="eng-date" type="date" value={c.anchorDate ?? ''} onChange={(e) => set({ anchorDate: e.target.value || null })} />
        </Field>
      )}
      {c.kind !== 'SAVING' && <Select id="eng-account" label="Compte" value={c.accountId ?? ''} options={[['', 'N’importe quel compte du quotidien'], ...daily.map((a) => [a.id, a.name] as const)]} onChange={(id) => set({ accountId: id || null })} />}
      {c.kind !== 'INCOME' && <Toggle label="Réserver dans la trésorerie" detail="Déduite du cash libre dès maintenant. Sinon, seulement quand l’opération apparaît sur le compte." checked={reserve} onChange={(v) => set({ reserveInCash: v })} />}
      {canProvision && <Toggle label="Provisionner chaque cycle" detail="Un peu mis de côté à chaque cycle, pour que l’argent soit prêt le jour J." checked={c.provisionMonthly} onChange={(v) => set({ provisionMonthly: v })} />}
      {c.kind === 'INCOME' && <Toggle label="Ouvre le cycle" detail="Son arrivée, même en avance, démarre le nouveau cycle." checked={opens} onChange={setOpens} />}
      <Toggle label="En pause" detail="Plus d’échéance tant qu’il est en pause." checked={c.paused} onChange={(v) => set({ paused: v })} />
      <Button variant="action" block disabled={!ready} onClick={() => onSave({ ...c, label: c.label.trim(), amount: value_ ?? 0 }, opens)}>
        Enregistrer
      </Button>
      {!isNew && (
        <Button variant="danger" block onClick={() => onRemove(c.id)}>
          Supprimer
        </Button>
      )}
    </Form>
  );
}

// ---------------------------------------------------------------- un paiement en plusieurs fois

export interface InstallmentInput {
  id: string;
  label: string;
  total: number;
  count: number;
  paidCount: number;
  nextDate: string;
  accountId: string | null;
}

export function InstallmentSheet({ open, today, accounts, onClose, onSave }: { open: boolean; today: string; accounts: Account[]; onClose: () => void; onSave: (input: InstallmentInput) => void }) {
  const [label, setLabel] = useState('');
  const [total, setTotal] = useState('');
  const [count, setCount] = useState('4');
  const [paid, setPaid] = useState('1');
  const [next, setNext] = useState(today);
  const [accountId, setAccountId] = useState('');
  useEffect(() => {
    if (!open) return;
    setLabel('');
    setTotal('');
    setCount('4');
    setPaid('1');
    setNext(today);
    setAccountId('');
  }, [open, today]);
  const t = cents(total);
  const n = Math.trunc(Number(count));
  const p = Math.trunc(Number(paid));
  const ready = label.trim().length > 0 && t !== null && t > 0 && n >= 2 && n <= 48 && p >= 0 && p < n && !!next;
  return (
    <Form open={open} title="Paiement en plusieurs fois" onClose={onClose}>
      <span className="t-small muted">Chaque échéance pèse sur son propre cycle. Rien ne pèse d’un seul coup.</span>
      <Field id="inst-label" label="Achat">
        <input id="inst-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Vélo, ordinateur…" />
      </Field>
      <div className="grid-2">
        <Field id="inst-total" label="Montant total">
          <input id="inst-total" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} placeholder="600" />
        </Field>
        <Field id="inst-count" label="Nombre d’échéances">
          <input id="inst-count" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} />
        </Field>
      </div>
      <div className="grid-2">
        <Field id="inst-paid" label="Déjà payées">
          <input id="inst-paid" inputMode="numeric" value={paid} onChange={(e) => setPaid(e.target.value)} />
        </Field>
        <Field id="inst-next" label="Prochaine échéance">
          <input id="inst-next" type="date" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
      </div>
      <Select id="inst-account" label="Compte débité" value={accountId} options={[['', 'N’importe quel compte du quotidien'], ...accounts.map((a) => [a.id, a.name] as const)]} onChange={setAccountId} />
      {ready && <Notice>{n - p} échéance{n - p > 1 ? 's' : ''} de {euros(Math.round(t / n))} à venir, une par mois.</Notice>}
      <Button variant="action" block disabled={!ready} onClick={() => onSave({ id: newId('plan').slice(5), label: label.trim(), total: t ?? 0, count: n, paidCount: p, nextDate: next, accountId: accountId || null })}>
        Créer
      </Button>
    </Form>
  );
}

// ---------------------------------------------------------------- une poche

export function ProvisionSheet({ value, db, onClose, onSave, onRemove }: { value: Provision | 'new' | null; db: Db; onClose: () => void; onSave: (p: Provision) => void; onRemove: (id: string) => void }) {
  const accounts = db.accounts.filter((a) => !a.archivedAt && (a.includeInDailyCash || a.role === 'PROVISION'));
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const [link, setLink] = useState('');
  useEffect(() => {
    const p = value && value !== 'new' ? value : null;
    setLabel(p?.label ?? '');
    setAmount(text(p?.amount));
    setAccountId(p?.accountId ?? accounts[0]?.id ?? '');
    setLink(p?.commitmentId ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  if (!value) return null;
  const existing = value === 'new' ? null : value;
  const a = cents(amount);
  const linkable = db.commitments.filter((c) => c.kind !== 'INCOME' && !c.paused);
  const chosen = linkable.find((c) => c.id === link);
  const ready = label.trim().length > 0 && a !== null && a > 0 && !!accountId;
  return (
    <Form open title={existing ? existing.label : 'Nouvelle poche'} onClose={onClose}>
      <span className="t-small muted">De l’argent verrouillé sur un compte : retiré du cash libre, sans quitter le compte ni devenir de l’épargne.</span>
      {existing?.auto && <Notice>Poche tenue par le moteur : la provision de « {existing.label} », alimentée à chaque cycle.</Notice>}
      <Field id="poche-label" label="Nom">
        <input id="poche-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Prochaine échéance, vacances…" />
      </Field>
      <Field id="poche-amount" label="Montant verrouillé">
        <input id="poche-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
      </Field>
      <Select id="poche-account" label="Sur le compte" value={accountId} options={accounts.map((x) => [x.id, x.name] as const)} onChange={setAccountId} />
      <Select id="poche-link" label="Elle couvre" value={link} options={[['', 'Rien de précis (poche libre)'], ...linkable.map((c) => [c.id, `${c.label} · ${euros(c.amount)}`] as const)]} onChange={setLink} hint="Liée à une échéance, elle n’est déduite qu’une seule fois : pas en plus de l’échéance." />
      <Button
        variant="action"
        block
        disabled={!ready}
        onClick={() => onSave({ ...(existing ?? { id: newId('poche'), goalId: null, status: 'ACTIVE' as const }), label: label.trim(), amount: a ?? 0, accountId, commitmentId: chosen?.id ?? null, installmentPlanId: chosen?.installmentPlanId ?? null })}
      >
        Enregistrer
      </Button>
      {existing && (
        <Button variant="danger" block onClick={() => onRemove(existing.id)}>
          Libérer la poche
        </Button>
      )}
    </Form>
  );
}

// ---------------------------------------------------------------- une dépense

export interface ExpenseLine {
  allocationId: string;
  label: string;
  date: string;
  amount: number;
  smoothed: boolean;
  fundedBySavings: boolean;
}

export function ExpenseSheet({ line, onClose, onPatch }: { line: ExpenseLine | null; onClose: () => void; onPatch: (id: string, patch: AllocationPatch) => void }) {
  if (!line) return null;
  return (
    <Form open title={line.label} onClose={onClose}>
      <span className="t-small muted">
        {euros(line.amount)} le {day(line.date)}.
      </span>
      <Toggle label="Lisser sur le reste du cycle" detail="Elle réduit un peu le budget de chaque jour restant, au lieu de peser sur la seule journée." checked={line.smoothed} onChange={(v) => onPatch(line.allocationId, { smoothed: v })} />
      <Toggle label="Financée par l’épargne" detail="Payée avec de l’argent venu d’un compte d’épargne : elle ne pèse pas dans le budget du cycle." checked={line.fundedBySavings} onChange={(v) => onPatch(line.allocationId, { fundedBySavings: v })} />
      <Button block onClick={onClose}>
        Fermer
      </Button>
    </Form>
  );
}

// ---------------------------------------------------------------- une enveloppe

const OVER = [['DEDUCT_NEXT', 'Déduit du cycle suivant'], ['FORGIVE', 'Oublié']] as const;
const blankEnvelope = (order: number): Envelope => ({ id: newId('env'), name: '', cap: null, inDailyBudget: true, endPolicy: 'RESET', overspendPolicy: 'DEDUCT_NEXT', isDefault: false, order, categoryIds: [] });

export function EnvelopeSheet({ value, categories, envelopes, onClose, onSave, onRemove }: { value: Envelope | 'new' | null; categories: Category[]; envelopes: Envelope[]; onClose: () => void; onSave: (e: Envelope) => void; onRemove: (id: string) => void }) {
  const [e, setE] = useState<Envelope>(() => blankEnvelope(0));
  const [cap, setCap] = useState('');
  useEffect(() => {
    const next = value && value !== 'new' ? value : blankEnvelope(envelopes.length);
    setE(next);
    setCap(text(next.cap));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  if (!value) return null;
  const isNew = value === 'new';
  const set = (patch: Partial<Envelope>) => setE((x) => ({ ...x, ...patch }));
  const amount = cap.trim() ? cents(cap) : null;
  const ready = e.name.trim().length > 0 && (!cap.trim() || amount !== null);
  const owner = (id: string) => envelopes.find((x) => x.id !== e.id && x.categoryIds.includes(id))?.name;
  return (
    <Form open title={isNew ? 'Nouvelle enveloppe' : e.name} onClose={onClose}>
      <Field id="env-name" label="Nom">
        <input id="env-name" value={e.name} onChange={(ev) => set({ name: ev.target.value })} placeholder="Shopping, sorties, vacances…" />
      </Field>
      <Field id="env-cap" label="Plafond par cycle" hint="Vide : pas de plafond.">
        <input id="env-cap" inputMode="decimal" value={cap} onChange={(ev) => setCap(ev.target.value)} placeholder="100" />
      </Field>
      {!e.isDefault && <Toggle label="Dans le budget quotidien" detail="Sinon son argent est mis à part : retiré du pot du quotidien et du cash libre." checked={e.inDailyBudget} onChange={(v) => set({ inDailyBudget: v })} />}
      <Select id="env-end" label="Excédent en fin de cycle" value={e.endPolicy} options={END} onChange={(endPolicy) => set({ endPolicy })} />
      <Select id="env-over" label="Dépassement" value={e.overspendPolicy} options={OVER} onChange={(overspendPolicy) => set({ overspendPolicy })} />
      {!e.isDefault && (
        <div className="stack-0">
          <span className="t-label muted" style={{ padding: '4px 0' }}>Ses catégories</span>
          {categories.length === 0 && <span className="t-small muted">Aucune catégorie de dépense.</span>}
          {categories.map((c) => (
            <Toggle key={c.id} label={c.name} detail={owner(c.id) ? `aujourd’hui dans « ${owner(c.id)} »` : undefined} checked={e.categoryIds.includes(c.id)} onChange={(v) => set({ categoryIds: v ? [...e.categoryIds, c.id] : e.categoryIds.filter((x) => x !== c.id) })} />
          ))}
        </div>
      )}
      <Button variant="action" block disabled={!ready} onClick={() => onSave({ ...e, name: e.name.trim(), cap: amount })}>
        Enregistrer
      </Button>
      {!isNew && !e.isDefault && (
        <Button variant="danger" block onClick={() => onRemove(e.id)}>
          Supprimer
        </Button>
      )}
    </Form>
  );
}
