import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { Space, SpaceMember } from './vendor/mylife-sync';
import { client } from './crew';

/**
 * Données d'un espace partagé sur l'appareil, d'abord hors ligne (festival : réseau capricieux) :
 * dernier état connu gardé sur l'appareil, écritures appliquées tout de suite puis mises en file et
 * envoyées dès que possible, synchro au lancement, toutes les 20 s à l'écran, au retour du réseau.
 * Effacé, comme le reste, si un autre compte se connecte sur l'appareil (préfixe `mylife:space`).
 */

export interface CachedRecord {
  tbl: string;
  rid: string;
  author: string;
  open: boolean;
  updatedAt: number;
  row: unknown;
}

interface Pending {
  tbl: string;
  rid: string;
  row: unknown | null;
  open: boolean;
}

interface Cache {
  cursor: number;
  records: Record<string, CachedRecord>;
  members: SpaceMember[];
  outbox: Pending[];
}

export interface SpaceData {
  records: CachedRecord[];
  members: SpaceMember[];
  pending: number;
  syncing: boolean;
  error: string | null;
  /** La dernière synchro réussie (0 : jamais sur cet appareil). */
  syncedAt: number;
}

const KEY = (sid: string) => `mylife:space:${sid}`;
const k = (tbl: string, rid: string) => `${tbl}\u0001${rid}`;
const empty = (): Cache => ({ cursor: 0, records: {}, members: [], outbox: [] });

function load(sid: string): Cache {
  try {
    const c = JSON.parse(localStorage.getItem(KEY(sid)) ?? 'null') as Cache | null;
    return c && typeof c.cursor === 'number' && c.records && Array.isArray(c.outbox) ? { ...c, members: c.members ?? [] } : empty();
  } catch {
    return empty();
  }
}

function save(sid: string, c: Cache) {
  try {
    localStorage.setItem(KEY(sid), JSON.stringify(c));
  } catch {
    /* stockage plein : reste en mémoire */
  }
}

interface Live {
  cache: Cache;
  syncing: boolean;
  error: string | null;
  syncedAt: number;
  snapshot: SpaceData;
  listeners: Set<() => void>;
  timer: ReturnType<typeof setTimeout> | null;
}

const live = new Map<string, Live>();

function snapshotOf(l: Live): SpaceData {
  const members = new Set(l.cache.members.map((m) => m.uid));
  // Les lignes d'un membre parti sont effacées par le serveur : sur l'appareil, on ne les montre plus.
  const records = Object.values(l.cache.records).filter((r) => !members.size || members.has(r.author) || r.open);
  return { records, members: l.cache.members, pending: l.cache.outbox.length, syncing: l.syncing, error: l.error, syncedAt: l.syncedAt };
}

function get(sid: string): Live {
  let l = live.get(sid);
  if (!l) {
    l = { cache: load(sid), syncing: false, error: null, syncedAt: 0, snapshot: undefined as unknown as SpaceData, listeners: new Set(), timer: null };
    l.snapshot = snapshotOf(l);
    live.set(sid, l);
  }
  return l;
}

function changed(sid: string, l: Live) {
  l.snapshot = snapshotOf(l);
  l.listeners.forEach((fn) => fn());
  save(sid, l.cache);
}

export async function syncSpaceNow(space: Space): Promise<void> {
  const l = get(space.id);
  const c = client();
  if (!c || l.syncing) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  l.syncing = true;
  changed(space.id, l);
  const sending = l.cache.outbox.slice(0, 150);
  try {
    const [r, members] = await Promise.all([c.sync(space, l.cache.cursor, sending), c.members(space)]);
    l.cache.outbox = l.cache.outbox.slice(sending.length);
    for (const d of r.deleted) delete l.cache.records[k(d.tbl, d.rid)];
    for (const rec of r.records) l.cache.records[k(rec.tbl, rec.rid)] = { tbl: rec.tbl, rid: rec.rid, author: rec.author, open: rec.open, updatedAt: rec.updatedAt, row: rec.row };
    l.cache.cursor = r.cursor;
    l.cache.members = members;
    l.error = r.refused.length ? 'Certaines modifications appartiennent à quelqu’un d’autre : elles n’ont pas été gardées.' : null;
    if (r.refused.length) {
      // Repartir de l'état du serveur pour annuler ce qui a été refusé.
      l.cache.cursor = 0;
      l.cache.records = {};
      l.syncing = false;
      changed(space.id, l);
      return syncSpaceNow(space);
    }
    l.syncedAt = Date.now();
  } catch (e) {
    l.error = e instanceof Error ? e.message : String(e);
  } finally {
    l.syncing = false;
    changed(space.id, l);
  }
}

/** Écrit une ligne (null : la supprime) : visible tout de suite, envoyée dès que possible. */
export function writeSpace(space: Space, uid: string, tbl: string, rid: string, row: unknown | null, open = false): void {
  const l = get(space.id);
  const key = k(tbl, rid);
  const prev = l.cache.records[key];
  if (row === null) delete l.cache.records[key];
  else l.cache.records[key] = { tbl, rid, author: prev?.author ?? uid, open: prev?.open ?? open, updatedAt: Date.now(), row };
  l.cache.outbox = [...l.cache.outbox.filter((p) => !(p.tbl === tbl && p.rid === rid)), { tbl, rid, row, open }];
  changed(space.id, l);
  if (l.timer) clearTimeout(l.timer);
  l.timer = setTimeout(() => void syncSpaceNow(space), 400);
}

/** Les données d'un espace, tenues à jour tant que l'écran est ouvert. */
export function useSpaceData(space: Space | undefined): SpaceData & { sync: () => void } {
  const sid = space?.id ?? '';
  const subscribe = useCallback(
    (fn: () => void) => {
      if (!sid) return () => undefined;
      const l = get(sid);
      l.listeners.add(fn);
      return () => l.listeners.delete(fn);
    },
    [sid],
  );
  const data = useSyncExternalStore(subscribe, () => (sid ? get(sid).snapshot : EMPTY), () => EMPTY);
  useEffect(() => {
    if (!space) return;
    void syncSpaceNow(space);
    const every = setInterval(() => document.visibilityState === 'visible' && void syncSpaceNow(space), 20_000);
    const online = () => void syncSpaceNow(space);
    window.addEventListener('online', online);
    return () => {
      clearInterval(every);
      window.removeEventListener('online', online);
    };
  }, [space]);
  return { ...data, sync: () => space && void syncSpaceNow(space) };
}

const EMPTY: SpaceData = { records: [], members: [], pending: 0, syncing: false, error: null, syncedAt: 0 };

/** Un espace quitté : ses données locales partent aussi. */
export function forgetSpace(sid: string): void {
  live.delete(sid);
  try {
    localStorage.removeItem(KEY(sid));
  } catch {
    /* rien */
  }
}

export const newRid = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');

/** L'état connu d'un espace, sans le synchroniser (lecture du cache de l'appareil). */
export function spaceSnapshot(sid: string): SpaceData {
  return get(sid).snapshot;
}
