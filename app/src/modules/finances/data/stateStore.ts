import type { LocalStore, PendingChange, SyncState } from '@mylife/core/engine';
import { diffRows, fromRows, ROW_SEP, toRows, type StateRows } from '../engine/stateRows';
import type { EngineState } from '../engine/state';
import { db } from './db';

/**
 * Les réglages du moteur (`EngineState`) sur l'appareil, et leur synchro entre appareils sous l'app `finances5` :
 * une ligne par engagement, enveloppe, décision… (`stateRows.ts`). À part des faits, qui gardent la synchro de
 * l'ancienne app : chacun son repère et sa file, aucun ne gêne l'autre.
 */
const KEY = 'engineState';
const STASH = 'engineRowsStash';
const TOUCHED = 'engineTouched';
const QUEUE_KEY = 'mylife-queue-finances5';
const STATE_KEY = 'mylife-sync-finances5';

type Queue = Map<string, { ver: number; at: number }>;
let queue: Queue | null = null;
function q(): Queue {
  if (queue) return queue;
  try {
    const raw = globalThis.localStorage?.getItem(QUEUE_KEY);
    queue = new Map(raw ? (JSON.parse(raw) as [string, { ver: number; at: number }][]) : []);
  } catch {
    queue = new Map();
  }
  return queue;
}
const queued = new Set<() => void>();
function saveQueue(): void {
  try {
    globalThis.localStorage?.setItem(QUEUE_KEY, JSON.stringify([...q()]));
  } catch {
    /* stockage plein : la file reste en mémoire */
  }
  queued.forEach((l) => l());
}

export function onStateQueued(fn: () => void): () => void {
  queued.add(fn);
  return () => queued.delete(fn);
}
export const statePending = (): number => q().size;

const replaced = new Set<() => void>();
/** Prévenu quand les réglages ont été remplacés par ceux d'un autre appareil : le moteur les relit. */
export function onStateReplaced(fn: () => void): () => void {
  replaced.add(fn);
  return () => replaced.delete(fn);
}

export async function readState(): Promise<EngineState | undefined> {
  const v = (await db.meta.get(KEY))?.value as EngineState | undefined;
  return v?.version === 1 ? v : undefined;
}

/**
 * Enregistre les réglages ; ce qui a changé part vers les autres appareils. `touched` : l'utilisateur a réglé quelque
 * chose ici. Les réglages de départ, eux, passent par `writeInitial` : chaque appareil sait les refaire, ils partent
 * donc avec la date la plus ancienne possible et ne remplacent jamais ce qu'un autre appareil a mis dans le compte
 * (le serveur garde le plus récent, et renvoie le gagnant).
 */
export async function writeState(next: EngineState, opts: { touched?: boolean; before?: EngineState } = {}): Promise<void> {
  const before = opts.before ?? (await readState());
  await db.meta.put({ key: KEY, value: next });
  if (opts.touched) await db.meta.put({ key: TOUCHED, value: true });
  const changed = diffRows(before ? toRows(before) : new Map(), toRows(next));
  if (!changed.length) return;
  const now = Date.now();
  for (const k of changed) q().set(k, { ver: (q().get(k)?.ver ?? 0) + 1, at: now });
  saveQueue();
}

/**
 * Pose les réglages de départ, sauf si des réglages sont arrivés entre-temps (d'un autre appareil) : ceux-là restent.
 * Renvoie ceux qui sont gardés.
 */
export async function writeInitial(start: EngineState): Promise<EngineState> {
  const kept = await db.transaction('rw', db.meta, async () => {
    const existing = (await db.meta.get(KEY))?.value as EngineState | undefined;
    if (existing?.version === 1) return existing;
    await db.meta.put({ key: KEY, value: start });
    return null;
  });
  if (kept) return kept;
  for (const k of toRows(start).keys()) q().set(k, { ver: (q().get(k)?.ver ?? 0) + 1, at: 1 });
  saveQueue();
  return start;
}

/** L'utilisateur a-t-il réglé quelque chose sur cet appareil (au-delà des réglages de départ) ? */
export async function stateTouched(): Promise<boolean> {
  return (await db.meta.get(TOUCHED))?.value === true;
}

async function install(rows: StateRows): Promise<void> {
  const next = fromRows(rows);
  if (next) {
    await db.meta.put({ key: KEY, value: next });
    await db.meta.delete(STASH);
  } else await db.meta.put({ key: STASH, value: [...rows] });
  replaced.forEach((l) => l());
}

export function stateStore(): LocalStore {
  return {
    app: 'finances5',
    async pending(limit) {
      const cur = await readState();
      const rows = cur ? toRows(cur) : new Map<string, unknown>();
      const out: PendingChange[] = [];
      for (const [k, v] of [...q()].slice(0, limit)) {
        const at = k.indexOf(ROW_SEP);
        out.push({ tbl: k.slice(0, at), rid: k.slice(at + 1), ver: v.ver, updatedAt: v.at, row: rows.has(k) ? rows.get(k) : null });
      }
      return out;
    },
    async ack(done) {
      for (const d of done) {
        const k = `${d.tbl}${ROW_SEP}${d.rid}`;
        if (q().get(k)?.ver === d.ver) q().delete(k);
      }
      saveQueue();
    },
    async apply(remote) {
      if (!remote.length) return;
      const cur = await readState();
      const rows: StateRows = cur ? toRows(cur) : new Map(((await db.meta.get(STASH))?.value as [string, unknown][] | undefined) ?? []);
      for (const r of remote) {
        const k = `${r.tbl}${ROW_SEP}${r.rid}`;
        if (r.deleted || r.row === null) rows.delete(k);
        else rows.set(k, r.row);
      }
      await install(rows);
    },
    async snapshot() {
      const cur = await readState();
      return cur
        ? [...toRows(cur)].map(([k, row]) => {
            const at = k.indexOf(ROW_SEP);
            return { tbl: k.slice(0, at), rid: k.slice(at + 1), row };
          })
        : [];
    },
    async replace(remote) {
      // Les réglages de l'appareil laissent la place à ceux du compte : ils sont gardés de côté, au cas où.
      const cur = await readState();
      if (cur) await db.meta.put({ key: 'engineStateBefore', value: { at: Date.now(), state: cur } });
      await db.meta.delete(KEY);
      await db.meta.delete(STASH);
      await db.meta.delete(TOUCHED);
      await install(new Map(remote.filter((r) => !r.deleted && r.row !== null).map((r) => [`${r.tbl}${ROW_SEP}${r.rid}`, r.row])));
    },
    async clearPending() {
      q().clear();
      saveQueue();
    },
    async forget() {
      await db.meta.bulkDelete([KEY, STASH, TOUCHED, 'engineStateBefore']);
      q().clear();
      saveQueue();
      replaced.forEach((l) => l());
    },
    async getState() {
      try {
        const raw = globalThis.localStorage?.getItem(STATE_KEY);
        return raw ? (JSON.parse(raw) as SyncState) : null;
      } catch {
        return null;
      }
    },
    async setState(state) {
      try {
        globalThis.localStorage?.setItem(STATE_KEY, JSON.stringify(state));
      } catch {
        /* sans stockage : l'appareil refera un envoi complet la prochaine fois */
      }
    },
  };
}
