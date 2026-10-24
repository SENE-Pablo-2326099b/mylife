import { loadState, syncNow, type LocalStore, type SyncState } from '../vendor/mylife-sync';
import { currentSession, onSessionChange, webPlatform } from '../vendor/mylife-sync/web';
import { STATS_APPS, parseAppearance, readStats, type StatsApp } from '../vendor/lumen';
import { getAppearance, setAppearance, subscribeAppearance } from './appearance';
import { syncMiniApps, quiet } from './miniSync';
import { adoptCharacterPrefs, adoptGames, adoptLegacyMiniApp, adoptMusic, adoptStats, onStatsChange, readCharacterPrefs, readGames, readMiniLegacy, readMusic, writeMiniLegacy } from './stats';
import { clearSyncIssue, noteSyncIssue } from './syncIssue';

/**
 * Réglages communs de MyLife synchronisés entre appareils par le compte, chiffrés comme le reste (app
 * `mylife` du serveur) : l'apparence (`prefs/appearance`), les compteurs du Personnage de chaque app
 * (`stats/<app>`), ses préférences (`prefs/character`) et le résumé d'écoute de MyMusique (`music/summary`) et
 * les heures de jeu de MyGames (`games/data`). « Mes apps » a sa propre synchro (miniSync.ts) ; les lignes
 * `miniapp/<id>` de l'ancien format (une app et toutes ses saisies) sont seulement reprises puis effacées.
 * Chaque ligne est datée, la plus récente gagne :
 * changer de thème sur le PC le change sur le téléphone. Lancé par chaque app web ; l'app Android fait
 * de même de son côté.
 */
const STATE_KEY = 'mylife-sync-mylife';
const PUSHED_KEY = 'mylife-prefs-pushed';
const statsPushedKey = (app: StatsApp) => `mylife:stats-pushed:${app}`;
const CHARACTER_PUSHED_KEY = 'mylife:character-pushed';
const MUSIC_PUSHED_KEY = 'mylife:music-pushed';
const GAMES_PUSHED_KEY = 'mylife:games-pushed';
const isStatsApp = (rid: string): rid is StatsApp => (STATS_APPS as readonly string[]).includes(rid);

const readNum = (k: string) => {
  try {
    return Number(localStorage.getItem(k) ?? 0) || 0;
  } catch {
    return 0;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* stockage indisponible */
  }
};

/** Toutes les lignes communes de cet appareil, avec leur date. */
function rows(): { tbl: string; rid: string; at: number; pushedKey: string; row: unknown }[] {
  const out: { tbl: string; rid: string; at: number; pushedKey: string; row: unknown }[] = [];
  const a = getAppearance();
  out.push({ tbl: 'prefs', rid: 'appearance', at: a.at, pushedKey: PUSHED_KEY, row: a });
  for (const app of STATS_APPS) {
    const st = readStats(app);
    if (st) out.push({ tbl: 'stats', rid: app, at: st.at, pushedKey: statsPushedKey(app), row: st });
  }
  const c = readCharacterPrefs();
  if (c.at > 0) out.push({ tbl: 'prefs', rid: 'character', at: c.at, pushedKey: CHARACTER_PUSHED_KEY, row: c });
  const music = readMusic();
  if (music) out.push({ tbl: 'music', rid: 'summary', at: music.at, pushedKey: MUSIC_PUSHED_KEY, row: music });
  const games = readGames();
  if (games && games.at > 0) out.push({ tbl: 'games', rid: 'data', at: games.at, pushedKey: GAMES_PUSHED_KEY, row: games });
  return out;
}

