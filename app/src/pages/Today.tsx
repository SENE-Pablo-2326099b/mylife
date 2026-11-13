import { Link } from 'react-router-dom';
import { EmptyState, Glass, Icon, List, ListRow, ScreenHeader, SectionTitle } from '@mylife/kit';
import { localToday, readAgenda, type AgendaEvent } from '@mylife/lumen';
import { enabledModules, type TodoItem } from '../contract';
import { MODULES } from '../modules';
import { useDeviceTick, useLogin, usePrefs } from '../store';

/** « Aujourd'hui » : ce qui compte maintenant, fait des cartes des modules allumés. Rien n'est envoyé : tout est lu sur l'appareil. */

const longDay = (d: Date) => new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(d);
const shortDay = (iso: string) => new Intl.DateTimeFormat('fr-FR', { weekday: 'short' }).format(new Date(`${iso}T12:00:00`));
const euros = (cents: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return localToday(d);
};

const KIND: Partial<Record<AgendaEvent['kind'], string>> = { session: 'séance', sortie: 'sortie', meal: 'repas' };

function eventValue(e: AgendaEvent) {
  if (e.amount !== undefined) return <span className={e.kind === 'income' ? 'c-ok' : undefined}>{`${e.kind === 'income' ? '+' : '−'}${euros(e.amount)}`}</span>;
  return <span className="t-small muted">{KIND[e.kind] ?? ''}</span>;
}

function Week() {
  useDeviceTick();
  const today = localToday();
  const events = readAgenda(today, addDays(today, 6), today).events.slice(0, 6);
  if (!events.length) return null;
  return (
    <section className="stack" style={{ gap: 6 }}>
      <SectionTitle>Cette semaine</SectionTitle>
      <List>
        {events.map((e) => (
          <ListRow
            key={`${e.app}:${e.id}`}
            lead={<span className="t-small muted" style={{ width: 38 }}>{e.date === today ? 'auj.' : shortDay(e.date)}</span>}
            title={e.title}
            value={eventValue(e)}
          />
        ))}
      </List>
    </section>
  );
}

function Todos({ items }: { items: TodoItem[] }) {
  if (!items.length) return null;
  const first = items[0]!;
  return (
    <a href={first.href} className="glass row" style={{ minHeight: 46, padding: '0 14px', borderRadius: 16 }}>
      <span className="count">{items.length}</span>
      <span className="grow t-small" style={{ fontWeight: 500 }}>À faire : {items.map((t) => t.title).join(', ')}</span>
      <Icon name="chevron" size={16} />
    </a>
  );
}

export function TodayPage() {
  const prefs = usePrefs();
  const login = useLogin();
  useDeviceTick();
  const modules = enabledModules(MODULES, prefs);
  const cards = modules.flatMap((m) => m.cards);
  const todos = modules.flatMap((m) => m.todos?.() ?? []);
  const [first, ...rest] = cards;
  return (
    <>
      <ScreenHeader
        kicker={longDay(new Date())}
        title="Aujourd’hui"
        right={
          <Link to="/reglages" className="glass icon-btn t-strong" aria-label="Réglages et compte">
            {(login ?? '?').charAt(0).toUpperCase()}
          </Link>
        }
      />
      <Todos items={todos} />
      {first ? (
        <div className="grid-cards stack">
          <first.Component />
          {rest.length > 0 && (
            <div className={rest.length > 1 ? 'grid-2' : 'stack'}>
              {rest.map((c) => (
                <c.Component key={c.id} />
              ))}
            </div>
          )}
        </div>
      ) : (
        <EmptyState
          title="Aucun module allumé"
          body="Choisis les modules qui te servent : leurs cartes apparaîtront ici."
          action={
            <Link to="/modules" className="btn btn-secondary">
              Choisir mes modules
            </Link>
          }
        />
      )}
      <Week />
      {!first && <Glass className="pad t-small muted">MyLife ne montre que ce que tu as allumé.</Glass>}
    </>
  );
}
