import { addDays, weekday } from '@mylife/training';
import { plannedOn, preview, readMoves } from './day';
import { readProgram } from './queries';
import type { Db } from './sql';

/**
 * Le calendrier (maquette G1 bis, validée le 23/11), côté Worker : le mois en semaines complètes ; chaque jour, ses
 * séances faites et, à partir d'aujourd'hui, celles prévues (semaine type et décalages, comme Jour).
 */

export interface CalendarItem {
  kind: 'done' | 'plan';
  /** La séance faite (son bilan), ou la séance type prévue. */
  id: string;
  name: string;
  detail: string;
}

export interface CalendarDay {
  date: string;
  inMonth: boolean;
  state: 'done' | 'plan' | 'rest';
  items: CalendarItem[];
}

export interface CalendarView {
  month: string;
  label: string;
  year: number;
  days: CalendarDay[];
}

const MONTH = /^(\d{4})-(\d{2})$/;

export function calendarView(d: Db, month: string, today: string): CalendarView {
  const m = MONTH.exec(month);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new Error('Mois invalide');
  const first = `${month}-01`;
  const next = Number(m[2]) === 12 ? `${Number(m[1]) + 1}-01-01` : `${m[1]}-${String(Number(m[2]) + 1).padStart(2, '0')}-01`;
  const last = addDays(next, -1);
  const from = addDays(first, -weekday(first));
  const to = addDays(last, 6 - weekday(last));
  const program = readProgram(d);
  const live = new Set(d.all<{ id: string }>('SELECT id FROM templates WHERE archived = 0').map((r) => r.id));
  const moves = readMoves(d, addDays(from, -28), addDays(to, 28));
  const done = d.all<{ id: string; date: string; name: string; template_id: string | null; started_at: number; ended_at: number | null; sets: number }>(
    `SELECT w.id, w.date, w.name, w.template_id, w.started_at, w.ended_at,
       (SELECT COUNT(*) FROM sets s JOIN workout_exercises we ON we.id = s.workout_exercise_id WHERE we.workout_id = w.id AND s.completed = 1 AND s.set_type != 'warmup') AS sets
     FROM workouts w WHERE w.status = 'completed' AND w.date BETWEEN ? AND ? ORDER BY w.started_at`,
    [from, to],
  );
  const days: CalendarDay[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const mine = done.filter((w) => w.date === date);
    const items: CalendarItem[] = mine.map((w) => {
      const minutes = w.ended_at ? Math.max(1, Math.round((w.ended_at - w.started_at) / 60_000)) : null;
      return { kind: 'done', id: w.id, name: w.name, detail: [`${w.sets} série${w.sets > 1 ? 's' : ''}`, minutes ? `${minutes} min` : ''].filter(Boolean).join(' · ') };
    });
    if (date >= today)
      for (const p of plannedOn(program, live, moves, date)) {
        if (mine.some((w) => w.template_id === p.id)) continue;
        const s = preview(d, program, p.id, date);
        if (s) items.push({ kind: 'plan', id: s.id, name: s.name, detail: `${s.lines.length} exercice${s.lines.length > 1 ? 's' : ''} · ${s.minutes} min` });
      }
    days.push({ date, inMonth: date >= first && date <= last, state: mine.length ? 'done' : items.length ? 'plan' : 'rest', items });
  }
  const label = new Date(`${first}T12:00:00`).toLocaleDateString('fr-FR', { month: 'long' });
  return { month, label: label.charAt(0).toUpperCase() + label.slice(1), year: Number(m[1]), days };
}
