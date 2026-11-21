import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button, Glass, Icon } from '@mylife/kit';
import { addDays, daysInMonth, diffDays, parseISO, toISO, weekday } from '../core/dates';
import { euros } from '../core/format';
import { useEngine } from '../data/engineStore';
import { detectRecurring } from '../engine/automation';
import { dueDates, type Occurrence } from '../engine/occurrences';
import type { Commitment, Envelope, Provision } from '../engine/schema';
import { acceptSuggestion, addInstallmentPlan, decideOccurrence, ignoreSuggestion, removeCommitment, removeEnvelope, removeInstallmentPlan, removeProvision, saveCommitment, saveEnvelope, saveProvision } from '../engine/state';
import { forecast } from '../engine/views';
import { MiniRing, TreasuryChart } from './charts';
import { AskCopilot, Avatar, Screen, Sec } from './common';
import { opViews } from './opViews';
import { envelopeOf, type Explanation } from '../engine/engine';
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
const longDay = (iso: string) => new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${iso}T12:00:00`));
/** L'état d'une échéance, en une pastille. */
const STATE = {
  PAID: { label: 'payé', tone: 'ok' },
  SKIPPED: { label: 'sauté', tone: 'muted' },
  PARTIAL: { label: 'en partie', tone: 'warn' },
  DUE: { label: 'à venir', tone: 'muted' },
  LATE: { label: 'en retard', tone: 'warn' },
} as const;
/** Une couleur stable par libellé, pour la pastille d'une échéance (loyer, box, assurance…). */
const TINTS = ['#f9a8d4', '#ffd08a', '#9be9f8', '#cdbeff', '#ffb07a', '#9bf0b7', '#7fe6f7', '#ffc29b'];
const tint = (label: string) => TINTS[[...label.toLowerCase()].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % TINTS.length]!;

/** En tête du Plan : où va le revenu du cycle, en une barre (charges, épargne, reste à vivre, le dépensé hachuré). */
function IncomeCard({ e, spent }: { e: Explanation; spent: number }) {
  const charges = e.charges + e.offPlanPaid + e.reserve;
  const reste = Math.max(0, e.pot);
  const total = Math.max(1, charges + e.epargne + reste);
  const spentPart = reste > 0 ? Math.min(1, spent / reste) : 0;
  const paid = e.occurrences.filter((o) => (o.commitment.kind === 'CHARGE' || o.commitment.kind === 'INSTALLMENT') && o.status === 'PAID').reduce((s, o) => s + (o.actual ?? o.expected), 0);
  const saved = e.occurrences.filter((o) => o.commitment.kind === 'SAVING' && o.status === 'PAID').reduce((s, o) => s + (o.actual ?? o.expected), 0);
  return (
    <>
      <Sec action={`${short(e.revenus)} attendus`}>Où va ton revenu ce cycle</Sec>
      <Glass style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <span className="grow" style={{ display: 'flex', flexDirection: 'column' }}>
            <span className="t-small muted">Reste à vivre</span>
            <span className="fin-num" style={{ fontSize: 40, lineHeight: 1 }}>{short(reste)}</span>
          </span>
          <span className="t-small" style={{ textAlign: 'right' }}>
            <b>{short(spent)}</b> <span className="muted">dépensés</span>
            <br />
            {e.resteEnveloppe >= 0 ? <span className="c-ok" style={{ fontWeight: 700 }}>{short(e.resteEnveloppe)} pour {e.daysLeft} jour{e.daysLeft > 1 ? 's' : ''}</span> : <span style={{ fontWeight: 700, color: 'var(--warn)' }}>dépassé de {short(-e.resteEnveloppe)}</span>}
          </span>
        </div>
        <div className="fin-income" role="img" aria-label={`Où vont tes revenus du cycle : ${short(e.revenus)} ; charges ${short(charges)}, épargne ${short(e.epargne)}, reste à vivre ${short(reste)} dont ${short(spent)} dépensés`}>
          <span style={{ flex: charges, background: 'linear-gradient(160deg,#f9a8d4,#db2777)' }} />
          {e.epargne > 0 && <span style={{ flex: e.epargne, background: 'linear-gradient(160deg,#9bf0b7,#2fb36a)' }} />}
          <span style={{ flex: reste, background: 'linear-gradient(160deg,#cdbeff,#7b5cff)', position: 'relative', overflow: 'hidden' }}>
            {spentPart > 0 && <i className="fin-income-spent" style={{ width: `${spentPart * 100}%` }} />}
          </span>
        </div>
        <div className="fin-income-legend">
          <span><span className="t-small muted"><i style={{ background: '#f472b6' }} />Charges</span><b className="fin-num">{short(charges)}</b><span className="t-small muted">{short(paid)} payés</span></span>
          <span><span className="t-small muted"><i style={{ background: '#6fe0a0' }} />Épargne</span><b className="fin-num">{short(e.epargne)}</b><span className="t-small muted">{short(saved)} mis de côté</span></span>
          <span><span className="t-small muted"><i style={{ background: '#a58bff' }} />Reste à vivre</span><b className="fin-num">{short(reste)}</b><span className="t-small muted">hachuré : dépensé</span></span>
        </div>
        {total > e.revenus + 1 && <span className="t-small muted">Le plan dépasse les revenus attendus de {short(total - e.revenus)}.</span>}
      </Glass>
    </>
  );
}


export function PlanPage() {
  const engine = useEngine();
  const [occurrence, setOccurrence] = useState<string | null>(null);
  const [month, setMonth] = useState(0);
  const [treasuryAt, setTreasuryAt] = useState<number | null>(null);
  const [envOpen, setEnvOpen] = useState<string | null>(null);
  const [envPage, setEnvPage] = useState(0);
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
        const cycleLength = diffDays(e.cycle.start, e.cycle.end) + 1;
        const cycleDay = Math.min(cycleLength, diffDays(e.cycle.start, today) + 1);
        const amount = (o: Occurrence) => (o.status === 'PAID' ? (o.actual ?? o.expected) : o.status === 'SKIPPED' ? 0 : o.expected);
        return (
          <>
            {e.revenus > 0 ? (
              <IncomeCard e={e} spent={e.spent} />
            ) : (
              <Glass style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <span className="t-card">Rien de prévu pour ce cycle</span>
                <span className="t-small muted">Ajoute ton revenu, tes charges et ton épargne : le reste à vivre et le budget du jour en découlent.</span>
                <Button variant="action" onClick={() => setCommitment('new')}>Ajouter un engagement</Button>
              </Glass>
            )}

            <Sec action="comptes du quotidien">Ta trésorerie jusqu’à la paie</Sec>
            <Glass style={{ padding: '16px 14px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="row" style={{ alignItems: 'flex-start' }} aria-live="polite">
                <span className="grow" style={{ display: 'flex', flexDirection: 'column' }}>
                  <span className="t-small muted">{treasuryAt === null ? 'Aujourd’hui' : longDay(points[treasuryAt]!.date)}</span>
                  <span className="fin-num" style={{ fontSize: 28, lineHeight: 1.1 }}>{short((treasuryAt === null ? points[0] : points[treasuryAt])?.balance ?? e.cash)}</span>
                  {treasuryAt !== null && points[treasuryAt]!.events.length > 0 && <span className="t-small muted">{points[treasuryAt]!.events.map((ev) => `${ev.label} ${euros(ev.amount, { round: true, sign: true })}`).join(' · ')}</span>}
                </span>
                <span className="fin-low" data-bad={low.balance < 0}>
                  <span className="fin-num" style={{ fontSize: 16 }}>{low.balance < 0 ? `sous zéro : ${short(low.balance)}` : `au plus bas ${short(low.balance)}`}</span>
                  <span className="t-small">le {day(low.date)}{low.date === e.cycle.end ? ', avant la paie' : ''}</span>
                </span>
              </div>
              <TreasuryChart points={points} low={low} format={short} labels={['auj.', day(e.cycle.end)]} picked={treasuryAt} onPick={setTreasuryAt} />
              <span className="t-small muted">Les marches sont tes échéances prévues ; entre elles, ton rythme de dépense. Glisse le doigt pour lire un jour.</span>
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
                      {(dots.get(d) ?? []).slice(0, 3).map((c, k) => (
                        <u key={k} style={{ background: c }} />
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

            <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
              <span className="fin-num" style={{ fontSize: 24 }}>Ce qui revient</span>
              <Button icon="plus" onClick={() => setCommitment('new')}>Ajouter</Button>
            </div>
            {GROUPS.map((g) => {
              const rows = e.occurrences.filter((o) => (g.kinds as readonly string[]).includes(o.commitment.kind));
              if (rows.length === 0) return null;
              const total = rows.reduce((s, o) => s + amount(o), 0);
              const done = rows.reduce((s, o) => s + (o.status === 'PAID' ? amount(o) : o.paid), 0);
              const paidCount = rows.filter((o) => o.status === 'PAID' || o.status === 'SKIPPED').length;
              const next = rows.filter((o) => o.status === 'DUE' || o.status === 'PARTIAL').sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
              const color = KIND_COLOR[g.kinds[0]];
              return (
                <section key={g.title} className="fin-group" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <Glass className="fin-group-head">
                    <MiniRing fraction={total > 0 ? done / total : 0} color={color} size={56} label={`${g.title} : ${paidCount} sur ${rows.length}`} text={`${paidCount}/${rows.length}`} />
                    <span className="grow" style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <span className="fin-num" style={{ fontSize: 20 }}>{g.title}</span>
                      <span className="t-small muted">
                        {short(done)} {g.done} sur {short(total)}
                        {next ? ` · prochaine ${next.dueDate <= today ? 'aujourd’hui' : `dans ${diffDays(today, next.dueDate)} j`}` : ''}
                      </span>
                    </span>
                  </Glass>
                  <Glass className="list" style={{ padding: '2px 16px' }}>
                    {rows.map((o) => {
                      const state = STATE[o.status === 'DUE' && o.dueDate < today ? 'LATE' : o.status];
                      return (
                        <button key={o.id} type="button" className="fin-occ" onClick={o.commitment.kind === 'INCOME' ? () => setCommitment(o.commitment) : () => setOccurrence(o.id)}>
                          <span className="fin-av" style={{ background: tint(o.commitment.label), width: 40, height: 40, borderRadius: 13 }} aria-hidden="true">{(o.commitment.label.trim()[0] ?? '?').toUpperCase()}</span>
                          <span className="grow" style={{ display: 'flex', flexDirection: 'column', minWidth: 0, textAlign: 'left' }}>
                            <span className="t-strong" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.commitment.label}</span>
                            <span className="t-small muted">
                              {o.status === 'PAID' ? `fait · ${day(o.dueDate)}` : o.status === 'SKIPPED' ? 'sauté ce cycle' : o.status === 'PARTIAL' ? `${short(o.paid)} versés, reste ${short(o.remaining)}` : o.dueDate < today ? `attendu depuis le ${day(o.dueDate)}` : o.dueDate === today ? 'aujourd’hui' : `dans ${diffDays(today, o.dueDate)} j · ${day(o.dueDate)}`}
                            </span>
                          </span>
                          <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                            <span className="fin-num" style={{ fontSize: 16 }}>{short(amount(o))}</span>
                            <span className="fin-badge" data-tone={state.tone}>{state.label}</span>
                          </span>
                        </button>
                      );
                    })}
                  </Glass>
                </section>
              );
            })}
            <div className="grid-2">
              <Button icon="plus" onClick={() => setCommitment('new')}>Un engagement</Button>
              <Button onClick={() => setInstallment(true)}>Payer en plusieurs fois</Button>
            </div>
            <AskCopilot question="Je finis le mois dans le vert ? Quelles charges pourrais-je réduire ?" />

            <Sec action="Ajouter" onAction={() => setEnvelope('new')}>Budgets par enveloppe</Sec>
            {capped.length === 0 ? (
              <span className="t-small muted">Aucune enveloppe plafonnée. Facultatif : un plafond par cycle pour les courses, les sorties…</span>
            ) : (
              <>
                <span className="t-small muted">Un plafond par cycle pour ce que tu veux surveiller. Glisse pour passer d’une enveloppe à l’autre.</span>
                <div className="fin-envs" onScroll={(ev) => setEnvPage(Math.round(ev.currentTarget.scrollLeft / 262))}>
                  {capped.map((x) => {
                    const budget = x.budget!;
                    const over = x.spent > budget;
                    const ideal = Math.round((budget * cycleDay) / cycleLength);
                    const lit = (envOpen ?? capped[0]!.envelope.id) === x.envelope.id;
                    return (
                      <button key={x.envelope.id} type="button" className="glass fin-env" data-on={lit} onClick={() => setEnvOpen(x.envelope.id)} aria-pressed={lit}>
                        <span className="row" style={{ alignItems: 'flex-start' }}>
                          <span className="grow" style={{ display: 'flex', flexDirection: 'column', textAlign: 'left', minWidth: 0 }}>
                            <span className="t-small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.envelope.name}</span>
                            <span><span className="fin-num" style={{ fontSize: 28 }}>{short(x.spent)}</span><span className="t-small muted"> / {short(budget)}</span></span>
                          </span>
                          <MiniRing fraction={x.spent / budget} color={over ? '#ff9a62' : '#5ccbe6'} size={60} label={`${x.envelope.name} : ${Math.round((x.spent / budget) * 100)} % du budget`} />
                        </span>
                        <span className="bar" style={{ height: 8, borderRadius: 99, background: 'var(--line)', overflow: 'hidden', display: 'block' }}>
                          <i style={{ display: 'block', height: '100%', width: `${Math.min(100, (x.spent / budget) * 100)}%`, borderRadius: 99, background: over ? 'linear-gradient(90deg,#ffb07a,#f0601c)' : 'linear-gradient(90deg,#7fe6f7,#1da6cc)' }} />
                        </span>
                        <span className="row t-small" style={{ justifyContent: 'space-between', gap: 6 }}>
                          <span className="muted">{over ? `dépassé de ${short(x.spent - budget)}` : `idéal aujourd’hui : ${short(ideal)}`}</span>
                          <span style={{ fontWeight: 700, color: over ? '#ff9a62' : x.spent <= ideal ? 'var(--ok)' : 'var(--warn)' }}>{over ? (x.envelope.overspendPolicy === 'DEDUCT_NEXT' ? 'déduit au cycle suivant' : 'oublié en fin de cycle') : x.spent <= ideal ? 'dans les temps' : 'en avance'}</span>
                        </span>
                        {!over && (
                          <span className="row" style={{ gap: 6 }}>
                            <span className="fin-badge">{short(budget - x.spent)} restants</span>
                            <span className="fin-badge">{short(Math.round((budget - x.spent) / Math.max(1, e.daysLeft)))} par jour</span>
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {capped.length > 1 && (
                  <div className="fin-dots" aria-hidden="true">
                    {capped.map((x, k) => (
                      <i key={x.envelope.id} data-on={k === Math.min(envPage, capped.length - 1)} />
                    ))}
                  </div>
                )}
                {(() => {
                  const sel = capped.find((x) => x.envelope.id === (envOpen ?? capped[0]!.envelope.id)) ?? capped[0]!;
                  const ops = opViews(db).filter((o) => o.tx.date >= e.cycle.start && o.tx.date <= today && o.lines.some((a) => a.flow === 'EXPENSE' && envelopeOf(db, a.categoryId).id === sel.envelope.id));
                  return (
                    <>
                      <Sec action="Modifier" onAction={() => setEnvelope(sel.envelope)}>{`${sel.envelope.name}, ce cycle · ${ops.length} opération${ops.length > 1 ? 's' : ''}`}</Sec>
                      {ops.length === 0 ? (
                        <span className="t-small muted">Rien dans cette enveloppe ce cycle.</span>
                      ) : (
                        <Glass className="list" style={{ padding: '2px 16px' }}>
                          {ops.slice(0, 8).map((o) => (
                            <Link key={o.tx.id} to={`/argent/operations?op=${encodeURIComponent(o.tx.id)}`} className="fin-op">
                              <Avatar op={o} />
                              <span className="grow" style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                                <span className="t-strong" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.name}</span>
                                <span className="t-small muted">{day(o.tx.date)}</span>
                              </span>
                              <span className="t-strong">{euros(o.tx.amount)}</span>
                            </Link>
                          ))}
                        </Glass>
                      )}
                    </>
                  );
                })()}
              </>
            )}

            <Sec action="Ajouter" onAction={() => setProvision('new')}>{`Poches · ${short(db.provisions.reduce((s, p) => s + p.amount, 0))} mis à part`}</Sec>
            <Glass style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <span className="t-small muted">Une poche bloque une somme sur ton compte pour une dépense à venir : elle ne compte plus dans ton budget du jour.</span>
              {db.provisions.length === 0 && <span className="t-small muted">Aucune poche pour l’instant.</span>}
              {db.provisions.map((pv) => {
                const covers = pv.commitmentId ? db.commitments.find((c) => c.id === pv.commitmentId) : undefined;
                const target = covers?.amount ?? null;
                return (
                  <button key={pv.id} type="button" className="fin-poche" onClick={() => setProvision(pv)}>
                    <span className="row" style={{ gap: 10 }}>
                      <span className="fin-lock" aria-hidden="true">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
                      </span>
                      <span className="grow" style={{ display: 'flex', flexDirection: 'column', textAlign: 'left', minWidth: 0 }}>
                        <span className="t-strong" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pv.label}</span>
                        <span className="t-small muted">{[db.accounts.find((a) => a.id === pv.accountId)?.name, pv.auto ? 'mise de côté chaque cycle' : covers ? `couvre « ${covers.label} »` : 'poche libre'].filter(Boolean).join(' · ')}</span>
                      </span>
                      <span className="fin-num" style={{ fontSize: 16 }}>{short(pv.amount)}</span>
                    </span>
                    {target ? (
                      <span style={{ display: 'block', height: 6, borderRadius: 99, background: 'var(--line)', overflow: 'hidden' }}>
                        <i style={{ display: 'block', height: '100%', width: `${Math.min(100, (pv.amount / target) * 100)}%`, background: 'linear-gradient(90deg,#cdbeff,#7b5cff)', borderRadius: 99 }} />
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </Glass>

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
