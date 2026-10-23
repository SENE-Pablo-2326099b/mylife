// GÉNÉRÉ depuis MyLife/packages/lumen — ne pas modifier ici (MyLife : npm run vendor).
import { addWeeks, timeline, weekStart, type StatsByApp } from './character';

/**
 * Pacte : un engagement à plusieurs dans un Crew (« 3 séances par semaine chacun, 4 semaines, 5 € par
 * semaine ratée »). Validé tout seul par ce que les apps calculent (séances de MyPerf, jours sous le budget de
 * MyFinances, quêtes du Personnage) : personne ne coche à la main. Cagnotte virtuelle : un compteur, pas de
 * vrai virement ; à la fin, elle paie la soirée de la bande.
 *
 * Lignes de l'espace (Crew) : `pacte` / <id> (le pacte, écrit par son créateur), `pacte_week` /
 * `<id>:<uid>` (les valeurs par semaine de chacun, écrites par son appareil). Participer = publier ses valeurs.
 */

export type PacteKind = 'sessions' | 'budget' | 'quests';

export const PACTE_KINDS: Record<PacteKind, { label: string; unit: string; app: string; max: number }> = {
  sessions: { label: 'Séances par semaine', unit: 'séance', app: 'MyPerf', max: 7 },
  budget: { label: 'Jours sous le budget par semaine', unit: 'jour', app: 'MyFinances', max: 7 },
  quests: { label: 'Quêtes réussies par semaine', unit: 'quête', app: 'Personnage', max: 4 },
};

export interface Pacte {
  id: string;
  title: string;
  kind: PacteKind;
  /** Par semaine. */
  target: number;
  /** Mise par semaine ratée, en centimes. */
  stakeCents: number;
  /** Premier lundi, et nombre de semaines. */
  start: string;
  weeks: number;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parsePacte(id: string, raw: unknown): Pacte | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const kind = o.kind;
  if (kind !== 'sessions' && kind !== 'budget' && kind !== 'quests') return null;
  const int = (v: unknown, min: number, max: number) => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null);
  const target = int(o.target, 1, PACTE_KINDS[kind].max);
  const stakeCents = int(o.stakeCents, 0, 100_000);
  const weeks = int(o.weeks, 1, 26);
  const start = typeof o.start === 'string' && DATE.test(o.start) ? weekStart(o.start) : null;
  const title = typeof o.title === 'string' ? o.title.trim().slice(0, 80) : '';
  if (target === null || stakeCents === null || weeks === null || !start) return null;
  return { id, title: title || `${target} ${PACTE_KINDS[kind].unit}${target > 1 ? 's' : ''} par semaine`, kind, target, stakeCents, start, weeks };
}

export const pacteWeeks = (p: Pacte): string[] => Array.from({ length: p.weeks }, (_, i) => addWeeks(p.start, i));

/** Les valeurs de cet appareil (mes compteurs) pour chaque semaine du pacte déjà commencée. */
export function myPacteValues(p: Pacte, stats: StatsByApp, today: string, rest: readonly string[] = []): Record<string, number> {
  const now = weekStart(today);
  const line = p.kind === 'quests' ? new Map(timeline(stats, today, rest).map((w) => [w.week, w])) : null;
  const out: Record<string, number> = {};
  for (const w of pacteWeeks(p)) {
    if (w > now) break;
    if (p.kind === 'sessions') out[w] = stats.perf?.weeks[w]?.sessions ?? 0;
    else if (p.kind === 'budget') out[w] = stats.finances?.weeks[w]?.under ?? 0;
    else out[w] = line?.get(w)?.quests.filter((q) => q.id !== 'full' && q.done).length ?? 0;
  }
  return out;
}

export function parsePacteValues(raw: unknown): Record<string, number> {
  const o = raw && typeof raw === 'object' ? ((raw as Record<string, unknown>).weeks as Record<string, unknown> | undefined) : undefined;
  const out: Record<string, number> = {};
  if (o && typeof o === 'object') for (const [w, v] of Object.entries(o)) if (DATE.test(w) && typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 50) out[w] = v;
  return out;
}

export type PacteStatus = 'avant' | 'en_cours' | 'termine';

export interface PacteResult {
  status: PacteStatus;
  /** Semaines du pacte : pour chacune et chaque participant, la valeur, réussi ou non, et si la semaine est finie. */
  weeks: { week: string; finished: boolean; current: boolean; results: Record<string, { value: number; ok: boolean }> }[];
  /** Cagnotte (centimes) et ce que chacun y a mis. */
  pot: number;
  byPerson: Record<string, number>;
  /** Ceux qui n'ont raté aucune semaine finie. */
  perfect: string[];
}

/**
 * Le pacte évalué. Une semaine compte quand elle est finie ; la semaine en cours montre l'avancée sans rien
 * coûter. Une semaine sans valeur publiée par un participant compte comme ratée (il n'a pas ouvert MyLife ?
 * ses données n'ont pas été publiées) : sauf si elle est encore en cours.
 */
export function evaluatePacte(p: Pacte, participants: readonly string[], values: ReadonlyMap<string, Record<string, number>>, today: string): PacteResult {
  const now = weekStart(today);
  const weeks = pacteWeeks(p);
  const byPerson: Record<string, number> = Object.fromEntries(participants.map((u) => [u, 0]));
  const rows = weeks
    .filter((w) => w <= now)
    .map((w) => {
      const finished = w < now;
      const results: Record<string, { value: number; ok: boolean }> = {};
      for (const u of participants) {
        const value = values.get(u)?.[w] ?? 0;
        const ok = value >= p.target;
        results[u] = { value, ok };
        if (finished && !ok) byPerson[u]! += p.stakeCents;
      }
      return { week: w, finished, current: w === now, results };
    });
  const last = weeks[weeks.length - 1]!;
  return {
    status: now < p.start ? 'avant' : now > last ? 'termine' : 'en_cours',
    weeks: rows,
    pot: Object.values(byPerson).reduce((a, b) => a + b, 0),
    byPerson,
    perfect: participants.filter((u) => rows.filter((r) => r.finished).every((r) => r.results[u]!.ok)),
  };
}