/** Les réglages communs comme des lignes datées ; une ligne jamais choisie (at = 0) n'est jamais envoyée. */
export const prefsStore: LocalStore = {
  app: 'mylife',
  async pending() {
    const out = rows()
      .filter((r) => r.at > readNum(r.pushedKey))
      .map((r) => ({ tbl: r.tbl, rid: r.rid, ver: r.at, updatedAt: r.at, row: r.row as unknown }));
    // Anciennes lignes de « Mes apps », reprises par la nouvelle synchro : effacées du compte.
    for (const [rid, at] of Object.entries(readMiniLegacy()).slice(0, 100)) out.push({ tbl: 'miniapp', rid, ver: at, updatedAt: at, row: null });
    return out;
  },
  async ack(done) {
    const keys = new Map(rows().map((r) => [`${r.tbl}/${r.rid}`, r.pushedKey]));
    const legacy = readMiniLegacy();
    let cleaned = false;
    for (const d of done) {
      if (d.tbl === 'miniapp') {
        if (legacy[d.rid] === d.ver) {
          delete legacy[d.rid];
          cleaned = true;
        }
        continue;
      }
      const key = keys.get(`${d.tbl}/${d.rid}`);
      if (key) write(key, String(d.ver));
    }
    if (cleaned) writeMiniLegacy(legacy);
  },
  async apply(remote) {
    for (const r of remote) {
      if (r.deleted) continue;
      if (r.tbl === 'prefs' && r.rid === 'appearance') {
        const a = parseAppearance(r.row);
        // Venu d'un autre appareil : gardé avec sa date (pas renvoyé comme un nouveau choix).
        if (a && a.at > getAppearance().at) {
          setAppearance(a);
          write(PUSHED_KEY, String(a.at));
        }
      } else if (r.tbl === 'stats' && isStatsApp(r.rid)) {
        if (adoptStats(r.rid, r.row)) write(statsPushedKey(r.rid), String(readStats(r.rid)?.at ?? 0));
      } else if (r.tbl === 'prefs' && r.rid === 'character') {
        if (adoptCharacterPrefs(r.row)) write(CHARACTER_PUSHED_KEY, String(readCharacterPrefs().at));
      } else if (r.tbl === 'music' && r.rid === 'summary') {
        if (adoptMusic(r.row)) write(MUSIC_PUSHED_KEY, String(readMusic()?.at ?? 0));
      } else if (r.tbl === 'games' && r.rid === 'data') {
        if (adoptGames(r.row)) write(GAMES_PUSHED_KEY, String(readGames()?.at ?? 0));
      } else if (r.tbl === 'miniapp') {
        // Un appareil pas encore à jour : ses saisies rejoignent la nouvelle synchro.
        adoptLegacyMiniApp(r.row);
      }
    }
  },
  async snapshot() {
    return rows().map((r) => ({ tbl: r.tbl, rid: r.rid, row: r.row }));
  },
  async replace(remote) {
    await this.apply(remote);
  },
  async clearPending() {
    for (const r of rows()) write(r.pushedKey, String(r.at));
  },
  async getState() {
    try {
      return JSON.parse(localStorage.getItem(STATE_KEY) ?? 'null') as SyncState | null;
    } catch {
      return null;
    }
  },
  async setState(s) {
    write(STATE_KEY, JSON.stringify(s));
  },
  async tooBig(list) {
    noteSyncIssue('mylife', `${list.length} réglage${list.length > 1 ? 's' : ''} trop gros pour le compte (${list.map((r) => r.tbl).join(', ')})`);
  },
};

let running = false;
let again = false;

/**
 * Un passage. Pas de « reliure » comme pour les données des apps : une seule ligne, datée du choix de
 * l'utilisateur (`at`), et le serveur garde la plus récente. Un thème jamais choisi (at = 0) n'est
 * jamais envoyé : un appareil neuf ne peut pas écraser le choix fait ailleurs.
 */
export async function syncPrefs(): Promise<void> {
  const session = currentSession();
  if (!session || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    clearSyncIssue('mylife');
    const state = await loadState(prefsStore, webPlatform.random);
    if (state.joinedAs !== session.login) {
      // Nouveau compte sur cet appareil : tout relire depuis le début, et proposer le choix local.
      await prefsStore.setState({ ...state, joinedAs: session.login, cursor: 0 });
      for (const r of rows()) write(r.pushedKey, '0');
    }
    await syncNow(prefsStore, webPlatform.api, session, webPlatform.random);
  } catch (e) {
    // Hors ligne, session expirée : on réessaiera au prochain passage. Un refus du serveur se montre (page Compte).
    if (!quiet(e)) noteSyncIssue('mylife', (e as Error).message);
  } finally {
    running = false;
    if (again) {
      again = false;
      void syncPrefs();
    }
  }
}

/** Réglages communs puis « Mes apps ». */
async function syncAll(): Promise<void> {
  await syncPrefs();
  await syncMiniApps();
}

let started = false;

/** Au lancement, à la connexion, à chaque changement d'apparence, au retour sur l'app. */
export function startPrefsSync(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const soon = (ms = 1500) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void syncAll(), ms);
  };
  onSessionChange(() => soon(300));
  // Des compteurs du Personnage ont changé : ils partent un peu après (une séance finie, un import bancaire).
  onStatsChange(() => soon(2000));
  // Un choix de thème part presque aussitôt : on change souvent d'app juste après.
  subscribeAppearance(() => soon(150));
  document.addEventListener('visibilitychange', () => (document.visibilityState === 'visible' ? soon(500) : void syncAll()));
  window.addEventListener('online', () => soon(500));
  soon(400);
}
