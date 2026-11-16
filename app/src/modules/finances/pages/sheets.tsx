import { useEffect, useState } from 'react';
import { Button, Field, Notice } from '@mylife/kit';
import { euros } from '../core/format';
import type { Occurrence } from '../engine/occurrences';
import type { ToClassify } from '../engine/automation';
import { roleDefaults, type Account, type Category, type Commitment, type Db, type Envelope, type Flow, type OccurrenceOverride, type Provision, type Receivable, type Rhythm, type Role, type Rule, type Tag } from '../engine/schema';
import type { AccountPatch, AllocationPatch } from '../engine/state';
import { Form, Select, Toggle } from './controls';
import { categoryOptions, cents, day, END, FLOWS, KIND, ROLES, SCOPES } from './labels';

/**
 * Les feuilles de réglage de l'étape M2 : une échéance, un engagement, un paiement en plusieurs fois, une poche, une
 * dépense, une enveloppe. Fonctionnelles et sobres : les écrans définitifs viennent en M4 et M5.
 */

const text = (c: number | null | undefined) => (c === null || c === undefined ? '' : String(c / 100).replace('.', ','));
const newId = (prefix: string) => `${prefix}:${crypto.randomUUID().slice(0, 8)}`;

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
  /** Déjà avancé pour d'autres sur cette dépense. */
  advanced: number;
  tagIds: string[];
}

export function ExpenseSheet({ line, tags, onClose, onPatch, onAdvance }: { line: ExpenseLine | null; tags: Tag[]; onClose: () => void; onPatch: (id: string, patch: AllocationPatch) => void; onAdvance: (allocationId: string, person: string, amount: number) => void }) {
  const [person, setPerson] = useState('');
  const [amount, setAmount] = useState('');
  const id = line?.allocationId;
  useEffect(() => {
    setPerson('');
    setAmount('');
  }, [id]);
  if (!line) return null;
  const a = cents(amount);
  const room = -line.amount - line.advanced;
  const tooMuch = a !== null && a > room;
  return (
    <Form open title={line.label} onClose={onClose}>
      <span className="t-small muted">
        {euros(line.amount)} le {day(line.date)}.{line.advanced > 0 ? ` Dont ${euros(line.advanced)} avancés pour d’autres.` : ''}
      </span>
      <Toggle label="Lisser sur le reste du cycle" detail="Elle réduit un peu le budget de chaque jour restant, au lieu de peser sur la seule journée." checked={line.smoothed} onChange={(v) => onPatch(line.allocationId, { smoothed: v })} />
      <Toggle label="Financée par l’épargne" detail="Payée avec de l’argent venu d’un compte d’épargne : elle ne pèse pas dans le budget du cycle." checked={line.fundedBySavings} onChange={(v) => onPatch(line.allocationId, { fundedBySavings: v })} />
      {tags.length > 0 && <span className="t-label muted" style={{ paddingTop: 6 }}>Tags</span>}
      {tags.map((t) => (
        <Toggle key={t.id} label={t.name} checked={line.tagIds.includes(t.id)} onChange={(v) => onPatch(line.allocationId, { tagIds: v ? [...line.tagIds, t.id] : line.tagIds.filter((x) => x !== t.id) })} />
      ))}
      <span className="t-label muted" style={{ paddingTop: 6 }}>Avancé pour quelqu’un</span>
      <span className="t-small muted">La part avancée sort du budget et te reste due, jusqu’à ce que la personne te rembourse.</span>
      <div className="grid-2">
        <Field id="adv-person" label="Pour qui">
          <input id="adv-person" value={person} onChange={(e) => setPerson(e.target.value)} placeholder="Prénom" />
        </Field>
        <Field id="adv-amount" label="Sa part" error={tooMuch ? `Au plus ${euros(room)}.` : null}>
          <input id="adv-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
        </Field>
      </div>
      <Button
        block
        disabled={!person.trim() || a === null || a === 0 || tooMuch}
        onClick={() => {
          onAdvance(line.allocationId, person.trim(), a ?? 0);
          setPerson('');
          setAmount('');
        }}
      >
        Ajouter cette avance
      </Button>
      <Button variant="quiet" onClick={onClose}>
        Terminé
      </Button>
    </Form>
  );
}

// ---------------------------------------------------------------- une avance à récupérer

