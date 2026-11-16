import { Link } from 'react-router-dom';
import { Glass, Icon, IconButton } from '@mylife/kit';
import { addDays } from '../core/dates';
import { euros } from '../core/format';
import { useEngine } from '../data/engineStore';
import { toClassify } from '../engine/automation';
import { lastCycles, settledIn, spendByDay } from '../engine/views';
import { DayBars, Ring } from './charts';
import { Avatar, Screen, Sec } from './common';
import { opViews } from './opViews';
import { day, KIND } from './labels';

/**
 * Jour : « combien je peux dépenser aujourd'hui ? ». Le chiffre au centre de l'anneau du cycle, les sept derniers
 * jours face au budget du jour, ce qui attend d'être classé, ce qui tombe bientôt, et les opérations du jour.
 */
const longDay = (iso: string) => new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${iso}T12:00:00`));
const shortDay = (iso: string) => new Intl.DateTimeFormat('fr-FR', { weekday: 'short' }).format(new Date(`${iso}T12:00:00`)).replace('.', '');
const TONE = { INCOME: '#5ccbe6', CHARGE: '#f472b6', INSTALLMENT: '#f472b6', SAVING: '#6fe0a0' } as const;

export function JourPage() {
  const engine = useEngine();
  return (
    <Screen engine={engine} tone="jour" kicker={longDay(engine.today)} title="Jour" right={<IconButton icon="settings" label="Réglages de MyFinances" href="/argent/reglages" />}>
      {({ db, e, today }) => {
        const over = e.resteAujourdhui < 0;
        const groups = toClassify(db);
        const settled = settledIn(db, lastCycles(db, today, 2));
        const week = spendByDay(db, settled, addDays(today, -6), today);
        const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6)).map((d) => ({ key: d, name: d === today ? 'auj.' : shortDay(d), value: Math.max(0, week.get(d) ?? 0), today: d === today }));
        const overDays = days.filter((d) => !d.today && d.value > e.budgetJour && e.budgetJour > 0).length;
        const upcoming = e.occurrences.filter((o) => o.status === 'DUE' || o.status === 'PARTIAL').slice(0, 8);
        const todays = opViews(db).filter((o) => o.tx.date === today);
        const left = Math.max(0, e.disponible - e.spentToday);
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

            <Sec action={overDays > 0 ? `${overDays} jour${overDays > 1 ? 's' : ''} au-dessus` : 'budget du jour en pointillés'}>Tes 7 derniers jours</Sec>
            <Glass style={{ padding: '16px 16px 10px' }}>
              <DayBars days={days} budget={e.budgetJour} label={`Dépenses des 7 derniers jours comparées au budget du jour de ${euros(e.budgetJour)} : ${overDays} au-dessus`} />
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
