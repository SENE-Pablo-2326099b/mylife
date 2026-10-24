// GÉNÉRÉ depuis MyLife/packages/ui — ne pas modifier ici (MyLife : npm run vendor).
import { loadState, syncNow, type LocalStore, type PendingChange, type SyncState } from '../vendor/mylife-sync';
import { currentSession, webPlatform } from '../vendor/mylife-sync/web';
import { adoptMiniEntry, adoptMiniHead, dropMiniEntry, miniEntryRid, miniHead, parseMiniHead, splitMiniEntryRid, tombMiniApp, type MiniApp } from '../vendor/lumen';
import { markAllMiniDirty, migrateMiniApps, readMiniApps, readMiniDirty, writeMiniApps, writeMiniDirty } from './stats';
import { clearSyncIssue, noteSyncIssue } from './syncIssue';

/**
 * Synchro de « Mes apps » (app `miniapps` du serveur), chiffrée comme le reste : une ligne par app
 * (`app/<id>`, sa description) et une ligne par saisie (`entry/<app>.<saisie>`). Une ligne reste petite quel
 * que soit le nombre de saisies, et deux saisies notées hors ligne sur deux appareils s'additionnent.
 * Ce qui part : les lignes notées par `saveMiniApp` (stats.ts). Ce qui arrive : la plus récente gagne.
 */
const STATE_KEY = 'mylife-sync-miniapps';
/** Saisies arrivées avant la description de leur app (autre page de la synchro) : gardées en attendant. */
const ORPHANS_KEY = 'mylife:miniapps-orphans';
const MAX_ORPHANS = 3000;

const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* stockage indisponible */
  }
};

function readOrphans(): Record<string, unknown[]> {
  try {
    return (JSON.parse(localStorage.getItem(ORPHANS_KEY) ?? '{}') as Record<string, unknown[]>) ?? {};
  } catch {
    return {};
  }
}

/** La modification à envoyer pour une ligne notée, ou null si elle n'a plus lieu d'être. */
function changeFor(key: string, all: Record<string, MiniApp>): Omit<PendingChange, 'ver'> | null {
  if (key.startsWith('app/')) {
    const app = all[key.slice(4)];
    return app ? { tbl: 'app', rid: app.id, updatedAt: app.at, row: miniHead(app) } : null;
  }
  const ref = key.startsWith('entry/') ? splitMiniEntryRid(key.slice(6)) : null;
  const app = ref ? all[ref.app] : undefined;
  if (!ref || !app) return null;
  const rid = miniEntryRid(ref.app, ref.entry);
  const entry = app.entries.find((e) => e.id === ref.entry);
  if (entry) return { tbl: 'entry', rid, updatedAt: entry.at ?? app.at, row: { app: app.id, entry } };
  const gone = app.gone?.[ref.entry];
  if (gone) return { tbl: 'entry', rid, updatedAt: gone, row: null };
  return app.spec ? null : { tbl: 'entry', rid, updatedAt: app.at, row: null };
}

