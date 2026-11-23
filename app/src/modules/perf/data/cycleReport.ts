import { addDays, diffDays, estimate1RM, mesoKindInfo, referenceFor, sessionsOn, totalWeeks, type HistoryView } from '@mylife/training';
import { historyView, readProgram } from './queries';
import type { Db } from './sql';

/**
 * Le bilan d'un bloc terminé (maquette V3-Cycle, validée le 22/11), côté Worker : séances faites sur prévues, records,
 * forme moyenne ; pour chaque lift au % du 1RM, le nouveau 1RM de référence proposé (l'estimé de la fin du bloc, en lest
 * net) ; le bloc suivant.
 */

const kg = (v: number, weighted: boolean) => `${weighted && v > 0 ? '+' : ''}${v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}`;
const shortDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

export interface CycleReport {
  id: string;
  name: string;
  kind: string;
  weeks: number;
  ended: boolean;
  dates: string;
  sessions: { done: number; planned: number };
  records: number;
  rating: number | null;
  proposals: { exerciseId: string; name: string; from: string | null; to: string; value: number; changed: boolean }[];
  next: { id: string; name: string; kind: string; goal: string; weeks: string; start: string } | null;
}

export function cycleReport(d: Db, id: string, date: string): CycleReport | null {
  const program = readProgram(d);
  const blocks = program.structure.kind === 'periodized' ? [...program.structure.blocks].sort((a, b) => a.startDate.localeCompare(b.startDate)) : [];
  const m = blocks.find((b) => b.id === id);
  if (!m) return null;
  const h = historyView(d);
  const end = addDays(m.startDate, totalWeeks(m) * 7 - 1);
  const alive = new Set(d.all<{ id: string }>('SELECT id FROM templates WHERE archived = 0').map((r) => r.id));
  const until = end < date ? end : date;
  const done = d.all<{ id: string; rating: number | null }>("SELECT id, rating FROM workouts WHERE status = 'completed' AND date BETWEEN ? AND ?", [m.startDate, until]);
  let planned = 0;
  for (let i = 0; i <= Math.max(0, diffDays(m.startDate, until)); i++) planned += sessionsOn(program.structure.pattern, addDays(m.startDate, i)).filter((t) => alive.has(t)).length;
  // Records : une séance du bloc qui bat le meilleur e1RM d'avant, par exercice.
  let records = 0;
  for (const e of program.exercises) {
    const sets = h.refSets(e.id);
    if (!sets.length) continue;
    let best = Math.max(0, ...sets.filter((s) => s.date < m.startDate).map((s) => estimate1RM(s.load, s.reps)));
    for (const s of sets.filter((x) => x.date >= m.startDate && x.date <= until)) {
      const v = estimate1RM(s.load, s.reps);
      if (best > 0 && v > best + 1e-6) records += 1;
      best = Math.max(best, v);
    }
  }
  const rated = done.filter((w) => w.rating !== null);
  const lifts = [...new Set(program.sessions.filter((s) => alive.has(s.id)).flatMap((s) => s.slots.filter((x) => x.strategy.id === 'percent_reference').map((x) => x.exerciseId)))];
  const proposals = lifts.flatMap((exerciseId) => {
    const e = program.exercises.find((x) => x.id === exerciseId);
    if (!e) return [];
    const weighted = e.loadType === 'bodyweight';
    const bw = h.bodyweight(until);
    const estimateOnly: HistoryView = { ...h, typedOneRm: () => null };
    const est = referenceFor(program, estimateOnly, e, addDays(until, 1), bw);
    if (!est) return [];
    const value = Math.round((weighted ? est.value - est.basis.bodyweight : est.value) * 10) / 10;
    const typed = h.typedOneRm(exerciseId);
    const from = typed && typed.mode === 'manual' ? typed.value : null;
    // On ne propose jamais de baisser une référence saisie : en dessous, elle reste (« stable »).
    const up = from === null || value >= from + 0.5;
    return [{ exerciseId, name: e.name, from: from === null ? null : kg(from, weighted), to: `${kg(up ? value : from!, weighted)} kg`, value: up ? value : from!, changed: up }];
  });
  const nextBlock = blocks[blocks.indexOf(m) + 1];
  const info = mesoKindInfo(m.kind);
  return {
    id,
    name: m.name,
    kind: info.label,
    weeks: totalWeeks(m),
    ended: end < date,
    dates: `${shortDate(m.startDate)} → ${shortDate(end)}`,
    sessions: { done: done.length, planned },
    records,
    rating: rated.length ? Math.round((rated.reduce((n, w) => n + (w.rating ?? 0), 0) / rated.length) * 10) / 10 : null,
    proposals,
    next: nextBlock
      ? { id: nextBlock.id, name: nextBlock.name, kind: mesoKindInfo(nextBlock.kind).label, goal: mesoKindInfo(nextBlock.kind).goal, weeks: `${nextBlock.workWeeks}${nextBlock.deloadWeeks ? ` + ${nextBlock.deloadWeeks}` : ''} sem.`, start: shortDate(nextBlock.startDate) }
      : null,
  };
}

/** Le bloc qui vient de finir (dans les 14 derniers jours), sans bloc en cours : pour proposer son bilan sur Jour. */
export function justEnded(d: Db, date: string): { id: string; name: string } | null {
  const program = readProgram(d);
  if (program.structure.kind !== 'periodized') return null;
  const blocks = [...program.structure.blocks].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const running = blocks.find((b) => date >= b.startDate && diffDays(b.startDate, date) < totalWeeks(b) * 7);
  const past = blocks.filter((b) => addDays(b.startDate, totalWeeks(b) * 7 - 1) < date).at(-1);
  if (!past) return null;
  const ago = diffDays(addDays(past.startDate, totalWeeks(past) * 7 - 1), date);
  // En cours : seulement dans la première semaine du bloc suivant (le bilan du précédent reste utile).
  if (ago > 14 || (running && diffDays(running.startDate, date) > 6)) return null;
  return { id: past.id, name: past.name };
}
