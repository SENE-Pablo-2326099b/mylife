// GÉNÉRÉ depuis MyLife/packages/ui — ne pas modifier ici (MyLife : npm run vendor).
import { useMemo, useSyncExternalStore } from 'react';
import { MERGED_STATS, STATS_APPS, computeCharacter, localToday, mergeStats, parseMusicSummary, parseStats, readStats, sameStats, statsKey, weekStart, type AppStats, type Character, type MusicSummary, type StatId, type StatsApp, type StatsByApp } from '../vendor/lumen';

/**
 * Compteurs du Personnage sur le web. Chaque app dépose les siens (`publishStats`) dans le stockage
 * commun de l'adresse MyLife ; la synchro des réglages communs (prefsSync, app `mylife`) les envoie,
 * chiffrés, et reçoit ceux des autres appareils. L'accueil en calcule le personnage (`useCharacter`).
 * Rien que des nombres par semaine : jamais de montant ni de détail.
 */
const EVENT = 'mylife:stats';
const CHARACTER_KEY = 'mylife:character';

/** Préférences du personnage (synchronisées) : semaines de repos, et ce que chaque Crew voit en plus du niveau. */
export interface CharacterPrefs {
  at: number;
  rest: string[];
  /** Par Crew (identifiant d'espace) : les stats dont le niveau est partagé. */
  crews: Record<string, StatId[]>;
}

const STAT_IDS: readonly StatId[] = ['force', 'discipline', 'social', 'constance', 'culture'];

function readCrews(v: unknown): Record<string, StatId[]> {
  const out: Record<string, StatId[]> = {};
  if (!v || typeof v !== 'object') return out;
  for (const [sid, list] of Object.entries(v as Record<string, unknown>)) {
    if (/^[0-9a-f]{32}$/.test(sid) && Array.isArray(list)) out[sid] = list.filter((x): x is StatId => (STAT_IDS as readonly string[]).includes(x as string));
  }
  return out;
}

function emit() {
  window.dispatchEvent(new Event(EVENT));
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* stockage indisponible : le personnage se recalculera au prochain passage */
  }
}

/** Appelé quand des compteurs changent : la synchro des réglages communs les enverra. */
let onChange: (() => void) | null = null;
export function onStatsChange(fn: () => void): void {
  onChange = fn;
}

/**
 * Dépose les compteurs de cette app ; ne réécrit rien (ni n'envoie) s'ils n'ont pas changé. Pour une app
 * qui accumule (myRaveLoc), les compteurs s'ajoutent à l'historique déjà connu au lieu de le remplacer.
 */
export function publishStats(app: StatsApp, next: Pick<AppStats, 'weeks' | 'goal'>): void {
  const mine = readStats(app);
  let row: AppStats = { v: 1, at: Date.now(), weeks: next.weeks, ...(next.goal !== undefined ? { goal: next.goal } : {}) };
  if (MERGED_STATS.includes(app)) row = { ...mergeStats(mine, row)!, at: row.at };
  if (sameStats(mine, row)) return;
  write(statsKey(app), row);
  emit();
  onChange?.();
}

/**
 * Compteurs venus d'un autre appareil. Renvoie vrai quand cet appareil a maintenant exactement ceux du
 * compte (rien à renvoyer). App recalculée : les plus récents gagnent. App qui accumule (myRaveLoc) :
 * fusion ; si cet appareil apporte des semaines que le compte n'a pas, la fusion est redatée pour repartir.
 */
export function adoptStats(app: StatsApp, raw: unknown): boolean {
  const row = parseStats(raw);
  const mine = readStats(app);
  if (!row) return false;
  if (MERGED_STATS.includes(app) && mine) {
    const merged = mergeStats(mine, row)!;
    if (sameStats(merged, row)) {
      if (!sameStats(mine, row) || mine.at !== row.at) {
        write(statsKey(app), row);
        emit();
      }
      return true;
    }
    write(statsKey(app), { ...merged, at: Math.max(Date.now(), merged.at + 1) });
    emit();
    onChange?.();
    return false;
  }
  if (mine && mine.at >= row.at) return false;
  write(statsKey(app), row);
  emit();
  return true;
}

export function readCharacterPrefs(): CharacterPrefs {
  try {
    const p = JSON.parse(localStorage.getItem(CHARACTER_KEY) ?? 'null') as Partial<CharacterPrefs> | null;
    if (p && typeof p.at === 'number' && Array.isArray(p.rest)) return { at: p.at, rest: p.rest.filter((w): w is string => typeof w === 'string'), crews: readCrews(p.crews) };
  } catch {
    /* illisible : valeurs par défaut */
  }
  return { at: 0, rest: [], crews: {} };
}

export function adoptCharacterPrefs(raw: unknown): boolean {
  const p = raw as Partial<CharacterPrefs> | null;
  if (!p || typeof p.at !== 'number' || !Array.isArray(p.rest) || p.at <= readCharacterPrefs().at) return false;
  write(CHARACTER_KEY, { at: p.at, rest: p.rest.filter((w): w is string => typeof w === 'string'), crews: readCrews(p.crews) });
  emit();
  return true;
}

