// GÉNÉRÉ depuis MyLife/packages/ui — ne pas modifier ici (MyLife : npm run vendor).
import { useMemo, useSyncExternalStore } from 'react';
import { MERGED_STATS, STATS_APPS, computeCharacter, localToday, mergeLegacyMiniApp, mergeStats, parseGames, parseMiniApp, parseMusicSummary, parseStats, readStats, sameStats, statsKey, weekStart, type AppStats, type Character, type GamesData, type MiniApp, type MusicSummary, type StatId, type StatsApp, type StatsByApp } from '../vendor/lumen';

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
 * qui accumule (MyRave), les compteurs s'ajoutent à l'historique déjà connu au lieu de le remplacer.
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
 * compte (rien à renvoyer). App recalculée : les plus récents gagnent. App qui accumule (MyRave) :
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
  const onStorage = (e: StorageEvent) => (e.key === null || e.key.startsWith('mylife:stats:') || e.key === CHARACTER_KEY || e.key === MUSIC_KEY || e.key === GAMES_KEY || e.key === MINI_KEY) && fn();
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

// ---------------------------------------------------------------- MyGames : photos Steam et saisies

const GAMES_KEY = 'mylife:games';

export function readGames(): GamesData | null {
  try {
    return parseGames(JSON.parse(localStorage.getItem(GAMES_KEY) ?? 'null'));
  } catch {
    return null;
  }
}

export function saveGames(data: GamesData): void {
  write(GAMES_KEY, data);
  emit();
  onChange?.();
}

export function adoptGames(raw: unknown): boolean {
  const g = parseGames(raw);
  if (!g || g.at <= (readGames()?.at ?? 0)) return false;
  write(GAMES_KEY, g);
  emit();
  return true;
}

export function useGames(): GamesData | null {
  const key = useSyncExternalStore(subscribe, () => {
    try {
      return localStorage.getItem(GAMES_KEY) ?? '';
    } catch {
      return '';
    }
  }, () => '');
  return useMemo(() => (key ? readGames() : null), [key]);
}

// ---------------------------------------------------------------- Mes apps : apps sans code et leurs saisies

const MINI_KEY = 'mylife:miniapps';

/** Toutes les apps de l'appareil, supprimées comprises (traces vides, pour que la suppression suive). */
export function readMiniApps(): Record<string, MiniApp> {
  try {
    const raw = JSON.parse(localStorage.getItem(MINI_KEY) ?? '{}') as Record<string, unknown>;
    const out: Record<string, MiniApp> = {};
    for (const v of Object.values(raw ?? {})) {
      const app = parseMiniApp(v);
      if (app) out[app.id] = app;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Lignes à envoyer (synchro `miniapps`, voir miniSync.ts) : `app/<id>` ou `entry/<app>.<saisie>` → date de la
 * modification. Tenu ici, au seul endroit où l'on écrit : rien ne peut changer sans partir vers le compte.
 */
const MINI_DIRTY_KEY = 'mylife:miniapps-dirty';
/** Anciennes lignes (une par app, toutes ses saisies, dans l'app `mylife`) à effacer du compte : id → date. */
const MINI_LEGACY_KEY = 'mylife:miniapps-legacy';
const MINI_MIGRATED_KEY = 'mylife:miniapps-v2';

function readMap(key: string): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw ?? {})) if (typeof v === 'number') out[k] = v;
    return out;
  } catch {
    return {};
  }
}

export const readMiniDirty = (): Record<string, number> => readMap(MINI_DIRTY_KEY);
export const writeMiniDirty = (d: Record<string, number>): void => write(MINI_DIRTY_KEY, d);
export const readMiniLegacy = (): Record<string, number> => readMap(MINI_LEGACY_KEY);
export const writeMiniLegacy = (d: Record<string, number>): void => write(MINI_LEGACY_KEY, d);

