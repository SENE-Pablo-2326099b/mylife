import { useEffect, useSyncExternalStore } from 'react';
import { buildCrewScore, CREW_TABLE, localToday, monthWeeks, parseCrewScore, rankCrew, recap, sameCrewScore, type Character, type CrewEntry, type CrewScore, type StatsByApp } from './vendor/lumen';
import { SpaceClient, type Space, type SpaceMember } from './vendor/mylife-sync';
import { currentSession, onSessionChange, webPlatform } from './vendor/mylife-sync/web';
import { crewShare } from './ui/stats';

/**
 * Le Crew sur l'accueil : mes Crews (espaces partagés de type « crew »), mon score publié dans chacun
 * (seulement quand il change), le classement du mois. Le score ne contient que ce que le Personnage
 * montre : niveau, titre, série, XP (et les stats choisies). Serveur : server/space.ts.
 */

export const CREW_URL = () => `${location.origin}/crew/rejoindre`;
const PUBLISHED = (sid: string) => `mylife:character:crew-pub:${sid}`;
const PENDING_INVITE = 'mylife:crew-invite';

export function client(): SpaceClient | null {
  const s = currentSession();
  return s ? new SpaceClient(webPlatform.api, s, webPlatform.random) : null;
}

interface CrewState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  uid: string | null;
  crews: Space[];
  error: string | null;
}

let state: CrewState = { status: 'idle', uid: null, crews: [], error: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<CrewState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

onSessionChange(() => set({ status: 'idle', uid: null, crews: [], error: null }));

export function useCrews(): CrewState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export async function loadCrews(): Promise<CrewState> {
  const c = client();
  if (!c) return state;
  if (state.status !== 'ready') set({ status: 'loading', error: null });
  try {
    const r = await c.list();
    set({ status: 'ready', uid: r.uid, crews: r.spaces.filter((s) => s.kind === 'crew'), error: null });
  } catch (e) {
    set({ status: state.crews.length ? 'ready' : 'error', error: e instanceof Error ? e.message : String(e) });
  }
  return state;
}

/** XP gagnés ce mois-ci (semaines dont le lundi tombe dans le mois). */
export function monthXp(stats: StatsByApp, rest: readonly string[], today = localToday()): { month: string; xp: number } {
  const month = today.slice(0, 7);
  const { from, to } = monthWeeks(month);
  return { month, xp: recap(stats, today, from, to, rest).xp };
}

/** Publie mon score dans un Crew s'il a changé depuis la dernière fois (sur cet appareil). */
export async function publishScore(space: Space, uid: string, character: Character, month: { month: string; xp: number }, force = false): Promise<void> {
  const c = client();
  if (!c || character.empty) return;
  const score = buildCrewScore(character, month.month, month.xp, crewShare(space.id));
  let last: CrewScore | null = null;
  try {
    last = parseCrewScore(JSON.parse(localStorage.getItem(PUBLISHED(space.id)) ?? 'null'));
  } catch {
    /* rien de connu */
  }
  if (!force && sameCrewScore(last, score)) return;
  await c.sync(space, Number.MAX_SAFE_INTEGER, [{ tbl: CREW_TABLE, rid: uid, row: score }]);
  try {
    localStorage.setItem(PUBLISHED(space.id), JSON.stringify(score));
  } catch {
    /* stockage indisponible : republié la prochaine fois */
  }
}

export interface CrewBoard {
  members: SpaceMember[];
  entries: CrewEntry[];
}

/** Membres et classement du mois d'un Crew (seuls les scores des membres actuels comptent). */
export async function loadBoard(space: Space, uid: string, month: string): Promise<CrewBoard> {
  const c = client();
  if (!c) return { members: [], entries: [] };
  const [members, data] = await Promise.all([c.members(space), c.sync(space, 0)]);
  const scores = new Map<string, CrewScore>();
  const current = new Set(members.map((m) => m.uid));
  for (const r of data.records) {
    if (r.tbl !== CREW_TABLE || r.rid !== r.author || !current.has(r.author)) continue;
    const s = parseCrewScore(r.row);
    if (s) scores.set(r.author, s);
  }
  return { members, entries: rankCrew(members, scores, uid, month) };
}

/** Tient mon score à jour dans tous mes Crews (au lancement de l'accueil, puis quand le personnage change). */
export function useCrewPublisher(character: Character, stats: StatsByApp, rest: readonly string[]): void {
  useEffect(() => {
    if (!currentSession() || character.empty) return;
    const timer = setTimeout(() => {
      void (async () => {
        const s = state.status === 'ready' ? state : await loadCrews();
        if (!s.uid) return;
        const month = monthXp(stats, rest);
        for (const crew of s.crews) await publishScore(crew, s.uid, character, month).catch(() => undefined);
      })();
    }, 2500);
    return () => clearTimeout(timer);
  }, [character, stats, rest]);
}

// ---------------------------------------------------------------- invitation reçue avant la connexion

/** Lien d'invitation ouvert sans être connecté : gardé le temps de créer son compte ou de se connecter. */
export function stashInvite(hash: string): void {
  try {
    if (hash.includes('espace=')) sessionStorage.setItem(PENDING_INVITE, hash);
  } catch {
    /* rien */
  }
}

export function takeStashedInvite(): string | null {
  try {
    const v = sessionStorage.getItem(PENDING_INVITE);
    if (v) sessionStorage.removeItem(PENDING_INVITE);
    return v;
  } catch {
    return null;
  }
}
