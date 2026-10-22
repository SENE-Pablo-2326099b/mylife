// GÉNÉRÉ depuis MyLife/packages/ui — ne pas modifier ici (MyLife : npm run vendor).
import { loadState, syncNow, type LocalStore, type SyncState } from '../vendor/mylife-sync';
import { currentSession, onSessionChange, webPlatform } from '../vendor/mylife-sync/web';
import { parseAppearance } from '../vendor/lumen';
import { getAppearance, setAppearance, subscribeAppearance } from './appearance';

/**
 * Réglages communs de MyLife (l'apparence) synchronisés entre appareils par le compte, chiffrés comme
 * le reste (app `mylife` du serveur). Le choix le plus récent gagne : changer de thème sur le PC le
 * change sur le téléphone. Lancé par chaque app web ; l'app Android fait de même de son côté.
 */
const STATE_KEY = 'mylife-sync-mylife';
const PUSHED_KEY = 'mylife-prefs-pushed';

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

/** L'apparence comme une ligne `prefs/appearance`, datée de son choix. */
export const prefsStore: LocalStore = {
  app: 'mylife',
  async pending() {
    const a = getAppearance();
    return a.at > readNum(PUSHED_KEY) ? [{ tbl: 'prefs', rid: 'appearance', ver: a.at, updatedAt: a.at, row: a }] : [];
  },
  async ack(done) {
    for (const d of done) if (d.rid === 'appearance') write(PUSHED_KEY, String(d.ver));
  },
  async apply(rows) {
    for (const r of rows) {
      if (r.tbl !== 'prefs' || r.rid !== 'appearance' || r.deleted) continue;
      const a = parseAppearance(r.row);
      // Venu d'un autre appareil : gardé avec sa date (pas renvoyé comme un nouveau choix).
      if (a && a.at > getAppearance().at) {
        setAppearance(a);
        write(PUSHED_KEY, String(a.at));
      }
    }
  },
  async snapshot() {
    return [{ tbl: 'prefs', rid: 'appearance', row: getAppearance() }];
  },
  async replace(rows) {
    await this.apply(rows);
  },
  async clearPending() {
    write(PUSHED_KEY, String(getAppearance().at));
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
    const state = await loadState(prefsStore, webPlatform.random);
    if (state.joinedAs !== session.login) {
      // Nouveau compte sur cet appareil : tout relire depuis le début, et proposer le choix local.
      await prefsStore.setState({ ...state, joinedAs: session.login, cursor: 0 });
      write(PUSHED_KEY, '0');
    }
    await syncNow(prefsStore, webPlatform.api, session, webPlatform.random);
  } catch {
    /* hors ligne, session expirée : on réessaiera au prochain passage */
  } finally {
    running = false;
    if (again) {
      again = false;
      void syncPrefs();
    }
  }
}

let started = false;

/** Au lancement, à la connexion, à chaque changement d'apparence, au retour sur l'app. */
export function startPrefsSync(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const soon = (ms = 1500) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void syncPrefs(), ms);
  };
  onSessionChange(() => soon(300));
  // Un choix de thème part presque aussitôt : on change souvent d'app juste après.
  subscribeAppearance(() => soon(150));
  document.addEventListener('visibilitychange', () => (document.visibilityState === 'visible' ? soon(500) : void syncPrefs()));
  window.addEventListener('online', () => soon(500));
  soon(400);
}
