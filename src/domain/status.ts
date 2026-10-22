/**
 * États honnêtes : fraîcheur d'une position, état d'un ami, décision de guidage, rythme des envois.
 * Rien ici n'invente une donnée : une position absente reste absente, une position ancienne est
 * annoncée comme telle, une direction trop incertaine n'est pas montrée comme fiable.
 */
import { bearingDeg, distanceM, type LatLon } from './geo';

/** Seuils réglables (tests, et éventuel réglage futur). */
export interface Thresholds {
  /** En deçà : position « à jour ». */
  liveMs: number;
  /** En deçà : « récente » ; au-delà : « ancienne ». */
  recentMs: number;
  /** Au-delà : « très ancienne » (l'ami a pu beaucoup bouger). */
  staleMs: number;
  /** Précision (rayon, m) au-delà de laquelle une position est dite imprécise. */
  impreciseM: number;
  /** Distance sous laquelle on annonce « tout proche » plutôt qu'une direction. */
  nearM: number;
  /** « Tout proche » seulement si l'incertitude combinée reste sous ce rayon : sinon on n'en sait rien. */
  nearMaxUncertaintyM: number;
  /** Sans nouvelle d'un téléphone qui partage depuis ce délai : considéré déconnecté. */
  silentMs: number;
  /** Incertitude angulaire (°) au-delà de laquelle la direction n'est pas fiable. */
  maxAngularUncertainty: number;
}

export const THRESHOLDS: Thresholds = {
  liveMs: 60_000,
  recentMs: 3 * 60_000,
  staleMs: 15 * 60_000,
  impreciseM: 50,
  nearM: 15,
  nearMaxUncertaintyM: 30,
  silentMs: 2 * 60_000,
  maxAngularUncertainty: 50,
};

/** Une position GPS de l'appareil. `at` : instant de la mesure (horloge de cet appareil). */
export interface Fix extends LatLon {
  acc: number;
  at: number;
  /** Cap de déplacement GPS (°), quand l'appareil se déplace ; null sinon. */
  heading?: number | null;
  speed?: number | null;
}

/**
 * Position d'un ami telle que reçue. L'âge est mesuré sans comparer les horloges des téléphones :
 * âge à l'envoi (horloge de l'ami) + temps passé sur le serveur (horloge du serveur) + temps écoulé
 * depuis la réception (notre horloge).
 */
export interface FriendFix extends LatLon {
  acc: number;
  /** Âge de la position au moment où notre appareil l'a reçue (ms). */
  ageAtReceipt: number;
  /** Instant de réception (notre horloge, ms). */
  receivedAt: number;
}

export const ageOf = (f: FriendFix, now: number) => Math.max(0, f.ageAtReceipt + (now - f.receivedAt));

export type Freshness = 'live' | 'recent' | 'old' | 'stale';

export function freshness(ageMs: number, t: Thresholds = THRESHOLDS): Freshness {
  if (ageMs < t.liveMs) return 'live';
  if (ageMs < t.recentMs) return 'recent';
  if (ageMs < t.staleMs) return 'old';
  return 'stale';
}

