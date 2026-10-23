import { weekStart, type StatsByApp } from './character';

/**
 * MyGames : tes heures de jeu. Steam ne donne que des totaux (depuis toujours, et les deux dernières
 * semaines) : chaque mise à jour garde une photo des totaux, et les heures d'une période sont la
 * différence entre deux photos, réparties sur les jours qui les séparent. La première photo rapporte
 * aussi les deux semaines qui la précèdent. Les jeux hors Steam (console, mobile) se notent à la main.
 * Le jeu ne rapporte pas d'XP au Personnage (on ne récompense pas le temps d'écran) : il apparaît dans
 * « Où va ton temps ? ».
 */

export interface SteamGameTotals {
  appid: number;
  name: string;
  forever: number;
  recent: number;
}

export interface GameSnapshot {
  day: string;
  /** Minutes depuis toujours, par jeu (clé `s:<appid>`). */
  totals: Record<string, number>;
  /** Minutes des deux dernières semaines (Steam), par jeu. */
  recent: Record<string, number>;
}

export interface ManualPlay {
  id: string;
  game: string;
  day: string;
  minutes: number;
}

export interface GamesData {
  v: 1;
  at: number;
  steamProfile: string | null;
  names: Record<string, string>;
  snapshots: GameSnapshot[];
  manual: ManualPlay[];
}

export const emptyGames = (): GamesData => ({ v: 1, at: 0, steamProfile: null, names: {}, snapshots: [], manual: [] });

const DAY = 86_400_000;
const ms = (d: string) => Date.parse(`${d}T12:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
export const manualKey = (game: string) => `m:${game.trim().toLowerCase()}`;

export function parseGames(raw: unknown): GamesData | null {
  if (!raw || typeof raw !== 'object') return null;
  const g = raw as Partial<GamesData>;
  if (g.v !== 1 || typeof g.at !== 'number' || !Array.isArray(g.snapshots) || !Array.isArray(g.manual) || !g.names || typeof g.names !== 'object') return null;
  return { v: 1, at: g.at, steamProfile: typeof g.steamProfile === 'string' ? g.steamProfile : null, names: g.names, snapshots: g.snapshots, manual: g.manual };
}

/** Une nouvelle photo Steam (une par jour : celle du jour est remplacée). 180 photos gardées. */
export function addSnapshot(data: GamesData, day: string, games: readonly SteamGameTotals[], profile: string, at = Date.now()): GamesData {
  const names = { ...data.names };
  const totals: Record<string, number> = {};
  const recent: Record<string, number> = {};
  for (const g of games) {
    const k = `s:${g.appid}`;
    names[k] = g.name;
    totals[k] = g.forever;
    if (g.recent > 0) recent[k] = g.recent;
  }
  const snapshots = [...data.snapshots.filter((s) => s.day !== day), { day, totals, recent }].sort((a, b) => (a.day < b.day ? -1 : 1)).slice(-180);
  return { ...data, at, steamProfile: profile, names, snapshots };
}

export function addManual(data: GamesData, play: ManualPlay, at = Date.now()): GamesData {
  const k = manualKey(play.game);
  return { ...data, at, names: { ...data.names, [k]: data.names[k] ?? play.game.trim() }, manual: [...data.manual, play].slice(-2000) };
}

export function removeManual(data: GamesData, id: string, at = Date.now()): GamesData {
  return { ...data, at, manual: data.manual.filter((m) => m.id !== id) };
}

/** Répartit `minutes` sur les jours ]from, to] (to compris), semaine par semaine. */
function spread(into: Record<string, Record<string, number>>, key: string, minutes: number, fromDay: string, toDay: string) {
  const days = Math.max(1, Math.round((ms(toDay) - ms(fromDay)) / DAY));
  for (let i = 1; i <= days; i++) {
    const w = weekStart(iso(ms(fromDay) + i * DAY));
    const row = (into[w] ??= {});
    row[key] = (row[key] ?? 0) + minutes / days;
  }
}

/** Minutes de jeu par semaine et par jeu (photos Steam successives + saisies à la main). */
export function gameWeeks(data: GamesData): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  const snaps = data.snapshots;
  if (snaps[0]) {
    // Avant la première photo : ses « deux dernières semaines ».
    for (const [k, m] of Object.entries(snaps[0].recent)) spread(out, k, m, iso(ms(snaps[0].day) - 14 * DAY), snaps[0].day);
  }
  for (let i = 1; i < snaps.length; i++) {
    const a = snaps[i - 1]!;
    const b = snaps[i]!;
    for (const [k, total] of Object.entries(b.totals)) {
      const delta = total - (a.totals[k] ?? total - (b.recent[k] ?? 0));
      if (delta > 0) spread(out, k, delta, a.day, b.day);
    }
  }
  for (const m of data.manual) {
    const row = (out[weekStart(m.day)] ??= {});
    const k = manualKey(m.game);
    row[k] = (row[k] ?? 0) + m.minutes;
  }
  for (const row of Object.values(out)) for (const k of Object.keys(row)) row[k] = Math.round(row[k]!);
  return out;
}

export interface GameTotal {
  key: string;
  name: string;
  /** Depuis toujours (Steam) + saisies. */
  total: number;
  /** Sur la période demandée. */
  period: number;
}

/** Les jeux, triés par temps sur la période (puis depuis toujours). */
export function gameTotals(data: GamesData, from: string, to: string): GameTotal[] {
  const weeks = gameWeeks(data);
  const last = data.snapshots[data.snapshots.length - 1];
  const keys = new Set([...Object.keys(last?.totals ?? {}), ...data.manual.map((m) => manualKey(m.game))]);
  const out: GameTotal[] = [];
  for (const k of keys) {
    let period = 0;
    for (const [w, row] of Object.entries(weeks)) if (w >= weekStart(from) && w <= weekStart(to)) period += row[k] ?? 0;
    const manual = data.manual.filter((m) => manualKey(m.game) === k).reduce((n, m) => n + m.minutes, 0);
    out.push({ key: k, name: data.names[k] ?? k, total: (last?.totals[k] ?? 0) + manual, period });
  }
  return out.sort((a, b) => b.period - a.period || b.total - a.total);
}

// ---------------------------------------------------------------- Où va ton temps ?

export interface TimeSplit {
  sport: number;
  music: number;
  games: number;
  /** Jours de sortie (festival, week-end) sur la période. */
  outings: number;
}

/** Minutes par activité sur les semaines [from, to] (lundis). */
export function timeSplit(stats: StatsByApp, games: GamesData | null, from: string, to: string, outingDays = 0): TimeSplit {
  const inRange = (w: string) => w >= from && w <= to;
  const sum = (weeks: Record<string, Record<string, number>> | undefined, key: string) =>
    Object.entries(weeks ?? {})
      .filter(([w]) => inRange(w))
      .reduce((n, [, c]) => n + (c[key] ?? 0), 0);
  const g = games ? gameWeeks(games) : {};
  const gamesMin = Object.entries(g)
    .filter(([w]) => inRange(w))
    .reduce((n, [, row]) => n + Object.values(row).reduce((a, b) => a + b, 0), 0);
  return { sport: Math.round(sum(stats.perf?.weeks, 'minutes')), music: Math.round(sum(stats.music?.weeks, 'minutes')), games: Math.round(gamesMin), outings: outingDays };
}
