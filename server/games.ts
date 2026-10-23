import { HttpError, verifyToken, type Db } from './core.js';

/**
 * Relais Steam (POST /api/games) pour MyGames. L'API de Steam exige une clé de développeur et refuse les
 * appels venus d'un navigateur : le serveur relaie, avec sa clé (variable STEAM_API_KEY), et ne garde
 * RIEN (ni l'identifiant Steam, ni la liste des jeux) : la réponse part telle quelle vers l'appareil, qui
 * la résume et la chiffre. Seuls des profils publics sont lisibles (réglage « Détails des jeux : public »).
 */

const STEAM = 'https://api.steampowered.com';
const RATE = { max: 30, windowMs: 60 * 60_000 };
const STEAM_ID = /^\d{17}$/;
const VANITY = /^[A-Za-z0-9_-]{2,32}$/;

export type FetchJson = (url: string) => Promise<unknown>;

const defaultFetch: FetchJson = async (url) => {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new HttpError(502, 'Steam ne répond pas : réessaie plus tard.');
  return res.json();
};

async function limited(db: Db, uid: string, now: number): Promise<void> {
  await db.query(`CREATE TABLE IF NOT EXISTS games_rate (k TEXT PRIMARY KEY, win BIGINT NOT NULL, n INTEGER NOT NULL)`);
  const win = Math.floor(now / RATE.windowMs);
  const { rows } = await db.query<{ n: number }>(
    `INSERT INTO games_rate (k, win, n) VALUES ($1, $2, 1)
     ON CONFLICT (k) DO UPDATE SET n = CASE WHEN games_rate.win = EXCLUDED.win THEN games_rate.n + 1 ELSE 1 END, win = EXCLUDED.win RETURNING n`,
    [uid, win],
  );
  if (Number(rows[0]?.n ?? 0) > RATE.max) throw new HttpError(429, 'Trop de mises à jour Steam : réessaie dans une heure.');
}

export interface SteamGame {
  appid: number;
  name: string;
  /** Minutes jouées depuis toujours, et sur les deux dernières semaines. */
  forever: number;
  recent: number;
}

/** Identifiant Steam à 17 chiffres, depuis un identifiant, un nom de profil personnalisé ou une adresse de profil. */
async function resolveId(input: string, key: string, get: FetchJson): Promise<string> {
  const text = input.trim();
  const fromUrl = /steamcommunity\.com\/(profiles|id)\/([^/?#]+)/i.exec(text);
  const value = fromUrl ? fromUrl[2]! : text;
  if (STEAM_ID.test(value)) return value;
  if (!VANITY.test(value)) throw new HttpError(400, 'Profil Steam introuvable : colle l’adresse de ton profil (steamcommunity.com/…).');
  const r = (await get(`${STEAM}/ISteamUser/ResolveVanityURL/v1/?key=${encodeURIComponent(key)}&vanityurl=${encodeURIComponent(value)}`)) as { response?: { success?: number; steamid?: string } };
  if (r.response?.success !== 1 || !r.response.steamid || !STEAM_ID.test(r.response.steamid)) throw new HttpError(404, 'Profil Steam introuvable : vérifie le nom ou colle l’adresse de ton profil.');
  return r.response.steamid;
}

export async function steamGames(db: Db, uid: string, body: Record<string, unknown>, env: { steamKey: string }, get: FetchJson = defaultFetch, now = Date.now()): Promise<{ steamId: string; games: SteamGame[] }> {
  if (!env.steamKey) throw new HttpError(503, 'La connexion à Steam n’est pas encore activée sur ce serveur : ajoute tes jeux à la main en attendant.');
  await limited(db, uid, now);
  const profile = typeof body.profile === 'string' ? body.profile : '';
  if (!profile) throw new HttpError(400, 'Profil Steam manquant.');
  const steamId = await resolveId(profile, env.steamKey, get);
  const r = (await get(`${STEAM}/IPlayerService/GetOwnedGames/v1/?key=${encodeURIComponent(env.steamKey)}&steamid=${steamId}&include_appinfo=1&include_played_free_games=1&format=json`)) as {
    response?: { games?: { appid?: number; name?: string; playtime_forever?: number; playtime_2weeks?: number }[] };
  };
  const list = r.response?.games;
  // Profil privé : Steam répond sans liste.
  if (!Array.isArray(list)) throw new HttpError(403, 'Ton profil Steam est privé : dans Steam, Profil → Confidentialité → « Détails des jeux : Public ».');
  const games = list
    .filter((g) => typeof g.appid === 'number' && typeof g.name === 'string')
    .map((g) => ({ appid: g.appid!, name: g.name!.slice(0, 120), forever: Math.max(0, Math.round(g.playtime_forever ?? 0)), recent: Math.max(0, Math.round(g.playtime_2weeks ?? 0)) }))
    .filter((g) => g.forever > 0)
    .sort((a, b) => b.forever - a.forever)
    .slice(0, 500);
  return { steamId, games };
}

export async function gamesDispatch(db: Db, env: { secret: string; steamKey: string }, auth: string | undefined, body: Record<string, unknown>, get?: FetchJson): Promise<unknown> {
  const uid = verifyToken(auth, env.secret);
  if (!uid) throw new HttpError(401, 'Session expirée : reconnecte-toi.');
  if (body.action !== 'steam') throw new HttpError(400, 'Action inconnue');
  return steamGames(db, uid, body, env, get);
}
