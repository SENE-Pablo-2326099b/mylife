import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Glass, Icon, IconButton } from '@mylife/kit';
import { addDays } from '../core/dates';
import { euros } from '../core/format';
import { useEngine } from '../data/engineStore';
import { toClassify } from '../engine/automation';
import { lastCycles, pace, settledIn, spendByDay } from '../engine/views';
import { DayBars, PaceChart, Ring } from './charts';
import { AskCopilot, Avatar, Screen, Sec } from './common';
import { opViews } from './opViews';
import { day, KIND } from './labels';

/**
 * Jour : « combien je peux dépenser aujourd'hui ? ». Le chiffre au centre de l'anneau du cycle, les sept derniers
 * jours face au budget du jour, ce qui attend d'être classé, ce qui tombe bientôt, et les opérations du jour.
 */
const longDay = (iso: string) => new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${iso}T12:00:00`));
const TONE = { INCOME: '#5ccbe6', CHARGE: '#f472b6', INSTALLMENT: '#f472b6', SAVING: '#6fe0a0' } as const;

const DAYS = 14;

export function JourPage() {
  const engine = useEngine();
  const [paceDay, setPaceDay] = useState<number | null>(null);
  const [barDay, setBarDay] = useState<string | null>(null);
  return (
    <Screen engine={engine} tone="jour" kicker={longDay(engine.today)} title="Jour" right={<IconButton icon="settings" label="Réglages de MyFinances" href="/argent/reglages" />}>
      {({ db, e, today }) => {
        const over = e.resteAujourdhui < 0;
        const groups = toClassify(db);
        const settled = settledIn(db, lastCycles(db, today, 2));
        const week = spendByDay(db, settled, addDays(today, -(DAYS - 1)), today);
        const days = Array.from({ length: DAYS }, (_, i) => addDays(today, i - (DAYS - 1))).map((d) => ({ key: d, name: d === today ? 'auj.' : String(Number(d.slice(8))), value: Math.max(0, week.get(d) ?? 0), today: d === today }));
        const barPicked = days.find((d) => d.key === barDay) ?? null;
        const fortnight = days.reduce((sum, d) => sum + d.value, 0);
        const overDays = days.filter((d) => !d.today && d.value > e.budgetJour && e.budgetJour > 0).length;
        const upcoming = e.occurrences.filter((o) => o.status === 'DUE' || o.status === 'PARTIAL').slice(0, 8);
        const todays = opViews(db).filter((o) => o.tx.date === today);
        const left = Math.max(0, e.disponible - e.spentToday);
        const rhythm = pace(db, e, today);
        // Le curseur du graphique cumulé : un jour du cycle (0 = avant le premier jour), aujourd'hui sans geste.
        const at = paceDay ?? rhythm.day;
        const atDate = addDays(e.cycle.start, Math.max(0, at - 1));
        const atSpent = at <= rhythm.day ? (rhythm.current[at] ?? 0) : null;
        const atIdeal = Math.round((Math.max(0, rhythm.pot) * Math.min(at, rhythm.length)) / rhythm.length);
        const atPrevious = rhythm.previous.length > at ? rhythm.previous[at]! : null;
        const atGap = atSpent === null ? null : atIdeal - atSpent;
        return (
          <>
            <Ring fraction={e.pot > 0 ? e.spent / e.pot : e.spent > 0 ? 1 : 0} tone={over || e.deficit > 0 ? 'warn' : 'ok'} label={`${Math.round((e.pot > 0 ? e.spent / e.pot : 0) * 100)} % du budget du cycle déjà dépensé`}>
              <span className="t-small muted">{over ? 'Dépassé aujourd’hui de' : 'À dépenser aujourd’hui'}</span>
              <span className="fin-num" style={{ fontSize: 52, lineHeight: 1.05 }}>{euros(Math.abs(e.resteAujourdhui))}</span>
              <span className={`t-small ${over || e.deficit > 0 ? '' : 'c-ok'}`} style={{ fontWeight: 600, color: over || e.deficit > 0 ? 'var(--warn)' : undefined }}>
                {e.deficit > 0 ? 'plus rien de disponible' : over ? `budget du jour : ${euros(e.budgetJour)}` : e.limitedBy === 'cash' ? 'limité par ta trésorerie' : 'dans le budget'}
              </span>
            </Ring>
            <Glass className="fin-stats">
              <span>
                <span className="fin-num" style={{ fontSize: 20 }}>{euros(left, { round: true })}</span>
                <span className="t-small muted">restants</span>
              </span>
              <i />
              <span>
                <span className="fin-num" style={{ fontSize: 20 }}>{e.daysLeft} j</span>
                <span className="t-small muted">avant la paie</span>
              </span>
              <i />
              <span>
                <span className="fin-num" style={{ fontSize: 20 }}>{euros(e.demain, { round: true })}</span>
                <span className="t-small muted">demain</span>
              </span>
            </Glass>
            <Link to="/argent/moteur" className="link link-quiet t-small" style={{ alignSelf: 'center' }}>
              Pourquoi ce chiffre
            </Link>

            {e.pot > 0 && (
              <>
                <Sec action={`sur ${euros(e.pot, { round: true })} de budget`}>Tes dépenses du cycle, cumulées</Sec>
                <Glass className="list" style={{ padding: '16px 14px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }} aria-live="polite">
                    <span style={{ display: 'flex', flexDirection: 'column' }}>
                      <span className="fin-num" style={{ fontSize: 26, lineHeight: 1.1 }}>{atSpent === null ? '—' : euros(atSpent, { round: true })}</span>
                      <span className="t-small muted">{paceDay === null ? `dépensés en ${rhythm.day} jour${rhythm.day > 1 ? 's' : ''}` : at === 0 ? 'au début du cycle' : atSpent === null ? `le ${day(atDate)}, à venir` : `dépensés au ${day(atDate)}`}</span>
                    </span>
                    {atGap !== null ? (
                      <span className="fin-gap" data-late={atGap < 0}>
                        <span className="fin-num" style={{ fontSize: 18, lineHeight: 1.15 }}>{euros(Math.abs(atGap), { round: true })} {atGap < 0 ? 'de retard' : 'd’avance'}</span>
                        <span className="t-small">sur le rythme idéal</span>
                      </span>
                    ) : (
                      <span className="fin-gap">
                        <span className="fin-num" style={{ fontSize: 18, lineHeight: 1.15 }}>{euros(atIdeal, { round: true })}</span>
                        <span className="t-small">au rythme idéal</span>
                      </span>
                    )}
                  </div>
                  <div className="fin-readout">
                    <span><i style={{ background: 'var(--warn)' }} />idéal <b>{euros(atIdeal, { round: true })}</b></span>
                    {atPrevious !== null && <span><i style={{ background: 'var(--ink-2)' }} />cycle dernier <b>{euros(atPrevious, { round: true })}</b></span>}
                    <span className="muted">{paceDay === null ? 'glisse le doigt sur le graphique' : at === 0 ? '' : day(atDate)}</span>
                  </div>
                  <PaceChart
                    current={rhythm.current}
                    previous={rhythm.previous}
                    pot={rhythm.pot}
                    length={rhythm.length}
                    format={(v) => euros(v, { round: true })}
                    labels={[day(e.cycle.start), day(e.cycle.end)]}
                    picked={paceDay}
                    onPick={setPaceDay}
                    label={`Dépenses cumulées du cycle : ${euros(rhythm.spent, { round: true })} au jour ${rhythm.day} sur ${rhythm.length}, pour un rythme idéal de ${euros(rhythm.ideal, { round: true })}${rhythm.previousSameDay !== null ? ` ; ${euros(rhythm.previousSameDay, { round: true })} au même jour du cycle précédent` : ''}`}
                  />
                  <div className="fin-legend">
                    <span><i style={{ background: 'linear-gradient(90deg,#7b5cff,#38c6f4)', height: 4 }} />ce cycle</span>
                    <span><i style={{ borderTop: '2px dashed var(--warn)', height: 0 }} />rythme idéal</span>
                    {rhythm.previous.length > 1 && <span><i style={{ background: 'var(--ink-2)', height: 2 }} />cycle précédent</span>}
                  </div>
                  <span className="t-small muted">
                    {rhythm.previousSameDay !== null ? `Au même jour, le cycle dernier : ${euros(rhythm.previousSameDay, { round: true })}. ` : ''}
                    À ce rythme, tu finis le cycle autour de {euros(rhythm.projected, { round: true })}.
                  </span>
                </Glass>
              </>
            )}

            <Sec action={overDays > 0 ? `${overDays} jour${overDays > 1 ? 's' : ''} au-dessus` : 'budget du jour en pointillés'}>Tes {DAYS} derniers jours</Sec>
            <Glass style={{ padding: '14px 16px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className="row" style={{ justifyContent: 'space-between' }} aria-live="polite">
                <span className={`t-small muted${barPicked ? ' fin-day-pick' : ''}`}>{barPicked ? longDay(barPicked.key) : `${euros(fortnight, { round: true })} en ${DAYS} jours`}</span>
                <span className="t-strong" style={barPicked && barPicked.value > e.budgetJour && e.budgetJour > 0 ? { color: '#ff9a62' } : undefined}>{barPicked ? euros(barPicked.value) : `${euros(Math.round(fortnight / DAYS), { round: true })} par jour`}</span>
              </div>
              <DayBars days={days} budget={e.budgetJour} picked={barDay} onPick={setBarDay} label={`Dépenses des ${DAYS} derniers jours comparées au budget du jour de ${euros(e.budgetJour)} : ${overDays} au-dessus`} />
            </Glass>

            {groups.length > 0 && (
              <Link to="/argent/classer" className="glass row" style={{ padding: '12px 16px', borderRadius: 16 }}>
                <span className="fin-num" style={{ width: 34, height: 34, borderRadius: 12, background: 'var(--warn-bg)', border: '1px solid var(--warn-border)', color: 'var(--warn)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{groups.length}</span>
                <span className="grow" style={{ display: 'flex', flexDirection: 'column' }}>
                  <span className="t-strong">{groups.length > 1 ? 'marchands à classer' : 'marchand à classer'}</span>
                  <span className="t-small muted">
                    {groups.reduce((n, g) => n + g.count, 0)} opération{groups.reduce((n, g) => n + g.count, 0) > 1 ? 's' : ''}, {euros(Math.abs(groups.reduce((n, g) => n + g.total, 0)), { round: true })}
                  </span>
                </span>
                <Icon name="chevron" size={16} />
              </Link>
            )}
            {e.pendingIncomes.length > 0 && (
              <Link to="/argent/moteur" className="glass row" style={{ padding: '12px 16px', borderRadius: 16 }}>
                <span className="grow" style={{ display: 'flex', flexDirection: 'column' }}>
                  <span className="t-strong">{e.pendingIncomes.length > 1 ? `${e.pendingIncomes.length} revenus attendent ta décision` : 'Un revenu attend ta décision'}</span>
                  <span className="t-small muted">{euros(e.pendingIncomes.reduce((s, p) => s + p.amount, 0))} : au budget, ou à l’épargne ?</span>
                </span>
                <Icon name="chevron" size={16} />
              </Link>
            )}

            {upcoming.length > 0 && (
              <>
                <Sec action="Tout voir" to="/argent/plan">Ce qui tombe bientôt</Sec>
                <div className="fin-upcoming">
                  {upcoming.map((o) => (
                    <Link key={o.id} to="/argent/plan" className="glass fin-up" style={{ borderColor: TONE[o.commitment.kind] }}>
                      <span className="t-small" style={{ fontWeight: 600, color: TONE[o.commitment.kind] }}>{o.dueDate < today ? 'en retard' : o.dueDate === today ? 'aujourd’hui' : o.dueDate === addDays(today, 1) ? 'demain' : day(o.dueDate)}</span>
                      <span className="t-strong" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.commitment.label}</span>
                      <span className={`fin-num ${o.commitment.kind === 'INCOME' ? 'c-ok' : ''}`} style={{ fontSize: 20 }}>{euros(o.commitment.kind === 'INCOME' ? o.expected : -o.remaining, { round: true, sign: true })}</span>
                      <span className="sr-only">{KIND[o.commitment.kind]}</span>
                    </Link>
                  ))}
                </div>
              </>
            )}

            <AskCopilot question={e.resteAujourdhui < 0 ? 'J’ai dépassé mon budget du jour : comment rattraper d’ici la paie ?' : 'Est-ce que je tiens mon budget ce cycle ? Qu’est-ce qui pèse le plus ?'} />

            <Sec action={todays.length ? 'Toutes les opérations' : undefined} to="/argent/operations">Aujourd’hui · {euros(e.spentToday)} dépensés</Sec>
            {todays.length === 0 ? (
              <span className="t-small muted">Aucune opération aujourd’hui.</span>
            ) : (
              <Glass style={{ padding: '2px 16px' }}>
                {todays.map((o) => (
                  <Link key={o.tx.id} to={`/argent/operations?op=${encodeURIComponent(o.tx.id)}`} className="fin-op">
                    <Avatar op={o} />
                    <span className="grow" style={{ display: 'flex', flexDirection: 'column' }}>
                      <span className="t-strong" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.name}</span>
                      <span className="t-small muted">{o.tag && <span className="fin-tag">{o.tag}</span>}{o.detail}</span>
                    </span>
                    <span className={`t-strong ${o.tx.amount > 0 && o.tag !== 'Virement' ? 'c-ok' : ''}`}>{euros(o.tx.amount, { sign: o.tx.amount > 0 })}</span>
                  </Link>
                ))}
              </Glass>
            )}
          </>
        );
      }}
    </Screen>
  );
}