/** Ce qui a changé entre deux versions d'une app, noté dans `dirty`. */
export function markMiniDirty(prev: MiniApp | undefined, next: MiniApp, dirty: Record<string, number>): void {
  if (!prev || prev.at !== next.at || !prev.spec !== !next.spec) dirty[`app/${next.id}`] = next.at;
  const before = new Map((prev?.spec ? prev.entries : []).map((e) => [e.id, e.at ?? 0]));
  for (const e of next.entries) if (before.get(e.id) !== (e.at ?? 0)) dirty[`entry/${next.id}.${e.id}`] = e.at ?? next.at;
  for (const [id, at] of Object.entries(next.gone ?? {})) if (prev?.gone?.[id] !== at) dirty[`entry/${next.id}.${id}`] = at;
  if (!next.spec && prev?.spec) for (const e of prev.entries) dirty[`entry/${next.id}.${e.id}`] = next.at;
}

/** Écrit les apps sans rien marquer à envoyer (ce qui vient du compte, ou une remise en ordre). */
export function writeMiniApps(all: Record<string, MiniApp>, notify = true): void {
  write(MINI_KEY, all);
  if (notify) emit();
}

export function saveMiniApp(app: MiniApp): void {
  const all = readMiniApps();
  const dirty = readMiniDirty();
  markMiniDirty(all[app.id], app, dirty);
  write(MINI_KEY, { ...all, [app.id]: app });
  writeMiniDirty(dirty);
  emit();
  onChange?.();
}

/**
 * Une app de l'ancien format, reçue par la synchro des réglages communs (un appareil pas encore à jour) : ses
 * saisies rejoignent celles d'ici et partent vers la nouvelle synchro ; l'ancienne ligne sera effacée.
 */
export function adoptLegacyMiniApp(raw: unknown): boolean {
  const old = parseMiniApp(raw);
  if (!old) return false;
  const all = readMiniApps();
  const merged = mergeLegacyMiniApp(all[old.id], old);
  const dirty = readMiniDirty();
  markMiniDirty(all[old.id], merged, dirty);
  writeMiniDirty(dirty);
  writeMiniLegacy({ ...readMiniLegacy(), [old.id]: Date.now() });
  if (JSON.stringify(all[old.id]) !== JSON.stringify(merged)) writeMiniApps({ ...all, [old.id]: merged });
  onChange?.();
  return true;
}

/**
 * Passage au nouveau format, une fois par appareil : chaque saisie reçoit une date (celle de son app), tout part
 * vers la synchro `miniapps`, et les anciennes lignes de l'app `mylife` sont à effacer.
 */
export function migrateMiniApps(): void {
  try {
    if (localStorage.getItem(MINI_MIGRATED_KEY)) return;
  } catch {
    return;
  }
  const all = readMiniApps();
  const dirty = readMiniDirty();
  const legacy = readMiniLegacy();
  const now = Date.now();
  for (const app of Object.values(all)) {
    const dated = { ...app, entries: app.entries.map((e) => (e.at ? e : { ...e, at: app.at })) };
    all[app.id] = dated;
    markMiniDirty(undefined, dated, dirty);
    legacy[app.id] = now;
  }
  writeMiniApps(all, false);
  writeMiniDirty(dirty);
  writeMiniLegacy(legacy);
  write(MINI_MIGRATED_KEY, 1);
}

/** Un autre compte vient d'être relié à cet appareil : tout ce qu'il contient est à envoyer. */
export function markAllMiniDirty(): void {
  const dirty = readMiniDirty();
  for (const app of Object.values(readMiniApps())) markMiniDirty(undefined, app, dirty);
  writeMiniDirty(dirty);
}

/** Les apps en service, les plus récentes d'abord. */
export function useMiniApps(): MiniApp[] {
  const key = useSyncExternalStore(subscribe, () => {
    try {
      return localStorage.getItem(MINI_KEY) ?? '';
    } catch {
      return '';
    }
  }, () => '');
  return useMemo(
    () =>
      Object.values(key ? readMiniApps() : {})
        .filter((a) => a.spec)
        .sort((a, b) => b.created - a.created),
    [key],
  );
}