export function ReceivableSheet({ value, origin, incomes, onClose, onSettle, onWriteOff, onRemove }: { value: Receivable | null; origin: string; incomes: { allocationId: string; label: string; date: string; amount: number }[]; onClose: () => void; onSettle: (id: string, allocationId: string | null) => void; onWriteOff: (id: string) => void; onRemove: (id: string) => void }) {
  const [income, setIncome] = useState('');
  const id = value?.id;
  const guess = value ? (incomes.find((i) => i.amount === value.amount)?.allocationId ?? '') : '';
  useEffect(() => setIncome(guess), [id, guess]);
  if (!value) return null;
  return (
    <Form open title={`${value.person} te doit ${euros(value.amount)}`} onClose={onClose}>
      <span className="t-small muted">Avancé sur « {origin} ».</span>
      <Select id="rec-income" label="Remboursé par" value={income} options={[['', 'Autrement (espèces, pas encore visible…)'], ...incomes.map((i) => [i.allocationId, `${i.label} · ${euros(i.amount)} · ${day(i.date)}`] as const)]} onChange={setIncome} hint="La rentrée d’argent choisie solde l’avance : elle ne compte ni comme revenu, ni dans le budget." />
      <Button variant="action" block onClick={() => onSettle(value.id, income || null)}>
        C’est remboursé
      </Button>
      <div className="grid-2">
        <Button onClick={() => onWriteOff(value.id)}>Je ne le reverrai pas</Button>
        <Button onClick={() => onRemove(value.id)}>Annuler l’avance</Button>
      </div>
      <span className="t-small muted">« Je ne le reverrai pas » : la part redevient une dépense, aujourd’hui.</span>
    </Form>
  );
}

// ---------------------------------------------------------------- classer

export function ClassifySheet({ group, categories, onClose, onSave }: { group: ToClassify | null; categories: Category[]; onClose: () => void; onSave: (g: ToClassify, flow: Flow, categoryId: string | null, wholeMerchant: boolean) => void }) {
  const key = group?.key;
  const incoming = (group?.total ?? 0) > 0;
  const [flow, setFlow] = useState<Flow>('EXPENSE');
  const [categoryId, setCategoryId] = useState('');
  const [whole, setWhole] = useState(true);
  useEffect(() => {
    setFlow(incoming ? 'INCOME' : 'EXPENSE');
    setCategoryId('');
    setWhole(true);
  }, [key, incoming]);
  if (!group) return null;
  const needsCategory = flow === 'EXPENSE';
  return (
    <Form open title={group.name} onClose={onClose}>
      <span className="t-small muted">
        {group.count} opération{group.count > 1 ? 's' : ''}, {euros(group.total)}. D’abord ce que c’est, puis sa catégorie si c’est une dépense.
      </span>
      <Select id="cls-flow" label="C’est" value={flow} options={FLOWS} onChange={setFlow} />
      {needsCategory && <Select id="cls-cat" label="Catégorie" value={categoryId} options={[['', 'Choisir…'], ...categoryOptions(categories)]} onChange={setCategoryId} />}
      {group.merchantId && <Toggle label="Pour tout ce marchand" detail="Ses opérations passées et à venir seront classées de la même façon." checked={whole} onChange={setWhole} />}
      <Button variant="action" block disabled={needsCategory && !categoryId} onClick={() => onSave(group, flow, needsCategory ? categoryId : null, whole && !!group.merchantId)}>
        Classer
      </Button>
    </Form>
  );
}

// ---------------------------------------------------------------- une règle de tri

const DIRECTIONS = [['any', 'Entrées et sorties'], ['debit', 'Sorties seulement'], ['credit', 'Entrées seulement']] as const;
const blankRule = (priority: number): Rule => ({ id: newId('regle'), name: '', priority, enabled: true, merchantId: null, keywords: [], accountIds: [], amountMin: null, amountMax: null, direction: 'any', flow: 'EXPENSE', categoryId: null, tagIds: [] });

