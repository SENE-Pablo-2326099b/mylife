// GÉNÉRÉ depuis MyLife/packages/lumen — ne pas modifier ici (MyLife : npm run vendor).
/**
 * Agenda commun (V4, F3) : chaque app publie ses événements à venir dans un format partagé (séance prévue, paie,
 * prélèvement, investissement, sortie…), sur l'appareil seulement (`mylife:agenda:<app>`, jamais synchronisé, effacé
 * quand un autre compte se connecte). L'accueil (« Ta journée »), Copilot et plus tard MyAgenda les lisent ensemble.
 * Chaque app recalcule les siens quand elle s'ouvre ; un agenda trop ancien est signalé (`stale`).
 */

export type AgendaApp = 'finances' | 'perf' | 'home';
export type AgendaKind = 'session' | 'income' | 'charge' | 'savings' | 'sortie' | 'other';

export interface AgendaEvent {
  /** Unique dans son app. */
  id: string;
  app: AgendaApp;
  kind: AgendaKind;
  title: string;
  /** AAAA-MM-JJ. */
  date: string;
  /** Dernier jour (événement sur plusieurs jours, une sortie), sinon absent. */
  end?: string;
  /** Heure (HH:MM) si elle est connue. */
  time?: string;
  /** Montant en centimes, positif (argent), pour l'appareil seulement. */
  amount?: number;
  /** Où aller pour le voir (chemin de l'adresse MyLife). */
  url?: string;
}

interface AgendaCard {
  /** Jour où l'app l'a calculé. */
  day: string;
  events: AgendaEvent[];
}

export const AGENDA_APPS: readonly AgendaApp[] = ['finances', 'perf', 'home'];
export const agendaKey = (app: AgendaApp) => `mylife:agenda:${app}`;
/** Émis dans la page quand une app y réécrit son agenda (l'événement `storage` ne vient que des autres onglets). */
export const AGENDA_EVENT = 'mylife:agenda';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;
const KINDS: readonly AgendaKind[] = ['session', 'income', 'charge', 'savings', 'sortie', 'other'];

/** Lecture prudente d'un événement. */
export function parseAgendaEvent(raw: unknown, app: AgendaApp): AgendaEvent | null {
  const o = raw as Partial<AgendaEvent> | null;
  if (!o || typeof o.id !== 'string' || typeof o.title !== 'string' || typeof o.date !== 'string' || !DATE.test(o.date)) return null;
  const kind = KINDS.includes(o.kind as AgendaKind) ? (o.kind as AgendaKind) : 'other';
  return {
    id: o.id.slice(0, 120),
    app,
    kind,
    title: o.title.slice(0, 80),
    date: o.date,
    ...(typeof o.end === 'string' && DATE.test(o.end) && o.end >= o.date ? { end: o.end } : {}),
    ...(typeof o.time === 'string' && TIME.test(o.time) ? { time: o.time } : {}),
    ...(typeof o.amount === 'number' && Number.isFinite(o.amount) ? { amount: Math.abs(Math.round(o.amount)) } : {}),
    ...(typeof o.url === 'string' && o.url.startsWith('/') ? { url: o.url.slice(0, 200) } : {}),
  };
}

/** Une app dépose ses événements à venir (remplace les précédents). 200 au plus. */
export function writeAgenda(app: AgendaApp, day: string, events: readonly Omit<AgendaEvent, 'app'>[]): void {
  try {
    const clean = events.flatMap((e) => parseAgendaEvent({ ...e, app }, app) ?? []).slice(0, 200);
    globalThis.localStorage?.setItem(agendaKey(app), JSON.stringify({ day, events: clean } satisfies AgendaCard));
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(AGENDA_EVENT));
  } catch {
    /* stockage indisponible */
  }
}

function readCard(app: AgendaApp): AgendaCard | null {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(agendaKey(app)) ?? 'null') as Partial<AgendaCard> | null;
    if (!v || typeof v.day !== 'string' || !Array.isArray(v.events)) return null;
    return { day: v.day, events: v.events.flatMap((e) => parseAgendaEvent(e, app) ?? []) };
  } catch {
    return null;
  }
}

export interface AgendaView {
  events: AgendaEvent[];
  /** Pour chaque app : le jour de son dernier calcul (null : jamais ouverte sur cet appareil). */
  sources: Record<AgendaApp, string | null>;
  /** Apps dont l'agenda date d'avant aujourd'hui (à rouvrir pour le rafraîchir). */
  stale: AgendaApp[];
}

/** Tous les événements entre deux dates (incluses), triés ; une sortie sur plusieurs jours compte dès qu'elle chevauche. */
export function readAgenda(from: string, to: string, today = from): AgendaView {
  const sources = {} as Record<AgendaApp, string | null>;
  const events: AgendaEvent[] = [];
  const stale: AgendaApp[] = [];
  for (const app of AGENDA_APPS) {
    const card = readCard(app);
    sources[app] = card?.day ?? null;
    if (card && card.day < today) stale.push(app);
    for (const e of card?.events ?? []) if ((e.end ?? e.date) >= from && e.date <= to) events.push(e);
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '99').localeCompare(b.time ?? '99') || a.title.localeCompare(b.title));
  return { events, sources, stale };
}

/** Les événements d'un jour (une sortie en cours compte chaque jour). */
export const eventsOn = (events: readonly AgendaEvent[], day: string) => events.filter((e) => e.date <= day && (e.end ?? e.date) >= day);