/** Semaine de repos : une toutes les quatre semaines au plus (la série est gelée, rien n'est gagné en Constance). */
export function canRest(today = localToday()): boolean {
  const week = weekStart(today);
  const recent = readCharacterPrefs().rest.filter((w) => w > addDays(week, -28) && w !== week);
  return recent.length === 0;
}

export function setRestWeek(on: boolean, today = localToday()): void {
  const week = weekStart(today);
  const p = readCharacterPrefs();
  const rest = on ? [...new Set([...p.rest, week])].sort().slice(-60) : p.rest.filter((w) => w !== week);
  write(CHARACTER_KEY, { ...p, at: Date.now(), rest });
  emit();
  onChange?.();
}

/** Les stats dont un Crew voit le niveau (en plus du niveau, du titre, de la série et de l'XP du mois). */
export function crewShare(sid: string): StatId[] {
  return readCharacterPrefs().crews[sid] ?? [];
}

export function setCrewShare(sid: string, stats: readonly StatId[]): void {
  const p = readCharacterPrefs();
  write(CHARACTER_KEY, { ...p, at: Date.now(), crews: { ...p.crews, [sid]: [...stats] } });
  emit();
  onChange?.();
}

const addDays = (iso: string, n: number) => new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)) + n)).toISOString().slice(0, 10);

function subscribe(fn: () => void): () => void {
  const onStorage = (e: StorageEvent) => (e.key === null || e.key.startsWith('mylife:stats:') || e.key === CHARACTER_KEY || e.key === MUSIC_KEY) && fn();
  window.addEventListener('storage', onStorage);
  window.addEventListener(EVENT, fn);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(EVENT, fn);
  };
}

/** Empreinte des compteurs stockés (stable tant qu'ils ne changent pas). */
function fingerprint(): string {
  try {
    return [...STATS_APPS.map((a) => localStorage.getItem(statsKey(a)) ?? ''), localStorage.getItem(CHARACTER_KEY) ?? '', localStorage.getItem('mylife:character:seen') ?? '', localToday()].join('\u0001');
  } catch {
    return '';
  }
}

/** Les compteurs de toutes les apps et les semaines de repos, relus quand ils changent. */
export function useStatsInput(): { stats: StatsByApp; rest: string[]; today: string } {
  const key = useSyncExternalStore(subscribe, fingerprint, () => '');
  return useMemo(
    () => ({ stats: Object.fromEntries(STATS_APPS.map((a) => [a, readStats(a)])) as StatsByApp, rest: readCharacterPrefs().rest, today: localToday() }),
    [key], // eslint-disable-line react-hooks/exhaustive-deps
  );
}

/** Le personnage, recalculé quand un compteur change (ici ou dans un autre onglet, ou par la synchro). */
export function useCharacter(): Character {
  const { stats, rest, today } = useStatsInput();
  return useMemo(() => computeCharacter(stats, today, rest), [stats, rest, today]);
}

// ---------------------------------------------------------------- cartes déjà vues (bilan, Wrapped)

const SEEN_KEY = 'mylife:character:seen';

/** Ce que l'utilisateur a déjà vu (« week:2026-10-19 », « wrapped:2026-10 ») : la carte ne revient pas. Sur l'appareil seulement. */
export function wasSeen(id: string): boolean {
  try {
    return (JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[]).includes(id);
  } catch {
    return false;
  }
}

export function markSeen(id: string): void {
  try {
    const all = (JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[]).filter((x) => x !== id);
    localStorage.setItem(SEEN_KEY, JSON.stringify([...all, id].slice(-40)));
  } catch {
    /* stockage indisponible : la carte reviendra */
  }
  emit();
}

// ---------------------------------------------------------------- MyMusique : le résumé d'écoute

const MUSIC_KEY = 'mylife:music';

/** Le résumé d'écoute (MyMusique) : sur l'appareil, et chiffré dans le compte par la synchro des réglages communs. */
export function readMusic(): MusicSummary | null {
  try {
    return parseMusicSummary(JSON.parse(localStorage.getItem(MUSIC_KEY) ?? 'null'));
  } catch {
    return null;
  }
}

export function saveMusic(summary: MusicSummary): void {
  write(MUSIC_KEY, summary);
  emit();
  onChange?.();
}

/** Résumé venu d'un autre appareil : gardé s'il est plus récent. */
export function adoptMusic(raw: unknown): boolean {
  const s = parseMusicSummary(raw);
  if (!s || s.at <= (readMusic()?.at ?? 0)) return false;
  write(MUSIC_KEY, s);
  emit();
  return true;
}

export function useMusic(): MusicSummary | null {
  const key = useSyncExternalStore(subscribe, () => {
    try {
      return localStorage.getItem(MUSIC_KEY) ?? '';
    } catch {
      return '';
    }
  }, () => '');
  return useMemo(() => (key ? readMusic() : null), [key]);
}
