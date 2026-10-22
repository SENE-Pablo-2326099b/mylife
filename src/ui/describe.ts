/**
 * Ce qu'on dit d'un ami à l'écran : état, fraîcheur, précision, distance. Une seule source de vérité
 * pour le groupe et la navigation, testée à part.
 */
import { formatDistance } from '../domain/geo';
import { ageOf, formatAge, freshness, friendState, guidance, THRESHOLDS, type Fix, type Freshness, type FriendState, type Thresholds } from '../domain/status';
import type { Member } from '../state/app';

export type Tone = 'ok' | 'warn' | 'danger' | 'muted' | 'info';

export interface FriendLine {
  state: FriendState;
  freshness: Freshness | null;
  /** Phrase d'état, toujours présente. */
  text: string;
  tone: Tone;
  /** « ≈ 120 m », ou null si on ne peut pas la calculer honnêtement. */
  distance: string | null;
  /** Pourquoi pas de distance. */
  noDistance: string | null;
  imprecise: boolean;
  /** Pour trier : distance en mètres si connue. */
  meters: number | null;
}

/** Ma propre position est-elle utilisable pour un calcul ? Trop vieille, elle fausserait tout. */
export const usableMe = (me: Fix | null, now: number, t: Thresholds = THRESHOLDS) => (me && now - me.at < t.recentMs ? me : null);

export function describe(m: Member, me: Fix | null, now: number, t: Thresholds = THRESHOLDS): FriendLine {
  const state = friendState(m, now, t);
  const fix = m.fix;
  const age = fix ? ageOf(fix, now) : null;
  const fr = age == null ? null : freshness(age, t);
  const imprecise = !!fix && fix.acc > t.impreciseM;
  const precision = fix ? (imprecise ? `imprécise (±\u00a0${Math.round(fix.acc)}\u00a0m)` : `±\u00a0${Math.round(fix.acc)}\u00a0m`) : '';

  let text: string;
  let tone: Tone;
  if (m.unreadable) {
    text = 'Position reçue mais illisible (clé du groupe différente)';
    tone = 'danger';
  } else if (state === 'not-sharing') {
    text = 'Ne partage pas sa position';
    tone = 'muted';
  } else if (state === 'waiting') {
    text = 'Partage activé, en attente de sa position';
    tone = 'info';
  } else if (state === 'paused') {
    text = fix ? `Partage en pause · position figée ${formatAge(age!)}` : 'Partage en pause';
    tone = 'warn';
  } else if (state === 'silent') {
    text = `Plus de nouvelles depuis ${formatAge(age!).replace('il y a ', '')} (app fermée ou réseau)`;
    tone = fr === 'stale' ? 'danger' : 'warn';
  } else if (fr === 'live') {
    text = `Position à jour · ${precision}`;
    tone = imprecise ? 'warn' : 'ok';
  } else {
    text = `Dernière position ${formatAge(age!)} · ${precision}`;
    tone = 'warn';
  }

  let distance: string | null = null;
  let noDistance: string | null = null;
  let meters: number | null = null;
  const mine = usableMe(me, now, t);
  if (!fix || m.unreadable) noDistance = null;
  else if (!mine) noDistance = 'Ta position est inconnue';
  else {
    const g = guidance(mine, 'ok', fix, state, t);
    if (g.kind === 'near' || g.kind === 'uncertain' || g.kind === 'ok') {
      meters = g.distance;
      distance = g.kind === 'near' ? 'Tout proche' : `≈ ${formatDistance(g.distance, g.uncertainty)}`;
    }
  }
  return { state, freshness: fr, text, tone, distance, noDistance, imprecise, meters };
}

const RANK: Record<FriendState, number> = { live: 0, silent: 1, paused: 2, waiting: 3, 'not-sharing': 4 };

/** Les amis localisables d'abord, puis par distance, puis par nom. */
export function sortFriends<T extends { m: Member; line: FriendLine }>(list: T[]): T[] {
  return [...list].sort(
    (a, b) =>
      RANK[a.line.state] - RANK[b.line.state] ||
      (a.line.meters ?? Infinity) - (b.line.meters ?? Infinity) ||
      (a.m.name ?? '').localeCompare(b.m.name ?? '', 'fr'),
  );
}
