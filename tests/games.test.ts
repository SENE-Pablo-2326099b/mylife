import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import * as core from '../server/core';
import { steamGames } from '../server/games';
import { addManual, addSnapshot, emptyGames, gameTotals, gameWeeks, parseGames, removeManual, timeSplit } from '../packages/lumen/src/games';

describe('MyGames', () => {
  const g = (appid: number, name: string, forever: number, recent = 0) => ({ appid, name, forever, recent });

  it('première photo : ses deux dernières semaines ; ensuite, la différence entre deux photos, répartie par jour', () => {
    let d = addSnapshot(emptyGames(), '2026-10-19', [g(1, 'Jeu A', 1000, 140), g(2, 'Jeu B', 300)], 'moi', 1);
    // 140 min sur les 14 jours jusqu'au 19/10 (du 6 au 19) : 10 min par jour.
    expect(gameWeeks(d)).toEqual({ '2026-10-05': { 's:1': 60 }, '2026-10-12': { 's:1': 70 }, '2026-10-19': { 's:1': 10 } });
    d = addSnapshot(d, '2026-10-26', [g(1, 'Jeu A', 1420), g(2, 'Jeu B', 300), g(3, 'Nouveau', 60, 60)], 'moi', 2);
    const w = gameWeeks(d);
    // 420 min du 20 au 26 (60 par jour) ; le jeu acheté entre-temps compte ses minutes récentes, réparties pareil.
    expect(w['2026-10-19']).toEqual({ 's:1': 370, 's:3': 51 });
    expect(w['2026-10-26']).toEqual({ 's:1': 60, 's:3': 9 });
    expect(Object.keys(d.names)).toEqual(['s:1', 's:2', 's:3']);
  });

  it('une photo par jour (remplacée), saisies à la main, totaux par jeu', () => {
    let d = addSnapshot(emptyGames(), '2026-10-19', [g(1, 'Jeu A', 100)], 'moi');
    d = addSnapshot(d, '2026-10-19', [g(1, 'Jeu A', 160)], 'moi');
    expect(d.snapshots).toHaveLength(1);
    d = addManual(d, { id: 'x', game: 'Mario Kart', day: '2026-10-20', minutes: 45 });
    d = addManual(d, { id: 'y', game: 'mario kart ', day: '2026-10-21', minutes: 30 });
    const totals = gameTotals(d, '2026-10-19', '2026-10-25');
    expect(totals[0]).toMatchObject({ name: 'Mario Kart', period: 75, total: 75 });
    expect(totals[1]).toMatchObject({ name: 'Jeu A', total: 160 });
    expect(gameWeeks(removeManual(d, 'x'))['2026-10-19']).toEqual({ 'm:mario kart': 30 });
    expect(parseGames(JSON.parse(JSON.stringify(d)))).not.toBeNull();
    expect(parseGames({ v: 2 })).toBeNull();
  });

  it('Où va ton temps : sport (MyPerf), musique (MyMusique), jeu, sur la période', () => {
    const stats = { perf: { v: 1 as const, at: 1, weeks: { '2026-10-19': { sessions: 3, minutes: 210 }, '2026-10-12': { minutes: 60 } } }, music: { v: 1 as const, at: 1, weeks: { '2026-10-19': { minutes: 500 } } } };
    const d = addManual(emptyGames(), { id: 'x', game: 'FIFA', day: '2026-10-20', minutes: 120 });
    expect(timeSplit(stats, d, '2026-10-19', '2026-10-19', 2)).toEqual({ sport: 210, music: 500, games: 120, outings: 2 });
  });
});

describe('relais Steam', () => {
  const db = async () => {
    const p = new PGlite();
    await core.ensureSchema(p as unknown as core.Db);
    return p as unknown as core.Db;
  };
  const fake = (responses: Record<string, unknown>) => async (url: string) => {
    const hit = Object.keys(responses).find((k) => url.includes(k));
    return hit ? responses[hit] : {};
  };

  it('sans clé : message clair ; profil public : jeux joués, triés ; nom de profil et adresse résolus', async () => {
    const d = await db();
    await expect(steamGames(d, 'u1', { profile: 'x' }, { steamKey: '' })).rejects.toMatchObject({ status: 503 });
    const get = fake({
      ResolveVanityURL: { response: { success: 1, steamid: '76561198000000001' } },
      GetOwnedGames: { response: { games: [{ appid: 10, name: 'Peu', playtime_forever: 5 }, { appid: 20, name: 'Beaucoup', playtime_forever: 900, playtime_2weeks: 60 }, { appid: 30, name: 'Jamais', playtime_forever: 0 }] } },
    });
    const r = await steamGames(d, 'u1', { profile: 'https://steamcommunity.com/id/monpseudo/' }, { steamKey: 'k' }, get);
    expect(r.steamId).toBe('76561198000000001');
    expect(r.games.map((x) => x.name)).toEqual(['Beaucoup', 'Peu']);
    expect(r.games[0]).toEqual({ appid: 20, name: 'Beaucoup', forever: 900, recent: 60 });
  }, 30_000);

  it('profil privé ou introuvable : explications ; trop de demandes freinées', async () => {
    const d = await db();
    await expect(steamGames(d, 'u2', { profile: '76561198000000001' }, { steamKey: 'k' }, fake({ GetOwnedGames: { response: {} } }))).rejects.toMatchObject({ status: 403 });
    await expect(steamGames(d, 'u2', { profile: 'inconnu' }, { steamKey: 'k' }, fake({ ResolveVanityURL: { response: { success: 42 } } }))).rejects.toMatchObject({ status: 404 });
    const ok = fake({ GetOwnedGames: { response: { games: [] } } });
    for (let i = 0; i < 30; i++) await steamGames(d, 'u3', { profile: '76561198000000001' }, { steamKey: 'k' }, ok);
    await expect(steamGames(d, 'u3', { profile: '76561198000000001' }, { steamKey: 'k' }, ok)).rejects.toMatchObject({ status: 429 });
  }, 30_000);
});
