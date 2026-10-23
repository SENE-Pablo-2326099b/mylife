import { addWeeks, weekStart, type AppStats } from './character';

/**
 * MyMusique : tes stats d'écoute à partir de l'export de données Spotify (l'API de Spotify est fermée aux
 * nouvelles apps). Le fichier est lu sur l'appareil ; seul un résumé est gardé (artistes, titres, durées
 * par mois, profil horaire, jours d'écoute), jamais le reste de l'export (adresse IP, pays, appareils…).
 *
 * Formats lus :
 * - historique étendu (« Extended streaming history ») : `ts`, `ms_played`, `master_metadata_track_name`,
 *   `master_metadata_album_artist_name` (les podcasts, sans titre de morceau, sont ignorés) ;
 * - données de compte (un an) : `endTime`, `msPlayed`, `trackName`, `artistName`.
 * Comme Spotify, une écoute compte à partir de 30 secondes.
 */

export interface Play {
  /** Heure de fin d'écoute (ms). */
  at: number;
  ms: number;
  track: string;
  artist: string;
}

export const MIN_PLAY_MS = 30_000;

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

function parseEntry(e: unknown): Play | null {
  if (!e || typeof e !== 'object') return null;
  const o = e as Record<string, unknown>;
  if ('ms_played' in o) {
    const track = str(o.master_metadata_track_name);
    const artist = str(o.master_metadata_album_artist_name);
    const at = typeof o.ts === 'string' ? Date.parse(o.ts) : NaN;
    const ms = typeof o.ms_played === 'number' ? o.ms_played : 0;
    return track && artist && Number.isFinite(at) && ms >= MIN_PLAY_MS ? { at, ms, track, artist } : null;
  }
  if ('msPlayed' in o) {
    const track = str(o.trackName);
    const artist = str(o.artistName);
    // « 2024-03-01 18:42 », en UTC.
    const at = typeof o.endTime === 'string' ? Date.parse(`${o.endTime.replace(' ', 'T')}:00Z`) : NaN;
    const ms = typeof o.msPlayed === 'number' ? o.msPlayed : 0;
    return track && artist && Number.isFinite(at) && ms >= MIN_PLAY_MS ? { at, ms, track, artist } : null;
  }
  return null;
}

/** Les écoutes d'un fichier de l'export (un tableau JSON) ; un fichier d'un autre type donne une liste vide. */
export function parseSpotifyFile(json: unknown): Play[] {
  if (!Array.isArray(json)) return [];
  const out: Play[] = [];
  for (const e of json) {
    const p = parseEntry(e);
    if (p) out.push(p);
  }
  return out;
}

export interface MonthMusic {
  minutes: number;
  plays: number;
  /** Artistes découverts ce mois-ci (jamais écoutés avant dans l'historique). */
  newArtists: number;
  /** Les 15 premiers : [artiste, minutes]. */
  artists: [string, number][];
  /** Les 15 premiers : [titre, artiste, minutes, écoutes]. */
  tracks: [string, string, number, number][];
}

export interface MusicSummary {
  v: 1;
  /** Date du résumé (ms) : le plus récent gagne d'un appareil à l'autre. */
  at: number;
  from: string;
  to: string;
  totalMinutes: number;
  artistsCount: number;
  months: Record<string, MonthMusic>;
  /** Minutes par heure de la journée (0–23, heure locale) et par jour (lundi d'abord). */
  hours: number[];
  weekdays: number[];
  /** Jours avec au moins une écoute, les 400 derniers (pour les séries). */
  days: string[];
}

const pad = (n: number) => String(n).padStart(2, '0');
const localDay = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

function top<K>(map: Map<K, number>, n: number): [K, number][] {
  return [...map].sort((a, b) => b[1] - a[1]).slice(0, n);
}

/**
 * Le résumé d'un historique, et les compteurs hebdomadaires du Personnage (stat Culture : `minutes`,
 * `discoveries`). Les doublons (mêmes fichiers importés deux fois) sont écartés.
 */