export const miniStore: LocalStore = {
  app: 'miniapps',
  // Une saisie pèse au plus une dizaine de Ko : 100 par envoi restent loin des limites d'une requête.
  batch: 100,
  async pending(limit) {
    const all = readMiniApps();
    const dirty = readMiniDirty();
    const out: PendingChange[] = [];
    let stale = false;
    for (const [key, ver] of Object.entries(dirty)) {
      if (out.length >= limit) break;
      const c = changeFor(key, all);
      if (c) out.push({ ...c, ver });
      else {
        delete dirty[key];
        stale = true;
      }
    }
    if (stale) writeMiniDirty(dirty);
    return out;
  },
  async ack(done) {
    const dirty = readMiniDirty();
    const all = readMiniApps();
    let pruned = false;
    for (const d of done) {
      const key = `${d.tbl}/${d.rid}`;
      if (dirty[key] === d.ver) delete dirty[key];
      // Une suppression arrivée au compte n'a plus besoin d'être retenue ici.
      const ref = d.tbl === 'entry' ? splitMiniEntryRid(d.rid) : null;
      const app = ref ? all[ref.app] : undefined;
      if (ref && app?.gone && app.gone[ref.entry] === d.ver && !dirty[key]) {
        const rest = { ...app.gone };
        delete rest[ref.entry];
        all[ref.app] = { ...app, gone: rest };
        pruned = true;
      }
    }
    writeMiniDirty(dirty);
    if (pruned) writeMiniApps(all, false);
  },
  async apply(remote) {
    const all = readMiniApps();
    const dirty = readMiniDirty();
    const orphans = readOrphans();
    let changed = false;
    const set = (next: MiniApp | null) => {
      if (!next) return;
      all[next.id] = next;
      changed = true;
    };
    // Les descriptions d'abord : une saisie a besoin de son app pour être vérifiée.
    for (const r of remote) {
      if (r.tbl !== 'app' || dirty[`app/${r.rid}`]) continue;
      const local = all[r.rid];
      if (r.deleted) {
        if (local) set(tombMiniApp(local, r.updatedAt ?? Date.now()));
        delete orphans[r.rid];
        continue;
      }
      const head = parseMiniHead(r.row);
      if (!head || head.id !== r.rid) continue;
      set(adoptMiniHead(local, head));
      for (const raw of orphans[r.rid] ?? []) set(all[r.rid] ? adoptMiniEntry(all[r.rid]!, raw) : null);
      delete orphans[r.rid];
    }
    for (const r of remote) {
      if (r.tbl !== 'entry' || dirty[`entry/${r.rid}`]) continue;
      const ref = splitMiniEntryRid(r.rid);
      if (!ref) continue;
      const app = all[ref.app];
      if (r.deleted) {
        if (app) set(dropMiniEntry(app, ref.entry));
        continue;
      }
      const row = (r.row ?? {}) as { app?: unknown; entry?: unknown };
      if (row.app !== ref.app || !row.entry || typeof row.entry !== 'object' || (row.entry as { id?: unknown }).id !== ref.entry) continue;
      if (app) set(adoptMiniEntry(app, row.entry));
      else if (Object.values(orphans).reduce((n, l) => n + l.length, 0) < MAX_ORPHANS) orphans[ref.app] = [...(orphans[ref.app] ?? []), row.entry];
    }
    write(ORPHANS_KEY, JSON.stringify(orphans));
    if (changed) writeMiniApps(all);
  },
  async snapshot() {
    const all = readMiniApps();
    const out: { tbl: string; rid: string; row: unknown }[] = [];
    for (const app of Object.values(all)) {
      const head = miniHead(app);
      if (!head) continue;
      out.push({ tbl: 'app', rid: app.id, row: head });
      for (const entry of app.entries) out.push({ tbl: 'entry', rid: miniEntryRid(app.id, entry.id), row: { app: app.id, entry } });
    }
    return out;
  },
  async replace(remote) {
    // Tout le contenu du compte : ce qui n'y est plus (supprimé ailleurs) disparaît d'ici, sauf ce qui n'est pas
    // encore parti d'ici.
    const dirty = readMiniDirty();
    const heads = new Set(remote.filter((r) => r.tbl === 'app' && !r.deleted).map((r) => r.rid));
    const entries = new Set(remote.filter((r) => r.tbl === 'entry' && !r.deleted).map((r) => r.rid));
    const all = readMiniApps();
    for (const app of Object.values(all)) {
      if (!app.spec) continue;
      if (!heads.has(app.id) && !dirty[`app/${app.id}`]) all[app.id] = tombMiniApp(app, app.at) ?? app;
      else all[app.id] = { ...app, entries: app.entries.filter((e) => entries.has(miniEntryRid(app.id, e.id)) || dirty[`entry/${miniEntryRid(app.id, e.id)}`]) };
    }
    writeMiniApps(all, false);
    await this.apply(remote);
  },
  async clearPending() {
    writeMiniDirty({});
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
  async tooBig(rows) {
    noteSyncIssue('miniapps', `${rows.length} élément${rows.length > 1 ? 's' : ''} de Mes apps trop gros pour le compte`);
  },
};

let running = false;
let again = false;

/** Erreurs passagères, qui ne méritent pas d'être montrées. */
export const quiet = (e: unknown) => [0, 401, 409, 429].includes((e as { status?: number }).status ?? -1);

/** Un passage : envoie ce qui a changé ici (par lots), reçoit ce qui a changé ailleurs. */
export async function syncMiniApps(): Promise<void> {
  const session = currentSession();
  if (!session || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    clearSyncIssue('miniapps');
    migrateMiniApps();
    const state = await loadState(miniStore, webPlatform.random);
    if (state.joinedAs !== session.login) {
      // Compte relié à cet appareil pour la première fois : tout relire, et tout ce qui est ici part vers lui.
      await miniStore.setState({ ...state, joinedAs: session.login, cursor: 0 });
      markAllMiniDirty();
    }
    // `syncNow` s'arrête quand un lot n'est pas plein : on relance tant qu'il reste des lignes à envoyer.
    for (let guard = 0; guard < 20; guard++) {
      await syncNow(miniStore, webPlatform.api, session, webPlatform.random);
      if (!(await miniStore.pending(1)).length) break;
    }
  } catch (e) {
    // Hors ligne, session expirée, trop de requêtes : on réessaiera. Un refus du serveur, lui, se signale.
    if (!quiet(e)) noteSyncIssue('miniapps', (e as Error).message);
  } finally {
    running = false;
    if (again) {
      again = false;
      void syncMiniApps();
    }
  }
}
