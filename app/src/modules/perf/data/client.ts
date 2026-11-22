import type { LocalStore } from '@mylife/core/engine';
import type { Backend, Op, Response, StorageInfo } from './backend';

/**
 * Le côté écran de la base de MyPerf : un seul Worker pour la page, des appels asynchrones (`call`), et la synchro
 * MyLife branchée dessus (`perfStore`). Le Worker n'est créé qu'à la première utilisation du module.
 */
let worker: Worker | null = null;
let next = 1;
const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function ensure(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'mylife-perf' });
  worker.onmessage = (e: MessageEvent<Response>) => {
    const w = waiting.get(e.data.id);
    if (!w) return;
    waiting.delete(e.data.id);
    if (e.data.ok) w.resolve(e.data.result);
    else w.reject(new Error(e.data.error));
  };
  return worker;
}

function send<T>(op: Op | 'info', args: unknown[] = []): Promise<T> {
  const id = next++;
  return new Promise<T>((resolve, reject) => {
    waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
    ensure().postMessage({ id, op, args });
  });
}

export function call<K extends Op>(op: K, ...args: Parameters<Backend[K]>): Promise<ReturnType<Backend[K]>> {
  return send(op, args);
}

export const storageInfo = (): Promise<StorageInfo> => send('info');

/** Stockage protégé de l'effacement automatique du navigateur ? Demandé une fois ; l'état est montré à l'écran. */
export async function persistStorage(): Promise<'protégé' | 'non protégé' | 'inconnu'> {
  try {
    if (!navigator.storage?.persist) return 'inconnu';
    const already = await navigator.storage.persisted();
    return already || (await navigator.storage.persist()) ? 'protégé' : 'non protégé';
  } catch {
    return 'inconnu';
  }
}

export function perfStore(): LocalStore {
  return {
    app: 'perf',
    pending: (limit) => call('pending', limit),
    ack: (done) => call('ack', [...done]),
    apply: (rows) => call('apply', [...rows]),
    snapshot: () => call('snapshot'),
    replace: (rows) => call('replace', [...rows]),
    clearPending: () => call('clearPending'),
    getState: () => call('getState'),
    setState: (state) => call('setState', state),
    forget: () => call('forget'),
  };
}
