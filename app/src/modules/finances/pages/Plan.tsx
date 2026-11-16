import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Glass, Icon, List, ListRow } from '@mylife/kit';
import { addDays, daysInMonth, parseISO, toISO, weekday } from '../core/dates';
import { euros } from '../core/format';
import { useEngine } from '../data/engineStore';
import { detectRecurring } from '../engine/automation';
import { dueDates, type Occurrence } from '../engine/occurrences';
import type { Commitment, Envelope, Provision } from '../engine/schema';
import { acceptSuggestion, addInstallmentPlan, decideOccurrence, ignoreSuggestion, removeCommitment, removeEnvelope, removeInstallmentPlan, removeProvision, saveCommitment, saveEnvelope, saveProvision } from '../engine/state';
import { forecast } from '../engine/views';
import { FlowChart, ForecastChart, MiniRing } from './charts';
import { Screen, Sec } from './common';
import { day, RHYTHM } from './labels';
import { CommitmentSheet, EnvelopeSheet, InstallmentSheet, OccurrenceSheet, ProvisionSheet } from './sheets';

/**
 * Plan : « je finis le mois dans le vert ? ». Où vont les revenus du cycle, le solde jusqu'à la paie et son point
 * bas, le calendrier de ce qui tombe, puis la liste unique du prévu (revenus, charges, épargne) avec son état, les
 * budgets par enveloppe et les poches.
 */
const KIND_COLOR = { INCOME: '#5ccbe6', CHARGE: '#f472b6', INSTALLMENT: '#f472b6', SAVING: '#6fe0a0' } as const;
const GROUPS = [
  { kinds: ['INCOME'], title: 'Revenus', done: 'reçus' },
  { kinds: ['CHARGE', 'INSTALLMENT'], title: 'Charges', done: 'payés' },
  { kinds: ['SAVING'], title: 'Épargne', done: 'mis de côté' },
] as const;
const short = (v: number) => euros(v, { round: true });

function Status({ o }: { o: Occurrence }) {
  return (
    <span className="fin-status" data-done={o.status === 'PAID'} data-part={o.status === 'PARTIAL'}>
      {o.status === 'PAID' && <Icon name="check" size={13} strong />}
    </span>
  );
}

