import { Link } from 'react-router-dom';
import { Button, EmptyState, Glass, Icon, ScreenHeader } from '@mylife/kit';
import { localToday, readAgenda, type AgendaEvent } from '@mylife/lumen';
import { enabledModules, type TodoItem } from '../contract';
import { MODULES } from '../modules';
import { useDeviceTick, useLogin, usePrefs } from '../store';

/** « Aujourd'hui » : ce qui compte maintenant, fait des cartes des modules allumés. Tout est lu sur l'appareil. */

const longDay = (d: Date) => new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(d);
const dayName = (iso: string) => new Intl.DateTimeFormat('fr-FR', { weekday: 'long' }).format(new Date(`${iso}T12:00:00`));
const dayNum = (iso: string) => new Intl.DateTimeFormat('fr-FR', { day: 'numeric' }).format(new Date(`${iso}T12:00:00`));
const euros = (cents: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return localToday(d);
};

const TONE: Partial<Record<AgendaEvent['app'], string>> = { finances: 'tone-finances', perf: 'tone-perf', home: 'tone-rave' };

function Line({ e }: { e: AgendaEvent }) {
  const amount = e.amount !== undefined ? (e.kind === 'income' ? '+' : '−') + euros(e.amount) : null;
  return (
    <a href={e.url ?? '#'} className={`row ${TONE[e.app] ?? 'tone-neutral'}`} style={{ minHeight: 40, gap: 10 }}>
      <span className="navdot" style={{ width: 8, height: 8 }} />
      <span className="grow t-body" style={{ fontWeight: 500 }}>
        {e.time && <span className="muted" style={{ marginRight: 8 }}>{e.time}</span>}
        {e.title}
      </span>
      {amount && <span className={`t-strong ${e.kind === 'income' ? 'c-ok' : ''}`}>{amount}</span>}
    </a>
  );
}

/** La semaine : un bloc par jour qui a quelque chose, le jour en gros à gauche, les événements à droite. */
function Week() {
  useDeviceTick();
  const today = localToday();
  const events = readAgenda(today, addDays(today, 6), today).events;
  if (!events.length) return null;
  const days = [...new Set(events.map((e) => (e.date < today ? today : e.date)))].sort();
  return (
    <Glass as="section" className="stack-0" aria-label="Cette semaine">
      {days.map((d, i) => (
        <div key={d} className="row" style={{ alignItems: 'flex-start', padding: '12px 16px', gap: 14, borderTop: i ? '1px solid var(--line)' : undefined }}>
          <span style={{ width: 44, flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.1 }}>
            <span className="display" style={{ fontSize: 22, fontWeight: 800, color: d === today ? 'var(--ink)' : 'var(--ink-2)' }}>{dayNum(d)}</span>
            <span className="t-label muted" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.04em' }}>{d === today ? 'auj.' : dayName(d).slice(0, 3)}</span>
          </span>
          <span className="grow stack-0">
            {events
              .filter((e) => (e.date < today ? today : e.date) === d)
              .map((e) => (
                <Line key={`${e.app}:${e.id}`} e={e} />
              ))}
          </span>
        </div>
      ))}
    </Glass>
  );
}

function Todos({ items }: { items: TodoItem[] }) {
  if (!items.length) return null;
  return (
    <a href={items[0]!.href} className="glass row" style={{ minHeight: 46, padding: '0 14px', borderRadius: 16 }}>
      <span className="count">{items.length}</span>
      <span className="grow t-small" style={{ fontWeight: 500 }}>{items.map((t) => t.title).join(' · ')}</span>
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
        <EmptyState title="Aucun module allumé" body="Leurs cartes apparaîtront ici." action={<Button href="/v5/modules">Choisir mes modules</Button>} />
      )}
      <Week />
    </>
  );
}