export function RuleSheet({ value, categories, tags, count, onClose, onSave, onRemove }: { value: Rule | 'new' | null; categories: Category[]; tags: Tag[]; count: number; onClose: () => void; onSave: (r: Rule) => void; onRemove: (id: string) => void }) {
  const [r, setR] = useState<Rule>(() => blankRule(0));
  const [words, setWords] = useState('');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  useEffect(() => {
    const next = value && value !== 'new' ? value : blankRule(count + 1);
    setR(next);
    setWords(next.keywords.join(', '));
    setMin(text(next.amountMin));
    setMax(text(next.amountMax));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  if (!value) return null;
  const isNew = value === 'new';
  const set = (patch: Partial<Rule>) => setR((x) => ({ ...x, ...patch }));
  const keywords = words.split(',').map((w) => w.trim()).filter(Boolean);
  const amountMin = min.trim() ? cents(min) : null;
  const amountMax = max.trim() ? cents(max) : null;
  const badAmount = (min.trim() && amountMin === null) || (max.trim() && amountMax === null);
  const ready = (keywords.length > 0 || amountMin !== null || amountMax !== null) && !badAmount && (r.flow !== 'EXPENSE' || !!r.categoryId);
  return (
    <Form open title={isNew ? 'Nouvelle règle de tri' : r.name || 'Règle de tri'} onClose={onClose}>
      <Field id="rule-words" label="Le libellé contient" hint="Des mots entiers, séparés par des virgules : l’un d’eux suffit.">
        <input id="rule-words" value={words} onChange={(e) => setWords(e.target.value)} placeholder="boulangerie, fournil" />
      </Field>
      <Select id="rule-dir" label="Sens" value={r.direction} options={DIRECTIONS} onChange={(direction) => set({ direction })} />
      <div className="grid-2">
        <Field id="rule-min" label="Montant minimal">
          <input id="rule-min" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} placeholder="aucun" />
        </Field>
        <Field id="rule-max" label="Montant maximal">
          <input id="rule-max" inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} placeholder="aucun" />
        </Field>
      </div>
      <Select id="rule-flow" label="Alors c’est" value={r.flow} options={FLOWS} onChange={(flow) => set({ flow })} />
      {r.flow === 'EXPENSE' && <Select id="rule-cat" label="Catégorie" value={r.categoryId ?? ''} options={[['', 'Choisir…'], ...categoryOptions(categories)]} onChange={(id) => set({ categoryId: id || null })} />}
      {tags.length > 0 && <span className="t-label muted">Et porte les tags</span>}
      {tags.map((t) => (
        <Toggle key={t.id} label={t.name} checked={r.tagIds.includes(t.id)} onChange={(v) => set({ tagIds: v ? [...r.tagIds, t.id] : r.tagIds.filter((x) => x !== t.id) })} />
      ))}
      <Toggle label="Active" checked={r.enabled} onChange={(v) => set({ enabled: v })} />
      <Button variant="action" block disabled={!ready} onClick={() => onSave({ ...r, name: r.name || keywords.join(', ') || 'Par montant', keywords, amountMin, amountMax, categoryId: r.flow === 'EXPENSE' ? r.categoryId : null })}>
        Enregistrer
      </Button>
      {!isNew && (
        <Button variant="danger" block onClick={() => onRemove(r.id)}>
          Supprimer
        </Button>
      )}
    </Form>
  );
}

// ---------------------------------------------------------------- un compte

const SHARES = [['1', 'À moi seul'], ['0.5', 'Partagé à deux (50 %)']] as const;

