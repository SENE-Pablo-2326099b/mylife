// GÉNÉRÉ depuis MyLife/packages/ui — ne pas modifier ici (MyLife : npm run vendor).
import { useMemo, useSyncExternalStore } from 'react';
import { loadState, syncNow, type LocalStore, type PendingChange, type SyncState } from '../vendor/mylife-sync';
import { currentSession, webPlatform } from '../vendor/mylife-sync/web';
import { clearSyncIssue, noteSyncIssue } from './syncIssue';

/**
 * Collections synchronisées des apps de l'accueil (contrat d'app de la V4, docs/CONTRAT-APP.md) : des lignes
 * indépendantes (un ingrédient, une recette, un objectif…), chacune chiffrée et datée, la plus récente gagne, une
 * suppression suit sur les autres appareils. Une app déclare ses collections une fois :
 *
 *   const items = defineCollection({ app: 'chef', name: 'items', parse: parseItem });
 *   items.put(id, value); items.remove(id); items.useList();
 *
 * L'app de synchro (`app`) doit être déclarée au serveur (`SYNC_APPS`, server/core.ts). Tout ce qui est gardé ici
 * commence par `mylife:app:` : effacé quand un autre compte se connecte (claimDevice).
 */

export interface CollectionItem<T> {
  id: string;
  /** Dernière modification. */
  at: number;
  value: T;
}

interface Stored<T> {
  at: number;
  /** null : supprimée, gardée jusqu'à ce que le compte l'ait reçue. */
  v: T | null;
}

export interface Collection<T> {
  readonly app: string;
  readonly name: string;
  list(): CollectionItem<T>[];
  get(id: string): T | null;
  put(id: string, value: T, at?: number): void;
  remove(id: string, at?: number): void;
  /** Les lignes, à jour en direct (autres onglets et synchro comprises). */
  useList(): CollectionItem<T>[];
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const EVENT = 'mylife:collections';
const rowsKey = (app: string, name: string) => `mylife:app:${app}:${name}`;
const dirtyKey = (app: string) => `mylife:app:${app}:dirty`;
const stateKey = (app: string) => `mylife-sync-${app}`;

function readJson<T>(key: string, fallback: T): T {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null') as T | null;
    return v ?? fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* stockage plein ou indisponible : la synchro réessaiera */
  }
}
const emit = () => typeof window !== 'undefined' && window.dispatchEvent(new Event(EVENT));

interface Registered {
  name: string;
  parse: (raw: unknown) => unknown | null;
  max: number;
}
const apps = new Map<string, Map<string, Registered>>();

function readRows(app: string, name: string): Record<string, Stored<unknown>> {
  return readJson<Record<string, Stored<unknown>>>(rowsKey(app, name), {});
}
const readDirty = (app: string) => readJson<Record<string, number>>(dirtyKey(app), {});

let timer: ReturnType<typeof setTimeout> | null = null;
function soon(): void {
  if (typeof window === 'undefined') return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void syncCollections(), 1500);
}

export function defineCollection<T>(opts: { app: string; name: string; parse: (raw: unknown) => T | null; max?: number }): Collection<T> {
  const { app, name } = opts;
  const max = opts.max ?? 5000;
  if (!/^[a-z][a-z0-9]{1,23}$/.test(app) || !/^[a-z][a-z0-9_]{0,39}$/.test(name)) throw new Error(`Collection invalide : ${app}/${name}`);
  if (!apps.has(app)) apps.set(app, new Map());
  apps.get(app)!.set(name, { name, parse: opts.parse as (raw: unknown) => unknown | null, max });

  const write = (id: string, stored: Stored<T>) => {
    if (!ID.test(id)) throw new Error(`Identifiant invalide : ${id}`);
    const rows = readRows(app, name);
    rows[id] = stored;
    const live = Object.values(rows).filter((r) => r.v !== null).length;
    if (stored.v !== null && live > max) throw new Error(`${max} éléments au plus`);
    writeJson(rowsKey(app, name), rows);
    writeJson(dirtyKey(app), { ...readDirty(app), [`${name}/${id}`]: stored.at });
    emit();
    soon();
  };
  const list = (): CollectionItem<T>[] =>
    Object.entries(readRows(app, name))
      .filter(([, r]) => r.v !== null)
      .map(([id, r]) => ({ id, at: r.at, value: r.v as T }));
  const subscribe = (fn: () => void) => {
    const onStorage = (e: StorageEvent) => (e.key === null || e.key === rowsKey(app, name)) && fn();
    window.addEventListener('storage', onStorage);
    window.addEventListener(EVENT, fn);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(EVENT, fn);
    };
  };
  const snapshot = () => {
    try {
      return localStorage.getItem(rowsKey(app, name)) ?? '';
    } catch {
      return '';
    }
  };
  // Une app ouverte pour la première fois sur cet appareil récupère tout de suite ce que le compte contient.
  soon();
  return {
    app,
    name,
    list,
    get: (id) => {
      const r = readRows(app, name)[id];
      return r && r.v !== null ? (r.v as T) : null;
    },
    put: (id, value, at = Date.now()) => write(id, { at, v: value }),
    remove: (id, at = Date.now()) => {
      if (readRows(app, name)[id]) write(id, { at, v: null });
    },
    useList: () => {
      const key = useSyncExternalStore(subscribe, snapshot, () => '');
      // eslint-disable-next-line react-hooks/exhaustive-deps -- relu quand le stockage change (clé)
      return useMemo(() => list(), [key]);
    },
  };
}