export function summarizeMusic(plays: readonly Play[], at = Date.now()): { summary: MusicSummary; weeks: AppStats['weeks'] } {
  const seen = new Set<string>();
  const list = [...plays]
    .filter((p) => {
      const k = `${p.at}|${p.track}|${p.artist}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.at - b.at);
  const months: Record<string, { minutes: number; plays: number; newArtists: number; artists: Map<string, number>; tracks: Map<string, { t: string; a: string; m: number; n: number }> }> = {};
  const hours = Array.from({ length: 24 }, () => 0);
  const weekdays = Array.from({ length: 7 }, () => 0);
  const known = new Set<string>();
  const days = new Set<string>();
  const weeks: AppStats['weeks'] = {};
  let total = 0;
  // Le tout début de l'historique « découvre » tout : ce n'en sont pas vraiment, le premier mois ne compte pas.
  const firstMonth = list[0] ? localDay(list[0].at).slice(0, 7) : null;
  for (const p of list) {
    const day = localDay(p.at);
    const month = day.slice(0, 7);
    const m = (months[month] ??= { minutes: 0, plays: 0, newArtists: 0, artists: new Map(), tracks: new Map() });
    const min = p.ms / 60_000;
    m.minutes += min;
    m.plays += 1;
    m.artists.set(p.artist, (m.artists.get(p.artist) ?? 0) + min);
    const tk = `${p.track}\u0001${p.artist}`;
    const t = m.tracks.get(tk) ?? { t: p.track, a: p.artist, m: 0, n: 0 };
    t.m += min;
    t.n += 1;
    m.tracks.set(tk, t);
    const d = new Date(p.at);
    hours[d.getHours()]! += min;
    weekdays[(d.getDay() + 6) % 7]! += min;
    days.add(day);
    total += min;
    const w = (weeks[weekStart(day)] ??= {});
    w.minutes = (w.minutes ?? 0) + min;
    if (!known.has(p.artist)) {
      known.add(p.artist);
      if (month !== firstMonth) {
        m.newArtists += 1;
        w.discoveries = (w.discoveries ?? 0) + 1;
      }
    }
  }
  for (const w of Object.values(weeks)) w.minutes = Math.round(w.minutes ?? 0);
  const round = (n: number) => Math.round(n);
  const sortedDays = [...days].sort();
  return {
    summary: {
      v: 1,
      at,
      from: sortedDays[0] ?? '',
      to: sortedDays[sortedDays.length - 1] ?? '',
      totalMinutes: round(total),
      artistsCount: known.size,
      months: Object.fromEntries(
        Object.entries(months).map(([k, m]) => [
          k,
          {
            minutes: round(m.minutes),
            plays: m.plays,
            newArtists: m.newArtists,
            artists: top(m.artists, 15).map(([a, v]) => [a, round(v)] as [string, number]),
            tracks: [...m.tracks.values()]
              .sort((a, b) => b.m - a.m)
              .slice(0, 15)
              .map((t) => [t.t, t.a, round(t.m), t.n] as [string, string, number, number]),
          },
        ]),
      ),
      hours: hours.map(round),
      weekdays: weekdays.map(round),
      days: sortedDays.slice(-400),
    },
    weeks,
  };
}

/** Lecture prudente d'un résumé (venu d'un autre appareil). */
export function parseMusicSummary(raw: unknown): MusicSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<MusicSummary>;
  if (s.v !== 1 || typeof s.at !== 'number' || !s.months || typeof s.months !== 'object' || !Array.isArray(s.hours) || s.hours.length !== 24 || !Array.isArray(s.weekdays) || !Array.isArray(s.days)) return null;
  return s as MusicSummary;
}

// ---------------------------------------------------------------- lectures

export interface Period {
  minutes: number;
  plays: number;
  newArtists: number;
  artists: [string, number][];
  tracks: [string, string, number, number][];
}

/** Un mois (`AAAA-MM`) ou une année (`AAAA`) : les tops des mois fusionnés (approchés au-delà du top 15 mensuel). */
export function musicPeriod(s: MusicSummary, period: string): Period {
  const months = Object.entries(s.months).filter(([k]) => k.startsWith(period));
  const artists = new Map<string, number>();
  const tracks = new Map<string, [string, string, number, number]>();
  let minutes = 0;
  let plays = 0;
  let newArtists = 0;
  for (const [, m] of months) {
    minutes += m.minutes;
    plays += m.plays;
    newArtists += m.newArtists;
    for (const [a, v] of m.artists) artists.set(a, (artists.get(a) ?? 0) + v);
    for (const [t, a, v, n] of m.tracks) {
      const k = `${t}\u0001${a}`;
      const prev = tracks.get(k);
      tracks.set(k, prev ? [t, a, prev[2] + v, prev[3] + n] : [t, a, v, n]);
    }
  }
  return {
    minutes,
    plays,
    newArtists,
    artists: top(artists, 10),
    tracks: [...tracks.values()].sort((a, b) => b[2] - a[2]).slice(0, 10),
  };
}

/** Jours d'écoute consécutifs jusqu'à `today` (ou la veille), et la plus longue série connue. */
export function listeningStreak(days: readonly string[], today: string): { current: number; best: number } {
  const set = new Set(days);
  const prev = (d: string) => new Date(Date.parse(`${d}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  let current = 0;
  let d = set.has(today) ? today : prev(today);
  while (set.has(d)) {
    current += 1;
    d = prev(d);
  }
  let best = 0;
  let run = 0;
  let last = '';
  for (const day of [...set].sort()) {
    run = last && prev(day) === last ? run + 1 : 1;
    best = Math.max(best, run);
    last = day;
  }
  return { current, best };
}

/** L'heure où tu écoutes le plus (0–23), ou null sans données. */
export function peakHour(s: MusicSummary): number | null {
  const max = Math.max(...s.hours);
  return max > 0 ? s.hours.indexOf(max) : null;
}

/** Le dernier mois couvert par l'historique (l'export peut dater de quelques jours ou semaines). */
export const lastMonth = (s: MusicSummary): string | null => Object.keys(s.months).sort().pop() ?? null;

/** Semaines vides retirées ; deux ans gardés. */
export function trimMusicWeeks(weeks: AppStats['weeks'], today: string): AppStats['weeks'] {
  const from = addWeeks(weekStart(today), -103);
  return Object.fromEntries(Object.entries(weeks).filter(([w, c]) => w >= from && Object.values(c).some((v) => v > 0)));
}
