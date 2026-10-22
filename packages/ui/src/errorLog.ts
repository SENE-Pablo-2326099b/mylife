import { kitApp } from './app';

/**
 * Journal d'erreurs local : les derniers plantages restent sur cet appareil (rien n'est envoyé),
 * lisibles et copiables dans Réglages → Sauvegarde et données pour signaler un problème.
 */

export interface LoggedError {
  at: number;
  source: string;
  message: string;
  stack?: string;
  path: string;
}

/** Un journal par app (« myfinances-errors »…) : chacune affiche les siens. */
const key = () => `my${kitApp().id}-errors`;
const MAX = 30;

export function readErrors(): LoggedError[] {
  try {
    const v = JSON.parse(localStorage.getItem(key()) ?? '[]') as unknown;
    return Array.isArray(v) ? (v as LoggedError[]) : [];
  } catch {
    return [];
  }
}

export function clearErrors(): void {
  try {
    localStorage.removeItem(key());
  } catch {
    /* stockage indisponible */
  }
}

export function logError(source: string, error: unknown): void {
  const e = error instanceof Error ? error : new Error(typeof error === 'string' ? error : JSON.stringify(error) ?? String(error));
  const entry: LoggedError = {
    at: Date.now(),
    source,
    message: e.message.slice(0, 500),
    stack: e.stack?.split('\n').slice(0, 8).join('\n'),
    path: typeof location !== 'undefined' ? location.pathname : '',
  };
  try {
    const list = readErrors();
    const last = list[0];
    // La même erreur en rafale ne remplit pas le journal.
    if (last && last.message === entry.message && entry.at - last.at < 5000) return;
    localStorage.setItem(key(), JSON.stringify([entry, ...list].slice(0, MAX)));
  } catch {
    /* stockage plein ou indisponible : tant pis pour le journal */
  }
}

/** Après une mise à jour, l'ancienne page peut réclamer un morceau de code qui n'existe plus. */
export function isStaleChunk(error: unknown): boolean {
  const m = error instanceof Error ? error.message : String(error);
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported|Failed to fetch dynamically/i.test(m);
}

const RELOAD_KEY = 'mylife-chunk-reload';
/** Recharge une fois (pas en boucle) pour récupérer la nouvelle version. Renvoie false si déjà tenté. */
export function reloadForNewVersion(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - last < 30_000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return false;
  }
  location.reload();
  return true;
}

export function installErrorLog(): void {
  window.addEventListener('error', (ev) => logError('window', ev.error ?? ev.message));
  window.addEventListener('unhandledrejection', (ev) => {
    if (isStaleChunk(ev.reason) && reloadForNewVersion()) return;
    logError('promesse', ev.reason);
  });
}
