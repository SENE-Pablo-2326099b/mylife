import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Glass, IconButton, Notice } from '@mylife/kit';
import { call } from '../data/client';
import type { CalendarDay, CalendarItem, CalendarView } from '../data/calendar';
import { errorText, today, useData } from './util';
import '../perf.css';

/**
 * Le calendrier (maquette G1 bis, validée le 23/11) : le mois en tuiles (faite : teintée ; prévue : cerclée ;
 * aujourd'hui en blanc ; le jour touché en orange), et la carte du jour touché (son bilan, ou « Décaler » : touche
 * ensuite le nouveau jour, comme sur Jour et dans Copilot).
 */
const WD = ['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM'];
const shift = (month: string, by: number) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const t = y * 12 + (m - 1) + by;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};
const at = (iso: string, o: Intl.DateTimeFormatOptions) => new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', o);
const STATE = { done: 'séance faite', plan: 'séance prévue', rest: '' } as const;

export function CalendrierPage() {
  const date = today();
  const [params, setParams] = useSearchParams();
  const month = /^\d{4}-\d{2}$/.test(params.get('mois') ?? '') ? params.get('mois')! : date.slice(0, 7);
  const [selected, setSelected] = useState(date);
  const [moving, setMoving] = useState<{ item: CalendarItem; from: string } | null>(null);
  const [moved, setMoved] = useState<{ id: string; name: string; from: string; to: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const { data: v, error, reload } = useData<CalendarView>(() => call('calendarView', month, date), [month, date]);
  if (error) return <Notice tone="bad">{error}</Notice>;
  if (!v) return <span className="t-small muted">Lecture du calendrier…</span>;
  const goMonth = (by: number) => setParams({ mois: shift(month, by) }, { replace: true });
  const move = async (id: string, from: string, to: string) => {
    await call('moveSession', id, from, to);
    reload();
  };
  const tap = async (d: CalendarDay) => {
    if (!moving) return setSelected(d.date);
    if (d.date < date) return;
    const { item, from } = moving;
    setMoving(null);
    if (d.date === from) return;
    try {
      await move(item.id, from, d.date);
      setMoved({ id: item.id, name: item.name, from, to: d.date });
      setSelected(d.date);
    } catch (e) {
      setFailed(errorText(e));
    }
  };
  const day = v.days.find((d) => d.date === selected);
  return (
    <div className="pf-screen tone-perf" style={{ paddingBottom: 110 }}>
      <div className="pf-amb" aria-hidden="true" />
      <header className="row pf-cal-top">
        <IconButton icon="back" label="Retour" href="/sport/programme" />
        <span className="grow pf-cal-mo">
          <small>{`Calendrier · ${v.year}`}</small>
          <h1>{v.label}</h1>
        </span>
        <span className="pf-cal-nav">
          <button type="button" aria-label="Mois précédent" onClick={() => goMonth(-1)}>
            ‹
          </button>
          <button type="button" aria-label="Mois suivant" onClick={() => goMonth(1)}>
            ›
          </button>
        </span>
      </header>
      {failed && <Notice tone="bad">{failed}</Notice>}
      {moving && (
        <Glass className="pf-cal-hint">
          <span className="grow t-small">
            Touche le nouveau jour pour <b>{`« ${moving.item.name} »`}</b>
          </span>
          <button type="button" className="btn btn-secondary" onClick={() => setMoving(null)}>
            Annuler
          </button>
        </Glass>
      )}
      <Glass className="pf-cal">
        <div className="pf-cal-wd" aria-hidden="true">
          {WD.map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>
        <div className="pf-cal-g">
          {v.days.map((d) => {
            const cls = ['pf-cal-d', `is-${d.state}`, d.inMonth ? '' : 'is-out', d.date < date && d.state === 'rest' ? 'is-past' : '', d.date === date ? 'is-today' : '', d.date === selected && !moving ? 'is-sel' : '', moving && d.date < date ? 'is-off' : ''];
            return (
              <button
                key={d.date}
                type="button"
                className={cls.filter(Boolean).join(' ')}
                aria-pressed={d.date === selected}
                aria-label={[at(d.date, { weekday: 'long', day: 'numeric', month: 'long' }), STATE[d.state]].filter(Boolean).join(', ')}
                disabled={!!moving && d.date < date}
                onClick={() => void tap(d)}
              >
                {Number(d.date.slice(8))}
              </button>
            );
          })}
        </div>
      </Glass>
      {moved && (
        <Glass className="pf-cal-hint">
          <span className="grow t-small">
            <b>{moved.name}</b> <span className="muted">{`décalée au ${at(moved.to, { weekday: 'long', day: 'numeric' })}`}</span>
          </span>
          <button
            type="button"
            className="pf-link"
            onClick={async () => {
              setMoved(null);
              try {
                await move(moved.id, moved.to, moved.from);
                setSelected(moved.from);
              } catch (e) {
                setFailed(errorText(e));
              }
            }}
          >
            Annuler
          </button>
        </Glass>
      )}
      {day && !moving && <DayCard day={day} past={day.date < date} onMove={(item) => { setMoved(null); setFailed(null); setMoving({ item, from: day.date }); }} />}
    </div>
  );
}

function DayCard({ day, past, onMove }: { day: CalendarDay; past: boolean; onMove: (item: CalendarItem) => void }) {
  const pill = (
    <span className="pf-cal-pill" aria-hidden="true">
      <small>{at(day.date, { weekday: 'short' }).replace('.', '').toUpperCase()}</small>
      <b>{Number(day.date.slice(8))}</b>
    </span>
  );
  if (!day.items.length)
    return (
      <Glass className="pf-cal-day">
        {pill}
        <span className="grow t-small muted">{past ? 'Pas de séance' : 'Rien de prévu'}</span>
      </Glass>
    );
  return (
    <>
      {day.items.map((item) =>
        item.kind === 'done' ? (
          <a key={item.id} className="glass pf-cal-day" href={`/sport/bilan/${item.id}`}>
            {pill}
            <span className="grow pf-cal-what">
              <span className="t-strong">{item.name}</span>
              <span className="t-small muted">{item.detail}</span>
            </span>
            <span className="pf-cal-act">Bilan</span>
          </a>
        ) : (
          <Glass key={item.id} className="pf-cal-day">
            {pill}
            <span className="grow pf-cal-what">
              <span className="t-strong">{item.name}</span>
              <span className="t-small muted">{item.detail}</span>
            </span>
            <button type="button" className="pf-cal-act" onClick={() => onMove(item)}>
              Décaler
            </button>
          </Glass>
        ),
      )}
    </>
  );
}