/** Régler un compte, ou en créer un à la main (espèces, bien, dette, compte de provision). */
export function AccountSheet({ value, onClose, onPatch, onCreate }: { value: Account | 'new' | null; onClose: () => void; onPatch: (id: string, patch: AccountPatch) => void; onCreate: (a: Account) => void }) {
  const existing = value && value !== 'new' ? value : null;
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('CASH');
  const [balance, setBalance] = useState('');
  const [closing, setClosing] = useState('25');
  const [debit, setDebit] = useState('5');
  const id = existing?.id ?? (value === 'new' ? 'new' : null);
  useEffect(() => {
    setName(existing?.name ?? '');
    setRole(existing?.role ?? 'CASH');
    setBalance(text(existing?.balance));
    setClosing(existing?.deferredDebit ? String(existing.deferredDebit.closingDay) : '25');
    setDebit(existing?.deferredDebit ? String(existing.deferredDebit.debitDay) : '5');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  if (!value) return null;
  const amount = cents(balance);
  if (!existing)
    return (
      <Form open title="Nouveau compte" onClose={onClose}>
        <span className="t-small muted">Un compte tenu à la main : des espèces, un bien, une dette, un compte de provision. Son solde se saisit.</span>
        <Field id="acc-name" label="Nom">
          <input id="acc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Portefeuille, voiture, prêt…" />
        </Field>
        <Select id="acc-role" label="Rôle" value={role} options={ROLES} onChange={setRole} />
        <Field id="acc-balance" label={role === 'LIABILITY' ? 'Reste à rembourser' : 'Solde ou valeur'}>
          <input id="acc-balance" inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="0" />
        </Field>
        <Button
          variant="action"
          block
          disabled={!name.trim() || amount === null}
          onClick={() => onCreate({ id: newId('compte'), name: name.trim(), provider: '', role, ...roleDefaults(role), currency: 'EUR', ownershipRatio: 1, alertThreshold: null, deferredDebit: null, source: 'manual', balance: amount ?? 0, balanceAt: Date.now(), archivedAt: null })}
        >
          Créer
        </Button>
      </Form>
    );
  const dayOf = (v: string) => Math.max(1, Math.min(31, Math.trunc(Number(v)) || 1));
  const deferred = existing.deferredDebit !== null;
  const manual = existing.source === 'manual';
  return (
    <Form open title={existing.name} onClose={onClose}>
      <Field id="acc-name" label="Nom">
        <input id="acc-name" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name.trim() !== existing.name && onPatch(existing.id, { name: name.trim() })} />
      </Field>
      {manual && (
        <Field id="acc-balance" label={existing.role === 'LIABILITY' ? 'Reste à rembourser' : 'Solde ou valeur'}>
          <input id="acc-balance" inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} onBlur={() => amount !== null && amount !== existing.balance && onPatch(existing.id, { balance: amount })} />
        </Field>
      )}
      <Select id="acc-role" label="Rôle" value={existing.role} options={ROLES} onChange={(r: Role) => onPatch(existing.id, { role: r })} hint="Le rôle décrit le compte ; ce sont les réglages ci-dessous qui comptent dans les calculs." />
      <Toggle label="Dans le cash quotidien" detail="Son solde fait partie de l’argent du quotidien." checked={existing.includeInDailyCash} onChange={(v) => onPatch(existing.id, { includeInDailyCash: v })} />
      <Toggle label="Dans le patrimoine" checked={existing.includeInNetWorth} onChange={(v) => onPatch(existing.id, { includeInNetWorth: v })} />
      <Select id="acc-share" label="Ce compte est" value={existing.ownershipRatio === 0.5 ? '0.5' : '1'} options={SHARES} onChange={(v) => onPatch(existing.id, { ownershipRatio: Number(v) })} />
      <Toggle label="Carte à débit différé" detail="Ses achats sont prélevés en une fois : d’ici là, leur total est retiré du cash libre." checked={deferred} onChange={(v) => onPatch(existing.id, { deferredDebit: v ? { closingDay: dayOf(closing), debitDay: dayOf(debit) } : null })} />
      {deferred && (
        <div className="grid-2">
          <Field id="acc-closing" label="Jour d’arrêté">
            <input id="acc-closing" inputMode="numeric" value={closing} onChange={(e) => { setClosing(e.target.value); onPatch(existing.id, { deferredDebit: { closingDay: dayOf(e.target.value), debitDay: dayOf(debit) } }); }} />
          </Field>
          <Field id="acc-debit" label="Jour de prélèvement">
            <input id="acc-debit" inputMode="numeric" value={debit} onChange={(e) => { setDebit(e.target.value); onPatch(existing.id, { deferredDebit: { closingDay: dayOf(closing), debitDay: dayOf(e.target.value) } }); }} />
          </Field>
        </div>
      )}
      <Button variant="action" block onClick={onClose}>
        Terminé
      </Button>
      {manual && (
        <Button variant="danger" block onClick={() => { onPatch(existing.id, { archivedAt: Date.now() }); onClose(); }}>
          Retirer ce compte
        </Button>
      )}
    </Form>
  );
}

// ---------------------------------------------------------------- une catégorie

const COLORS = ['#2dd4bf', '#fbbf24', '#60a5fa', '#a3e635', '#fb923c', '#c084fc', '#f472b6', '#6fe0a0', '#5ccbe6', '#94a3b8'];
const blankCategory = (order: number): Category => ({ id: newId('cat'), parentId: null, scope: 'EXPENSE', name: '', color: COLORS[order % COLORS.length]!, order, archivedAt: null, mergedIntoId: null });

