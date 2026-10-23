import { Platform } from 'react-native';

import { db } from '@/db/db';
import { nativeStats, onPerfStatsChange } from '@/services/rpgStats';
import { appearanceAt, useSettings } from '@/state/settingsStore';
import { DEFAULT_APPEARANCE, parseAppearance, type SharedAppearance } from '@/vendor/lumen';
import { loadState, syncNow, type LocalStore, type SyncState } from '@/vendor/mylife-sync';

import { currentSession, platform } from './platform';

/**
 * Apparence de MyLife synchronisée entre appareils par le compte (app `mylife`), comme dans les apps
 * web (MyLife/packages/ui/src/prefsSync.ts) : une seule ligne datée du choix de l'utilisateur, la plus
 * récente gagne, un thème jamais choisi n'est jamais envoyé. Ici pour l'app Android et MyPerf web.
 * L'état de cette synchro reste sur l'appareil (table sync_state, jamais synchronisée).
 */
const kv = (k: string) => db().first<{ v: string }>('SELECT v FROM sync_state WHERE k = ?', [k])?.v ?? null;
const setKv = (k: string, v: string) => db().run('INSERT INTO sync_state (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', [k, v]);

function local(): SharedAppearance {
  const s = useSettings.getState().settings;
  return { ...DEFAULT_APPEARANCE, theme: s.theme, followSystem: s.followSystem, at: appearanceAt() };
}

/** App Android : les compteurs du Personnage partent aussi par ici (sur le web, l'accueil s'en charge). */
const statsRow = () => (Platform.OS === 'web' ? null : nativeStats());

const prefsStore: LocalStore = {
  app: 'mylife',
  async pending() {
    const a = local();
    const out = a.at > Number(kv('prefs_pushed') ?? 0) ? [{ tbl: 'prefs', rid: 'appearance', ver: a.at, updatedAt: a.at, row: a as unknown }] : [];
    const st = statsRow();
    if (st && st.at > Number(kv('stats_perf_pushed') ?? 0)) out.push({ tbl: 'stats', rid: 'perf', ver: st.at, updatedAt: st.at, row: st });
    return out;
  },
  async ack(done) {
    for (const d of done) {
      if (d.rid === 'appearance') setKv('prefs_pushed', String(d.ver));
      if (d.tbl === 'stats' && d.rid === 'perf') setKv('stats_perf_pushed', String(d.ver));
    }
  },
  async apply(rows) {
    for (const r of rows) {
      if (r.tbl !== 'prefs' || r.rid !== 'appearance' || r.deleted) continue;
      const a = parseAppearance(r.row);
      if (a && a.at > appearanceAt()) {
        useSettings.getState().adoptAppearance(a);
        setKv('prefs_pushed', String(a.at));
      }
    }
  },
  async snapshot() {
    const st = statsRow();
    return [{ tbl: 'prefs', rid: 'appearance', row: local() as unknown }, ...(st ? [{ tbl: 'stats', rid: 'perf', row: st as unknown }] : [])];
  },
  async replace(rows) {
    await this.apply(rows);
  },
  async clearPending() {
    setKv('prefs_pushed', String(appearanceAt()));
    setKv('stats_perf_pushed', String(statsRow()?.at ?? 0));
  },
  async getState() {
    const raw = kv('prefs_state');
    return raw ? (JSON.parse(raw) as SyncState) : null;
  },
  async setState(s) {
    setKv('prefs_state', JSON.stringify(s));
  },
};

let running = false;

export async function syncPrefs(): Promise<void> {
  const session = await currentSession();
  if (!session || running) return;
  running = true;
  try {
    const state = await loadState(prefsStore, platform.random);
    if (state.joinedAs !== session.login) {
      await prefsStore.setState({ ...state, joinedAs: session.login, cursor: 0 });
      setKv('prefs_pushed', '0');
      // Compteurs du Personnage de l'ancien compte : jamais envoyés au nouveau (ils seront recalculés).
      db().run("DELETE FROM sync_state WHERE k IN ('stats_perf', 'stats_perf_pushed')");
    }
    await syncNow(prefsStore, platform.api, session, platform.random);
  } catch {
    /* hors ligne, session expirée : au prochain passage */
  } finally {
    running = false;
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;

/** Un choix de thème part presque aussitôt. */
export function syncPrefsSoon(ms = 300): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void syncPrefs(), ms);
}

/** Suit les choix de thème faits dans MyPerf, et les compteurs du Personnage (app Android). */
export function watchAppearance(): void {
  onPerfStatsChange(() => syncPrefsSoon(2000));
  let last = `${useSettings.getState().settings.theme}|${useSettings.getState().settings.followSystem}`;
  useSettings.subscribe((s) => {
    const now = `${s.settings.theme}|${s.settings.followSystem}`;
    if (now === last) return;
    last = now;
    syncPrefsSoon();
  });
}
