/// <reference lib="webworker" />
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { createBackend, type Backend, type Request, type Response, type StorageInfo } from './backend';
import { wrapOo1, type Oo1Db } from './sql';

/**
 * Le Worker de MyPerf : SQLite officiel en WebAssembly, fichier dans le système de fichiers privé du navigateur, mode
 * « pool d'accès synchrones » (OPFS SAH Pool). Ce mode n'exige pas les en-têtes COOP/COEP (pas de SharedArrayBuffer) :
 * MyLife n'a pas à s'isoler. Sans OPFS (navigateur ancien), la base vit en mémoire et l'écran le dit ; ouverte dans un
 * autre onglet, idem (`busy`).
 */
const ready: Promise<{ backend: Backend; info: StorageInfo }> = (async () => {
  const sqlite3 = await sqlite3InitModule();
  let raw: Oo1Db;
  let vfs: StorageInfo['vfs'] = 'opfs-sahpool';
  const open = async () => {
    const pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'mylife-perf' });
    return new pool.OpfsSAHPoolDb('/perf.sqlite3') as unknown as Oo1Db;
  };
  try {
    const locks = (self.navigator as Navigator & { locks?: LockManager }).locks;
    raw = locks
      ? await new Promise<Oo1Db>((resolve, reject) => {
          // Un seul Worker à la fois sur le fichier : le verrou est tenu tant que ce Worker vit. Une page rechargée
          // attend que la précédente l'ait rendu (quelques instants) ; un autre onglet resté ouvert, lui, le garde.
          const stop = new AbortController();
          const timer = setTimeout(() => stop.abort(), 5000);
          locks
            .request('mylife-perf-db', { signal: stop.signal }, async () => {
              clearTimeout(timer);
              try {
                resolve(await open());
              } catch (err) {
                reject(err);
                return;
              }
              await new Promise(() => {});
            })
            .catch((err: unknown) => reject(err instanceof DOMException && err.name === 'AbortError' ? new Error('busy') : err));
        })
      : await open();
  } catch (err) {
    vfs = err instanceof Error && err.message === 'busy' ? 'busy' : 'memory';
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
