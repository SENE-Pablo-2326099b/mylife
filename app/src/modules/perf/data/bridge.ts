import { addDays, diffDays, totalWeeks, weekday } from '@mylife/training';
import { dayView, moveSession, plannedOn, readMoves } from './day';
import { progressView } from './progress';
import { readProgram } from './queries';
import type { Db } from './sql';

/**
 * Ce que MyPerf dépose pour le reste de MyLife (maquette V3-Accueil, validée le 22/11), côté Worker : l'aperçu de la
 * carte d'accueil (la séance du jour), la fiche de contexte de Copilot Sport (semaine, séances prévues décalables,
 * bloc, dernières séances, lifts, plateaux), les séances prévues de l'agenda commun, et l'action « décaler » validée dans
 * Copilot. Sur l'appareil seulement, jamais synchronisé (comme l'app d'avant).
 */

const longDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

export interface HomeCard {
  kicker: string;
  title: string;
  detail: string | null;
  chip: string | null;
  start: string;
}

export function homeCard(d: Db, date: string): HomeCard | null {
  const v = dayView(d, date);
  const chip = v.block ? `S${v.block.week}` : null;
  if (v.active) return { kicker: 'MyPerf · séance en cours', title: v.active.name, detail: `${v.active.done} / ${v.active.total} séries`, chip, start: 'Reprendre' };
  const today = v.today[0];
  if (today) return { kicker: 'MyPerf · séance du jour', title: today.name, detail: `${today.lines.length} exercice${today.lines.length > 1 ? 's' : ''} · ${today.minutes} min`, chip, start: 'Démarrer' };
  if (v.next) return { kicker: `MyPerf · repos · prochaine ${new Date(`${v.next.date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long' })}`, title: v.next.session.name, detail: `${v.next.session.minutes} min`, chip, start: 'La faire maintenant' };
  return null;
}

/** Les séances prévues des 21 prochains jours (semaine type et décalages), pas encore faites. */
function upcoming(d: Db, date: string): { id: string; date: string; session: string; templateId: string }[] {
  const program = readProgram(d);
  const live = new Set(d.all<{ id: string }>('SELECT id FROM templates WHERE archived = 0').map((r) => r.id));
  const moves = readMoves(d, addDays(date, -7), addDays(date, 28));
  const done = new Set(d.all<{ k: string }>("SELECT template_id || ':' || date AS k FROM workouts WHERE status = 'completed' AND date >= ?", [date]).map((r) => r.k));
  const out: { id: string; date: string; session: string; templateId: string }[] = [];
  for (let i = 0; i < 21; i++) {
    const on = addDays(date, i);
    for (const p of plannedOn(program, live, moves, on)) {
      if (done.has(`${p.id}:${on}`)) continue;
      out.push({ id: `${p.id}:${on}`, date: on, session: program.sessions.find((s) => s.id === p.id)?.name ?? '', templateId: p.id });
    }
  }
  return out;
}

export function agendaEvents(d: Db, date: string) {
  return upcoming(d, date).map((p) => ({ id: p.id, kind: 'session' as const, title: p.session, date: p.date, url: '/sport' }));
}

/** La fiche de Copilot Sport (même forme que celle de l'app d'avant, plus ce qui sert à décaler une séance). */
export function copilotCard(d: Db, date: string): Record<string, unknown> {
  const program = readProgram(d);
  const progress = progressView(d, date, 28);
  const blocks = program.structure.kind === 'periodized' ? [...program.structure.blocks].sort((a, b) => a.startDate.localeCompare(b.startDate)) : [];
  const current = blocks.find((m) => date >= m.startDate && diffDays(m.startDate, date) < totalWeeks(m) * 7);
  const recent = d.all<{ date: string; name: string; started_at: number; ended_at: number | null; rating: number | null }>(
    "SELECT date, name, started_at, ended_at, rating FROM workouts WHERE status = 'completed' AND date >= ? ORDER BY date DESC, started_at DESC LIMIT 8",
    [addDays(date, -28)],
  );
  const monday = addDays(date, -weekday(date));
  return {
    day: date,
    weeklyGoal: progress.consistency.weeks.length ? program.structure.pattern.length : null,
    sessionsThisWeek: d.first<{ n: number }>("SELECT COUNT(*) AS n FROM workouts WHERE status = 'completed' AND date BETWEEN ? AND ?", [monday, date])?.n ?? 0,
    workoutsLast30Days: d.first<{ n: number }>("SELECT COUNT(*) AS n FROM workouts WHERE status = 'completed' AND date >= ?", [addDays(date, -29)])?.n ?? 0,
    planned: upcoming(d, date).map((p) => ({ id: p.id, date: p.date, day: longDay(p.date), session: p.session, action: 'perf.moveSession' })),
    cycle: current ? { name: current.name, kind: current.kind, start: current.startDate, workWeeks: current.workWeeks, deloadWeeks: current.deloadWeeks, week: Math.floor(diffDays(current.startDate, date) / 7) + 1 } : null,
    recentWorkouts: recent.map((w) => ({ date: w.date, name: w.name, minutes: w.ended_at ? Math.round((w.ended_at - w.started_at) / 60_000) : null, form: w.rating })),
    mainLifts: progress.lifts.map((l) => ({ exercise: l.name, reference: l.reference, estimate: l.estimate })),
    stagnant: progress.plateaus.map((p) => p.name),
    note: 'Charges des lestés en lest net (sans le poids du corps).',
  };
}

/** L'action « décaler » validée dans Copilot : la séance de ce jour part à `to`. Rend l'action qui la défait. */
export function executeMove(d: Db, plannedId: string, to: string): { undo: { plannedId: string; date: string }; summary: string } {
  const m = /^(.+):(\d{4}-\d{2}-\d{2})$/.exec(plannedId);
  if (!m) throw new Error('Séance prévue illisible.');
  const [, templateId, from] = m as unknown as [string, string, string];
  const name = d.first<{ name: string }>('SELECT name FROM templates WHERE id = ? AND archived = 0', [templateId])?.name;
  if (!name) throw new Error('Cette séance n’existe plus.');
  if (!upcoming(d, addDays(from, -1)).some((p) => p.id === plannedId)) throw new Error('Cette séance n’est plus prévue ce jour-là (déjà faite ou décalée).');
  moveSession(d, templateId, from, to);
  return { undo: { plannedId: `${templateId}:${to}`, date: from }, summary: `Remettre « ${name} » au ${longDay(from)}` };
}