/** Le magasin de synchro d'une app : ses collections, une ligne `<collection>/<id>` chacune. */
export function collectionStore(app: string): LocalStore {
  const colls = () => apps.get(app) ?? new Map<string, Registered>();
  return {
    app,
    batch: 100,
    async pending(limit) {
      const dirty = readDirty(app);
      const out: PendingChange[] = [];
      for (const [key, ver] of Object.entries(dirty)) {
        if (out.length >= limit) break;
        const [name = '', id = ''] = key.split('/');
        const r = readRows(app, name)[id];
        if (!r) continue;
        out.push({ tbl: name, rid: id, ver, updatedAt: r.at, row: r.v === null ? null : { at: r.at, v: r.v } });
      }
      return out;
    },
    async ack(done) {
      const dirty = readDirty(app);
      const touched = new Map<string, Record<string, Stored<unknown>>>();
      for (const d of done) {
        const key = `${d.tbl}/${d.rid}`;
        if (dirty[key] !== d.ver) continue;
        delete dirty[key];
        // Une suppression arrivée au compte n'a plus besoin d'être gardée ici.
        const rows = touched.get(d.tbl) ?? readRows(app, d.tbl);
        if (rows[d.rid]?.v === null && rows[d.rid]?.at === d.ver) {
          delete rows[d.rid];
          touched.set(d.tbl, rows);
        }
      }
      writeJson(dirtyKey(app), dirty);
      for (const [name, rows] of touched) writeJson(rowsKey(app, name), rows);
    },
    async apply(remote) {
      const dirty = readDirty(app);
      const changed = new Map<string, Record<string, Stored<unknown>>>();
      for (const r of remote) {
        const coll = colls().get(r.tbl);
        if (!coll || !ID.test(r.rid) || dirty[`${r.tbl}/${r.rid}`]) continue;
        const rows = changed.get(r.tbl) ?? readRows(app, r.tbl);
        if (r.deleted) {
          if (!rows[r.rid]) continue;
          delete rows[r.rid];
        } else {
          const row = (r.row ?? {}) as { at?: unknown; v?: unknown };
          const at = typeof row.at === 'number' && Number.isFinite(row.at) ? row.at : 0;
          const value = coll.parse(row.v);
          if (value === null || (rows[r.rid]?.at ?? -1) > at) continue;
          rows[r.rid] = { at, v: value };
        }
        changed.set(r.tbl, rows);
      }
      for (const [name, rows] of changed) writeJson(rowsKey(app, name), rows);
      if (changed.size) emit();
    },
    async snapshot() {
      const out: { tbl: string; rid: string; row: unknown }[] = [];
      for (const name of colls().keys())
        for (const [id, r] of Object.entries(readRows(app, name))) if (r.v !== null) out.push({ tbl: name, rid: id, row: { at: r.at, v: r.v } });
      return out;
    },
    async replace(remote) {
      // Tout le compte : ce qui n'y est plus disparaît d'ici, sauf ce qui n'est pas encore parti d'ici.
      const dirty = readDirty(app);
      for (const name of colls().keys()) {
        const keep = new Set(remote.filter((r) => r.tbl === name && !r.deleted).map((r) => r.rid));
        const rows = readRows(app, name);
        for (const id of Object.keys(rows)) if (!keep.has(id) && !dirty[`${name}/${id}`]) delete rows[id];
        writeJson(rowsKey(app, name), rows);
      }
      await this.apply(remote);
      emit();
    },
    async clearPending() {
      writeJson(dirtyKey(app), {});
    },
    async getState() {
      return readJson<SyncState | null>(stateKey(app), null);
    },
    async setState(s) {
      writeJson(stateKey(app), s);
    },
    async tooBig(rows) {
      noteSyncIssue(app, `${rows.length} élément${rows.length > 1 ? 's' : ''} trop gros pour le compte`);
    },
  };
}

/** Tout ce qui est ici part vers le compte (un compte relié pour la première fois à cet appareil). */
function markAllDirty(app: string): void {
  const dirty = readDirty(app);
  for (const name of apps.get(app)?.keys() ?? []) for (const [id, r] of Object.entries(readRows(app, name))) dirty[`${name}/${id}`] = r.at;
  writeJson(dirtyKey(app), dirty);
}

const quiet = (e: unknown) => [0, 401, 409, 429].includes((e as { status?: number }).status ?? -1);
let running = false;

/** Un passage pour chaque app qui a déclaré des collections sur cette page. */
export async function syncCollections(): Promise<void> {
  const session = currentSession();
  if (!session || running || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
  running = true;
  try {
    for (const app of apps.keys()) {
      const store = collectionStore(app);
      try {
        clearSyncIssue(app);
        const state = await loadState(store, webPlatform.random);
        if (state.joinedAs !== session.login) {
          await store.setState({ ...state, joinedAs: session.login, cursor: 0 });
          markAllDirty(app);
        }
        for (let guard = 0; guard < 20; guard++) {
          await syncNow(store, webPlatform.api, session, webPlatform.random);
          if (!(await store.pending(1)).length) break;
        }
      } catch (e) {
        if (!quiet(e)) noteSyncIssue(app, (e as Error).message);
      }
    }
  } finally {
    running = false;
  }
}

/** Pour les tests : les apps déclarées. */
export const declaredCollectionApps = (): string[] => [...apps.keys()];
