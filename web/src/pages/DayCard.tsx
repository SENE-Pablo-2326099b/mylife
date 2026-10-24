import { useEffect, useState } from 'react';
import { AGENDA_EVENT, eventsOn, localToday, readAgenda, type AgendaApp, type AgendaEvent, type AgendaKind } from '../vendor/lumen';
import { Icon, type IconName } from '../ui/icons';
import { Card } from '../ui/index';
import { formatCents } from '../ui/money';

/**
 * « Ta journée » (V4, F3) : ce qui t'attend aujourd'hui et les jours suivants, toutes apps confondues, depuis l'agenda
 * commun (séances prévues, paie et prélèvements, investissements, sorties). Rien n'est envoyé : tout est sur l'appareil.
 */
const ICON: Record<AgendaKind, IconName> = { session: 'barbell', income: 'cash', charge: 'card', savings: 'diamond', sortie: 'flag-fill', other: 'calendar' };
const APP_NAME: Record<AgendaApp, string> = { finances: 'MyFinances', perf: 'MyPerf', home: 'Sorties' };
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const dayLabel = (iso: string, today: string) =>
  iso === today ? 'Aujourd’hui' : iso === addDays(today, 1) ? 'Demain' : new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric' });

function Line({ e }: { e: AgendaEvent }) {
  return (
    <a href={e.url ?? '#'} className="flex items-center gap-2.5 py-1.5">
      <Icon name={ICON[e.kind]} size={16} className="shrink-0 text-gold" />
      <span className="t-body min-w-0 flex-1 truncate">
        {e.time && <span className="num mr-1.5 text-secondary">{e.time}</span>}
        {e.title}
      </span>
      {e.amount !== undefined && <span className={`num t-small shrink-0 ${e.kind === 'income' ? 'text-success' : 'text-secondary'}`}>{e.kind === 'income' ? '+' : '−'}{formatCents(e.amount, { short: true })}</span>}
    </a>
  );
}

export function DayCard() {
  const [today, setToday] = useState(localToday);
  const [, tick] = useState(0);
  useEffect(() => {
    const bump = () => {
      setToday(localToday());
      tick((n) => n + 1);
    };
    const onStorage = (e: StorageEvent) => (e.key === null || e.key.startsWith('mylife:agenda:')) && bump();
    window.addEventListener('storage', onStorage);
    window.addEventListener(AGENDA_EVENT, bump);
    window.addEventListener('focus', bump);
    const id = setInterval(bump, 60_000);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(AGENDA_EVENT, bump);
      window.removeEventListener('focus', bump);
      clearInterval(id);
    };
  }, []);
  const view = readAgenda(today, addDays(today, 6), today);
  if (Object.values(view.sources).every((d) => d === null)) return null;
  const now = eventsOn(view.events, today);
  const later = view.events.filter((e) => e.date > today).slice(0, 5);
  return (
    <Card label="Ta journée : ce qui t’attend">
      <p className="t-label text-muted">Ta journée</p>
      {now.length ? (
        <div className="mt-1 divide-y divide-line">
          {now.map((e) => (
            <Line key={`${e.app}-${e.id}`} e={e} />
          ))}
        </div>
      ) : (
        <p className="t-body mt-1 text-secondary">Rien de prévu aujourd’hui.</p>
      )}
      {later.length > 0 && (
        <div className="mt-3">
          <p className="t-caption text-muted">Ces prochains jours</p>
          <div className="divide-y divide-line">
            {later.map((e) => (
              <div key={`${e.app}-${e.id}`}>
                <p className="t-caption pt-1.5 text-muted">{dayLabel(e.date, today)}</p>
                <Line e={e} />
              </div>
            ))}
          </div>
        </div>
      )}
      {view.stale.length > 0 && <p className="t-caption mt-2 text-muted">À rafraîchir : ouvre {view.stale.map((a) => APP_NAME[a]).join(' et ')} (ce que tu y vois date d’avant aujourd’hui).</p>}
    </Card>
  );
}