/** « à l'instant », « il y a 40 s », « il y a 12 min », « il y a 2 h 05 ». */
export function formatAge(ageMs: number): string {
  const s = Math.round(ageMs / 1000);
  if (s < 10) return 'à l’instant';
  if (s < 60) return `il y a ${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  return `il y a ${h} h ${String(m % 60).padStart(2, '0')}`;
}

export type Sharing = 'on' | 'paused' | 'off';

/** État d'un ami tel qu'affiché dans le groupe. */
export type FriendState =
  /** Ne partage pas sa position (ou plus). */
  | 'not-sharing'
  /** A mis son partage en pause : sa dernière position reste visible, figée. */
  | 'paused'
  /** Partage, mais aucune position reçue pour l'instant (GPS en cours, autorisation refusée…). */
  | 'waiting'
  /** Partage et envoie : position à jour. */
  | 'live'
  /** Partage, mais plus de nouvelles depuis un moment (app en arrière-plan, réseau). */
  | 'silent';

export function friendState(m: { sharing: Sharing; fix: FriendFix | null }, now: number, t: Thresholds = THRESHOLDS): FriendState {
  if (m.sharing === 'off') return 'not-sharing';
  if (m.sharing === 'paused') return 'paused';
  if (!m.fix) return 'waiting';
  return ageOf(m.fix, now) < t.silentMs ? 'live' : 'silent';
}

export type Guidance =
  | { kind: 'no-me'; reason: 'locating' | 'denied' | 'unavailable' }
  | { kind: 'no-friend'; state: FriendState }
  | { kind: 'near'; distance: number; uncertainty: number }
  | { kind: 'uncertain'; distance: number; uncertainty: number; bearing: number }
  | { kind: 'ok'; distance: number; uncertainty: number; bearing: number; spread: number };

/**
 * Peut-on indiquer une direction ? Incertitude combinée des deux positions (rayons à ~68 %) :
 * - « tout proche » si l'on est sous le seuil de proximité (ou que les positions se recouvrent) ET que
 *   les positions sont assez précises pour l'affirmer ;
 * - « direction incertaine » si le cône d'incertitude dépasse l'angle maximal (positions imprécises
 *   qui se recouvrent comprises) : on ne fait pas semblant ;
 * - sinon une direction, avec `spread` : demi-angle d'incertitude (°), dessiné autour de la flèche.
 */
export function guidance(
  me: Fix | null,
  meStatus: 'locating' | 'denied' | 'unavailable' | 'ok',
  friend: FriendFix | null,
  friendSt: FriendState,
  t: Thresholds = THRESHOLDS,
): Guidance {
  if (!me || meStatus !== 'ok') return { kind: 'no-me', reason: meStatus === 'ok' ? 'locating' : meStatus };
  if (!friend) return { kind: 'no-friend', state: friendSt };
  const distance = distanceM(me, friend);
  const uncertainty = Math.hypot(me.acc, friend.acc);
  if (distance <= Math.max(t.nearM, uncertainty) && uncertainty <= t.nearMaxUncertaintyM) return { kind: 'near', distance, uncertainty };
  const bearing = bearingDeg(me, friend);
  const spread = distance > 0 ? (Math.atan(uncertainty / distance) * 180) / Math.PI : 90;
  if (spread > t.maxAngularUncertainty) return { kind: 'uncertain', distance, uncertainty, bearing };
  return { kind: 'ok', distance, uncertainty, bearing, spread };
}

// ---------------------------------------------------------------- envois et rythme

export interface SentFix extends LatLon {
  acc: number;
  sentAt: number;
}

/**
 * Faut-il envoyer cette position ? Oui au premier envoi, après un vrai déplacement (au-delà du bruit
 * GPS), si la précision s'améliore nettement, ou pour un signe de vie périodique quand on ne bouge
 * pas (sinon les amis verraient la position vieillir à tort).
 */
export function shouldSend(last: SentFix | null, fix: Fix, now: number, o: { heartbeatMs: number; minMoveM: number }): boolean {
  if (!last) return true;
  if (now - last.sentAt >= o.heartbeatMs) return true;
  if (fix.acc < last.acc * 0.6 && last.acc - fix.acc > 5) return true;
  return distanceM(last, fix) > Math.max(o.minMoveM, fix.acc / 2);
}

export type Screen = 'navigate' | 'group' | 'list';

/** Délai avant le prochain échange avec le serveur ; null = ne rien faire (caché, hors ligne). */
export function pollDelay(s: { screen: Screen; visible: boolean; online: boolean; failures: number }): number | null {
  if (!s.visible || !s.online) return null;
  const base = s.screen === 'navigate' ? 4000 : s.screen === 'group' ? 10_000 : 30_000;
  return Math.min(60_000, base * 2 ** Math.min(4, s.failures));
}

/** Rythme des signes de vie : plus serré pendant la navigation, quand l'ami nous cherche peut-être. */
export const heartbeatMs = (screen: Screen) => (screen === 'navigate' ? 15_000 : 30_000);
