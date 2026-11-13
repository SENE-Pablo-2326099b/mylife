// GÉNÉRÉ depuis MyLife/packages/ui — ne pas modifier ici (MyLife : npm run vendor).
import { loadState, syncNow, type LocalStore, type SyncState } from '../vendor/mylife-sync';
import { currentSession, onSessionChange, webPlatform } from '../vendor/mylife-sync/web';
import { parseAppearance } from '../vendor/lumen';
import { getAppearance, setAppearance, subscribeAppearance } from './appearance';
import { syncCollections } from './collectionSync';
import { clearSyncIssue, noteSyncIssue } from './syncIssue';

/**
 * Réglages communs de MyLife synchronisés entre appareils par le compte, chiffrés comme le reste (app
 * `mylife` du serveur) : l'apparence (`prefs/appearance`). La ligne est datée, la plus récente gagne :
 * changer de thème sur le PC le change sur le téléphone. Lancé par chaque app web ; l'app Android fait
 * de même de son côté.
 *
 * Les autres lignes de `mylife` (compteurs du Personnage, musique, jeux, anciennes lignes de « Mes apps ») ne sont plus
 * lues depuis la V5 : elles restent dans le compte, récupérables par l'archive de « Mes données », jusqu'à leur purge.
 */
const STATE_KEY = 'mylife-sync-mylife';
const PUSHED_KEY = 'mylife-prefs-pushed';
/** Erreurs attendues (hors ligne, session expirée, appareil pas encore relié, trop de requêtes) : pas signalées. */
const quiet = (e: unknown) => [0, 401, 409, 429].includes((e as { status?: number }).status ?? -1);

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
  return out;
}

/** Les réglages communs comme des lignes datées ; une ligne jamais choisie (at = 0) n'est jamais envoyée. */
export const prefsStore: LocalStore = {
  app: 'mylife',
  async pending() {
    return rows()
      .filter((r) => r.at > readNum(r.pushedKey))
      .map((r) => ({ tbl: r.tbl, rid: r.rid, ver: r.at, updatedAt: r.at, row: r.row as unknown }));
  },
  async ack(done) {
    const keys = new Map(rows().map((r) => [`${r.tbl}/${r.rid}`, r.pushedKey]));
    for (const d of done) {
      const key = keys.get(`${d.tbl}/${d.rid}`);
      if (key) write(key, String(d.ver));
    }
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

/** Réglages communs, puis les collections des apps de l'accueil ouvertes sur cette page. */
async function syncAll(): Promise<void> {
  await syncPrefs();
  await syncCollections();
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
  // Un choix de thème part presque aussitôt : on change souvent d'app juste après.
  subscribeAppearance(() => soon(150));
  document.addEventListener('visibilitychange', () => (document.visibilityState === 'visible' ? soon(500) : void syncAll()));
  window.addEventListener('online', () => soon(500));
  soon(400);
}