export function CategorySheet({ value, all, uses, onClose, onSave, onArchive, onMerge, onRemove }: { value: Category | 'new' | null; all: Category[]; uses: number; onClose: () => void; onSave: (c: Category) => void; onArchive: (id: string, at: number | null) => void; onMerge: (from: string, into: string) => void; onRemove: (id: string) => void }) {
  const [c, setC] = useState<Category>(() => blankCategory(0));
  const [into, setInto] = useState('');
  useEffect(() => {
    setC(value && value !== 'new' ? value : blankCategory(all.length));
    setInto('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  if (!value) return null;
  const isNew = value === 'new';
  const set = (patch: Partial<Category>) => setC((x) => ({ ...x, ...patch }));
  const live = all.filter((x) => !x.archivedAt && !x.mergedIntoId && x.scope === c.scope && x.id !== c.id);
  const hasChildren = all.some((x) => x.parentId === c.id && !x.mergedIntoId);
  const parents = live.filter((x) => !x.parentId);
  return (
    <Form open title={isNew ? 'Nouvelle catégorie' : c.name || 'Catégorie'} onClose={onClose}>
      <Field id="cat-name" label="Nom">
        <input id="cat-name" value={c.name} onChange={(e) => set({ name: e.target.value })} placeholder="Courses, sorties, salaire…" />
      </Field>
      {isNew && <Select id="cat-scope" label="Elle range" value={c.scope} options={SCOPES} onChange={(scope) => set({ scope, parentId: null })} />}
      <Select id="cat-parent" label="Sous-catégorie de" value={c.parentId ?? ''} options={[['', 'Aucune : catégorie de premier niveau'], ...parents.map((p) => [p.id, p.name] as const)]} onChange={(id) => set({ parentId: id || null })} hint={hasChildren ? 'Elle a des sous-catégories : elle reste au premier niveau (deux niveaux au plus).' : 'Deux niveaux au plus.'} />
      <Field id="cat-color" label="Couleur">
        <input id="cat-color" type="color" value={c.color} onChange={(e) => set({ color: e.target.value })} style={{ padding: 4 }} />
      </Field>
      <Button variant="action" block disabled={!c.name.trim()} onClick={() => onSave(hasChildren ? { ...c, parentId: null } : c)}>
        Enregistrer
      </Button>
      {!isNew && (
        <>
          <Select id="cat-merge" label="Fusionner dans" value={into} options={[['', 'Choisir une catégorie…'], ...categoryOptions(live)]} onChange={setInto} hint="Tout son historique se lira comme celui de l’autre. Aucune opération n’est réécrite." />
          <Button block disabled={!into} onClick={() => onMerge(c.id, into)}>
            Fusionner
          </Button>
          <Button variant="danger" block onClick={() => onArchive(c.id, c.archivedAt ? null : Date.now())}>
            {c.archivedAt ? 'Restaurer' : 'Archiver'}
          </Button>
          {uses === 0 ? (
            <Button variant="danger" block onClick={() => onRemove(c.id)}>
              Supprimer
            </Button>
          ) : (
            <span className="t-small muted">Elle sert encore (opérations, règles ou sous-catégories) : pour t’en défaire, fusionne-la ou archive-la.</span>
          )}
        </>
      )}
    </Form>
  );
}

// ---------------------------------------------------------------- un tag

export function TagSheet({ value, onClose, onSave, onRemove }: { value: Tag | 'new' | null; onClose: () => void; onSave: (t: Tag) => void; onRemove: (id: string) => void }) {
  const [name, setName] = useState('');
  useEffect(() => setName(value && value !== 'new' ? value.name : ''), [value]);
  if (!value) return null;
  const existing = value === 'new' ? null : value;
  return (
    <Form open title={existing ? `#${existing.name}` : 'Nouveau tag'} onClose={onClose}>
      <span className="t-small muted">Une étiquette libre, en plus de la catégorie, pour retrouver des dépenses transverses. Elle n’entre dans aucun calcul.</span>
      <Field id="tag-name" label="Nom">
        <input id="tag-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Imprévu, week-end, pro…" />
      </Field>
      <Button variant="action" block disabled={!name.trim()} onClick={() => onSave({ id: existing?.id ?? newId('tag'), name: name.trim().replace(/^#/, ''), archivedAt: null })}>
        Enregistrer
      </Button>
      {existing && (
        <Button variant="danger" block onClick={() => onRemove(existing.id)}>
          Supprimer
        </Button>
      )}
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
            <Toggle key={c.id} label={c.parentId ? `${categories.find((p) => p.id === c.parentId)?.name ?? ''} › ${c.name}` : c.name} detail={owner(c.id) ? `aujourd’hui dans « ${owner(c.id)} »` : undefined} checked={e.categoryIds.includes(c.id)} onChange={(v) => set({ categoryIds: v ? [...e.categoryIds, c.id] : e.categoryIds.filter((x) => x !== c.id) })} />
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