export function PlanPage() {
  const engine = useEngine();
  const [occurrence, setOccurrence] = useState<string | null>(null);
  const [month, setMonth] = useState(0);
  // Le « + » de la navigation, sur cet écran, ajoute un engagement.
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (params.get('ajouter') !== '1') return;
    setCommitment('new');
    params.delete('ajouter');
    setParams(params, { replace: true });
  }, [params, setParams]);
  const [commitment, setCommitment] = useState<Commitment | 'new' | null>(null);
  const [installment, setInstallment] = useState(false);
  const [provision, setProvision] = useState<Provision | 'new' | null>(null);
  const [envelope, setEnvelope] = useState<Envelope | 'new' | null>(null);
  return (
    <Screen engine={engine} tone="plan" title="Plan" kicker={engine.explanation ? `Cycle du ${day(engine.explanation.cycle.start)} au ${day(engine.explanation.cycle.end)}` : undefined}>
      {({ db, state, e, today, update }) => {
        const { points, low } = forecast(db, e);
        const suggestions = detectRecurring(db, today, state.ignoredSuggestions);
        const capped = e.envelopes.filter((x) => x.budget !== null && x.budget > 0);
        // Le calendrier : un mois entier, en semaines complètes. Dans le cycle en cours, ce qui reste dû ; hors du
        // cycle, les échéances prévues par le plan.
        const base = parseISO(today);
        const idx = base.y * 12 + (base.m - 1) + month;
        const [my, mm] = [Math.floor(idx / 12), (idx % 12) + 1];
        const monthStart = toISO(my, mm, 1);
        const monthEnd = toISO(my, mm, daysInMonth(my, mm));
        const first = addDays(monthStart, -((weekday(monthStart) + 6) % 7));
        const lastDay = addDays(monthEnd, (7 - weekday(monthEnd)) % 7);
        const cells: string[] = [];
        for (let d = first; d <= lastDay; d = addDays(d, 1)) cells.push(d);
        const dots = new Map<string, string[]>();
        const dot = (date: string, color: string) => dots.set(date, [...(dots.get(date) ?? []), color]);
        for (const o of e.occurrences) if (o.status === 'DUE' || o.status === 'PARTIAL') dot(o.dueDate < today ? today : o.dueDate, KIND_COLOR[o.commitment.kind]);
        // (un engagement « d'ici la fin du cycle » n'a pas de jour : il n'apparaît que dans le cycle en cours).
        for (const c of db.commitments.filter((x) => !(x.rhythm === 'MONTHLY' && x.anchorDay === null))) for (const d of dueDates(c, { start: first, end: lastDay })) if (d < e.cycle.start || d > e.cycle.end) dot(d, KIND_COLOR[c.kind]);
        const monthName = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(new Date(`${monthStart}T12:00:00`));
        const amount = (o: Occurrence) => (o.status === 'PAID' ? (o.actual ?? o.expected) : o.status === 'SKIPPED' ? 0 : o.expected);
        return (
          <>
            {e.revenus > 0 ? (
              <FlowChart revenus={e.revenus} charges={e.charges + e.offPlanPaid + e.reserve} epargne={e.epargne} reste={Math.max(0, e.pot)} format={short} />
            ) : (
              <Glass style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <span className="t-card">Rien de prévu pour ce cycle</span>
                <span className="t-small muted">Ajoute ton revenu, tes charges et ton épargne : le reste à vivre et le budget du jour en découlent.</span>
                <Button variant="action" onClick={() => setCommitment('new')}>Ajouter un engagement</Button>
              </Glass>
            )}
            <span className="t-small muted" style={{ textAlign: 'center' }}>
              {euros(e.spent, { round: true })} dépensés sur {euros(e.pot, { round: true })}.{' '}
              {e.resteEnveloppe >= 0 ? `Il reste ${euros(e.resteEnveloppe, { round: true })} pour ${e.daysLeft} jour${e.daysLeft > 1 ? 's' : ''}.` : `Dépassé de ${euros(-e.resteEnveloppe, { round: true })}.`}
            </span>

            <Sec action="comptes du quotidien">Ton solde jusqu’à la paie</Sec>
            <Glass style={{ padding: '16px 16px 10px' }}>
              <ForecastChart points={points} low={low} format={short} labels={['auj.', day(e.cycle.end)]} />
              <span className="t-small muted">
                {low.balance < 0 ? `À ce rythme, tes comptes passent sous zéro le ${day(low.date)}.` : `À ce rythme, tu gardes au moins ${short(low.balance)} sur tes comptes (le ${day(low.date)}).`}
              </span>
            </Glass>

            <Sec
              action={
                <span style={{ display: 'flex', gap: 10 }}>
                  <span style={{ color: KIND_COLOR.CHARGE }}>charge</span>
                  <span style={{ color: KIND_COLOR.SAVING }}>épargne</span>
                  <span style={{ color: KIND_COLOR.INCOME }}>revenu</span>
                </span>
              }
            >
              Ce qui tombe
            </Sec>
            <Glass style={{ padding: '10px 10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <button type="button" className="fin-cal-nav" aria-label="Mois précédent" onClick={() => setMonth((m) => m - 1)}><Icon name="back" size={16} /></button>
                <button type="button" className="fin-cal-month" onClick={() => setMonth(0)} aria-label={`${monthName} : revenir à ce mois-ci`}>{monthName}</button>
                <button type="button" className="fin-cal-nav" aria-label="Mois suivant" onClick={() => setMonth((m) => m + 1)} style={{ transform: 'scaleX(-1)' }}><Icon name="back" size={16} /></button>
              </div>
              <div className="fin-cal">
                {['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'].map((d) => (
                  <b key={d}>{d}</b>
                ))}
                {cells.map((d) => (
                  <span key={d} data-out={d < monthStart || d > monthEnd} data-past={d < today} data-today={d === today}>
                    {Number(d.slice(8))}
                    <i>
                      {(dots.get(d) ?? []).slice(0, 3).map((c, i) => (
                        <u key={i} style={{ background: c }} />
                      ))}
                    </i>
                  </span>
                ))}
              </div>
            </Glass>

            {suggestions.slice(0, 2).map((x) => (
              <Glass key={x.key} className="row" style={{ padding: '12px 16px', borderRadius: 16, flexWrap: 'wrap' }}>
                <span className="grow" style={{ display: 'flex', flexDirection: 'column', minWidth: 160 }}>
                  <span className="t-strong">{x.label}, {euros(x.amount)} {RHYTHM[x.rhythm]} ?</span>
                  <span className="t-small muted">Repéré {x.count} fois : l’ajouter au plan</span>
                </span>
                <span className="row" style={{ gap: 6 }}>
                  <Button onClick={() => update((s) => acceptSuggestion(s, x))}>Ajouter</Button>
                  <Button variant="quiet" onClick={() => update((s) => ignoreSuggestion(s, x.key))}>Non</Button>
                </span>
              </Glass>
            ))}

            {GROUPS.map((g) => {
              const rows = e.occurrences.filter((o) => (g.kinds as readonly string[]).includes(o.commitment.kind));
              if (rows.length === 0) return null;
              const total = rows.reduce((s, o) => s + amount(o), 0);
              const done = rows.reduce((s, o) => s + (o.status === 'PAID' ? amount(o) : o.paid), 0);
              return (
                <div key={g.title} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <Sec action={`${short(done)} ${g.done} sur ${short(total)}`}>{g.title}</Sec>
                  <List>
                    {rows.map((o) => (
                      <ListRow
                        key={o.id}
                        lead={<Status o={o} />}
                        title={o.commitment.label}
                        detail={o.status === 'PAID' ? 'fait' : o.status === 'SKIPPED' ? 'sauté ce cycle' : o.status === 'PARTIAL' ? `${short(o.paid)} versés, reste ${short(o.remaining)} · ${day(o.dueDate)}` : o.dueDate < today ? `attendu depuis le ${day(o.dueDate)}` : `le ${day(o.dueDate)}`}
                        value={short(amount(o))}
                        onClick={o.commitment.kind === 'INCOME' ? () => setCommitment(o.commitment) : () => setOccurrence(o.id)}
                      />
                    ))}
                  </List>
                </div>
              );
            })}
            <div className="grid-2">
              <Button onClick={() => setCommitment('new')}>Ajouter au plan</Button>
              <Button onClick={() => setInstallment(true)}>Payer en plusieurs fois</Button>
            </div>

            <Button block icon="plus" onClick={() => setCommitment('new')}>Ajouter un engagement</Button>

            <Sec action="Ajouter" onAction={() => setEnvelope('new')}>Budgets par enveloppe</Sec>
            {capped.length === 0 ? (
              <span className="t-small muted">Aucune enveloppe plafonnée. Facultatif : un plafond par cycle pour les courses, les sorties…</span>
            ) : (
              <Glass className="fin-rings">
                {capped.map((x) => (
                  <button key={x.envelope.id} type="button" onClick={() => setEnvelope(x.envelope)}>
                    <MiniRing fraction={x.spent / x.budget!} color="#5ccbe6" label={`${x.envelope.name} : ${Math.round((x.spent / x.budget!) * 100)} % du budget`} />
                    <span className="t-strong">{x.envelope.name}</span>
                    <span className="t-small muted" style={x.spent > x.budget! ? { color: '#ff9a62' } : undefined}>{x.spent > x.budget! ? `dépassé de ${short(x.spent - x.budget!)}` : `${short(x.budget! - x.spent)} restants`}</span>
                  </button>
                ))}
              </Glass>
            )}

            <Sec action="Ajouter" onAction={() => setProvision('new')}>Poches · {short(db.provisions.reduce((s, p) => s + p.amount, 0))} verrouillés</Sec>
            {db.provisions.length > 0 && (
              <List>
                {db.provisions.map((p) => (
                  <ListRow key={p.id} title={p.label} detail={[db.accounts.find((a) => a.id === p.accountId)?.name, p.auto ? 'provision automatique' : p.commitmentId ? `couvre « ${db.commitments.find((c) => c.id === p.commitmentId)?.label ?? '?'} »` : 'poche libre'].filter(Boolean).join(' · ')} value={short(p.amount)} onClick={() => setProvision(p)} />
                ))}
              </List>
            )}

            <OccurrenceSheet
              o={e.occurrences.find((o) => o.id === occurrence) ?? null}
              onClose={() => setOccurrence(null)}
              onDecide={(id, decision) => {
                update((s) => decideOccurrence(s, id, decision));
                setOccurrence(null);
              }}
              onEdit={(c) => {
                setOccurrence(null);
                setCommitment(c);
              }}
            />
            <CommitmentSheet
              value={commitment}
              db={db}
              onClose={() => setCommitment(null)}
              onSave={(c, opens) => {
                update((s) => {
                  const next = saveCommitment(s, c);
                  const opening = opens ? c.id : next.settings.openingCommitmentId === c.id ? null : next.settings.openingCommitmentId;
                  return { ...next, settings: { ...next.settings, openingCommitmentId: opening } };
                });
                setCommitment(null);
              }}
              onRemove={(id) => {
                const plan = db.commitments.find((c) => c.id === id)?.installmentPlanId;
                update((s) => (plan ? removeInstallmentPlan(s, plan) : removeCommitment(s, id)));
                setCommitment(null);
              }}
            />
            <InstallmentSheet
              open={installment}
              today={today}
              accounts={db.accounts.filter((a) => a.includeInDailyCash && !a.archivedAt)}
              onClose={() => setInstallment(false)}
              onSave={(input) => {
                update((s) => addInstallmentPlan(s, input));
                setInstallment(false);
              }}
            />
            <ProvisionSheet
              value={provision}
              db={db}
              onClose={() => setProvision(null)}
              onSave={(p) => {
                update((s) => saveProvision(s, p));
                setProvision(null);
              }}
              onRemove={(id) => {
                update((s) => removeProvision(s, id));
                setProvision(null);
              }}
            />
            <EnvelopeSheet
              value={envelope}
              categories={db.categories.filter((c) => !c.archivedAt && !c.mergedIntoId && c.scope === 'EXPENSE')}
              envelopes={db.envelopes}
              onClose={() => setEnvelope(null)}
              onSave={(env) => {
                update((s) => saveEnvelope(s, env));
                setEnvelope(null);
              }}
              onRemove={(id) => {
                update((s) => removeEnvelope(s, id));
                setEnvelope(null);
              }}
            />
          </>
        );
      }}
    </Screen>
  );
}
