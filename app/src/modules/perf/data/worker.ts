/// <reference lib="webworker" />
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { createBackend, type Backend, type Request, type Response, type StorageInfo } from './backend';
import { wrapOo1, type Oo1Db } from './sql';

/**
 * Le Worker de MyPerf : SQLite officiel en WebAssembly, fichier dans le système de fichiers privé du navigateur, mode
 * « pool d'accès synchrones » (OPFS SAH Pool). Ce mode n'exige pas les en-têtes COOP/COEP (pas de SharedArrayBuffer) :
 * MyLife n'a pas à s'isoler. Sans OPFS (navigateur ancien), la base vit en mémoire et l'écran le dit.
 */
const ready: Promise<{ backend: Backend; info: StorageInfo }> = (async () => {
  const sqlite3 = await sqlite3InitModule();
  let raw: Oo1Db;
  let vfs: StorageInfo['vfs'] = 'opfs-sahpool';
  try {
    const pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'mylife-perf' });
    raw = new pool.OpfsSAHPoolDb('/perf.sqlite3') as unknown as Oo1Db;
  } catch {
    vfs = 'memory';
    raw = new sqlite3.oo1.DB(':memory:') as unknown as Oo1Db;
  }
  return { backend: createBackend(wrapOo1(raw)), info: { vfs, sqlite: sqlite3.version.libVersion } };
})();

self.onmessage = async (e: MessageEvent<Request | { id: number; op: 'info' }>) => {
  const { id, op } = e.data;
  try {
    const { backend, info } = await ready;
    if (op === 'info') return self.postMessage({ id, ok: true, result: info } satisfies Response);
    const fn = backend[op] as (...args: unknown[]) => unknown;
    self.postMessage({ id, ok: true, result: fn(...((e.data as Request).args ?? [])) } satisfies Response);
  } catch (err) {
    self.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies Response);
  }
};
