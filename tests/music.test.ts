import { describe, expect, it } from 'vitest';
import { listeningStreak, musicPeriod, parseMusicSummary, parseSpotifyFile, peakHour, summarizeMusic } from '../packages/lumen/src/music';

const ext = (ts: string, ms: number, track: string | null, artist: string | null, extra: Record<string, unknown> = {}) => ({
  ts,
  ms_played: ms,
  master_metadata_track_name: track,
  master_metadata_album_artist_name: artist,
  ip_addr: '203.0.113.5',
  conn_country: 'FR',
  platform: 'android',
  ...extra,
});

describe('MyMusique', () => {
  it('lit l’historique étendu et les données de compte ; ignore podcasts, écoutes < 30 s et autres fichiers', () => {
    const plays = parseSpotifyFile([
      ext('2026-09-01T20:00:00Z', 180_000, 'Track A', 'Artist 1'),
      ext('2026-09-01T20:05:00Z', 12_000, 'Skipped', 'Artist 1'),
      ext('2026-09-01T21:00:00Z', 1_800_000, null, null, { episode_name: 'Un podcast' }),
    ]);
    expect(plays).toEqual([{ at: Date.parse('2026-09-01T20:00:00Z'), ms: 180_000, track: 'Track A', artist: 'Artist 1' }]);
    expect(parseSpotifyFile([{ endTime: '2026-09-02 08:30', msPlayed: 200_000, trackName: 'B', artistName: 'Artist 2' }])).toHaveLength(1);
    expect(parseSpotifyFile({ userdata: true })).toEqual([]);
    expect(parseSpotifyFile([{ foo: 1 }])).toEqual([]);
  });

  it('résumé : minutes, tops, découvertes (pas le premier mois), doublons écartés, rien de l’export au-delà', () => {
    const file = [
      ext('2026-08-10T20:00:00Z', 600_000, 'Old', 'Artist 1'),
      ext('2026-09-01T20:00:00Z', 300_000, 'Track A', 'Artist 1'),
      ext('2026-09-02T20:00:00Z', 300_000, 'Track A', 'Artist 1'),
      ext('2026-09-03T20:00:00Z', 120_000, 'New one', 'Artist 2'),
    ];
    const plays = [...parseSpotifyFile(file), ...parseSpotifyFile(file)];
    const { summary, weeks } = summarizeMusic(plays, 5);
    expect(summary.totalMinutes).toBe(22);
    expect(summary.artistsCount).toBe(2);
    expect(summary.months['2026-08']?.newArtists).toBe(0);
    expect(summary.months['2026-09']).toMatchObject({ minutes: 12, plays: 3, newArtists: 1, artists: [['Artist 1', 10], ['Artist 2', 2]] });
    expect(summary.months['2026-09']?.tracks[0]).toEqual(['Track A', 'Artist 1', 10, 2]);
    expect(Object.values(weeks).reduce((n, w) => n + (w.discoveries ?? 0), 0)).toBe(1);
    const json = JSON.stringify(summary);
    expect(json).not.toMatch(/203\.0\.113|android|FR"/);
    expect(parseMusicSummary(JSON.parse(json))).not.toBeNull();
    expect(parseMusicSummary({ v: 1 })).toBeNull();
  });

  it('périodes, heure de pointe, séries de jours', () => {
    const { summary } = summarizeMusic(parseSpotifyFile([ext('2026-09-01T18:00:00Z', 600_000, 'A', 'X'), ext('2026-10-01T18:00:00Z', 300_000, 'B', 'Y')]));
    expect(musicPeriod(summary, '2026')).toMatchObject({ minutes: 15, plays: 2 });
    expect(musicPeriod(summary, '2026-10').artists).toEqual([['Y', 5]]);
    expect(peakHour(summary)).not.toBeNull();
    expect(listeningStreak(['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-10'], '2026-10-22')).toEqual({ current: 3, best: 3 });
    expect(listeningStreak(['2026-10-20', '2026-10-21'], '2026-10-22')).toEqual({ current: 2, best: 2 });
  });
});
