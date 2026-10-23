import type { Character, StatId } from './character';

/**
 * Le Crew : un espace partagé où chaque membre publie son score du Personnage, et rien d'autre. Par
 * défaut : niveau, titre, série, XP du mois (le classement). Les niveaux de chaque stat ne partent que si
 * on les a choisis, groupe par groupe. Jamais de montant, de séance, ni de donnée brute.
 */

export const CREW_TABLE = 'score';
export const SHAREABLE_STATS: readonly StatId[] = ['force', 'discipline', 'social', 'constance'];

export interface CrewScore {
  v: 1;
  level: number;
  title: string;
  streak: number;
  /** Mois du classement (`AAAA-MM`) et XP gagnés pendant ce mois. */
  month: string;
  monthXp: number;
  weekXp: number;
  /** Niveaux des stats choisies (les autres sont absentes). */
  stats: Partial<Record<StatId, number>>;
  at: number;
}

export function buildCrewScore(c: Character, month: string, monthXp: number, share: readonly StatId[], at = Date.now()): CrewScore {
  const stats: Partial<Record<StatId, number>> = {};
  for (const s of c.stats) if (share.includes(s.id) && !s.locked) stats[s.id] = s.level;
  return { v: 1, level: c.level, title: c.title, streak: c.streak, month, monthXp: Math.max(0, Math.round(monthXp)), weekXp: Math.max(0, Math.round(c.weekXp)), stats, at };
}

/** Lecture prudente d'un score reçu (il vient d'un autre appareil). */
export function parseCrewScore(raw: unknown): CrewScore | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<CrewScore>;
  const n = (v: unknown, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
  if (s.v !== 1 || !n(s.level, 1000) || !n(s.streak, 10_000) || !n(s.monthXp, 1e7) || !n(s.weekXp, 1e6) || typeof s.title !== 'string' || typeof s.month !== 'string' || !/^\d{4}-\d{2}$/.test(s.month)) return null;
  const stats: Partial<Record<StatId, number>> = {};
  if (s.stats && typeof s.stats === 'object') for (const id of SHAREABLE_STATS) if (n((s.stats as Record<string, unknown>)[id], 1000)) stats[id] = (s.stats as Record<string, number>)[id]!;
  return { v: 1, level: s.level!, title: s.title.slice(0, 40), streak: s.streak!, month: s.month, monthXp: s.monthXp!, weekXp: s.weekXp!, stats, at: typeof s.at === 'number' ? s.at : 0 };
}

export interface CrewEntry {
  uid: string;
  pseudo: string;
  me: boolean;
  /** null : n'a encore rien publié. */
  score: CrewScore | null;
  /** XP du mois en cours (0 si le score date d'un mois précédent). */
  monthXp: number;
  rank: number;
}

/** Classement du mois : XP du mois, puis niveau. Un score d'un mois passé compte pour 0 ce mois-ci. */
export function rankCrew(members: readonly { uid: string; pseudo: string }[], scores: ReadonlyMap<string, CrewScore>, me: string, month: string): CrewEntry[] {
  const rows = members.map((m) => {
    const score = scores.get(m.uid) ?? null;
    return { uid: m.uid, pseudo: m.pseudo, me: m.uid === me, score, monthXp: score && score.month === month ? score.monthXp : 0, rank: 0 };
  });
  rows.sort((a, b) => b.monthXp - a.monthXp || (b.score?.level ?? 0) - (a.score?.level ?? 0) || a.pseudo.localeCompare(b.pseudo));
  rows.forEach((r, i) => (r.rank = i > 0 && rows[i - 1]!.monthXp === r.monthXp && (rows[i - 1]!.score?.level ?? 0) === (r.score?.level ?? 0) ? rows[i - 1]!.rank : i + 1));
  return rows;
}

/** Même contenu (sans la date) : rien à republier. */
export const sameCrewScore = (a: CrewScore | null, b: CrewScore | null): boolean => !!a && !!b && JSON.stringify({ ...a, at: 0 }) === JSON.stringify({ ...b, at: 0 });
