import { useEffect, useState, useSyncExternalStore } from 'react';
import { currentSession, onSessionChange } from '@mylife/core/web';
import { AGENDA_EVENT } from '@mylife/lumen';
import { DEFAULT_PREFS, parsePrefs, type ShellPrefs } from './contract';

/** Ce que la coquille garde sur l'appareil, et les petits crochets pour le lire en direct. */

const PREFS_KEY = 'mylife:v5:prefs';
const PREFS_EVENT = 'mylife:v5:prefs';

export function readPrefs(): ShellPrefs {
  try {
    return parsePrefs(JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null'));
  } catch {
    return DEFAULT_PREFS;
  }
}

export function writePrefs(prefs: ShellPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* stockage indisponible : le choix vaut pour cette visite */
  }
  window.dispatchEvent(new Event(PREFS_EVENT));
}

let cached = { raw: '', value: DEFAULT_PREFS };
function snapshot(): ShellPrefs {
  let raw = '';
  try {
    raw = localStorage.getItem(PREFS_KEY) ?? '';
  } catch {
    /* stockage indisponible */
  }
  if (raw !== cached.raw) cached = { raw, value: readPrefs() };
  return cached.value;
}

export function usePrefs(): ShellPrefs {
  return useSyncExternalStore((notify) => {
    window.addEventListener(PREFS_EVENT, notify);
    window.addEventListener('storage', notify);
    return () => {
      window.removeEventListener(PREFS_EVENT, notify);
      window.removeEventListener('storage', notify);
    };
  }, snapshot);
}

/**
 * Se redessine quand ce que les modules déposent sur l'appareil a pu changer : un autre onglet a écrit, l'agenda a été
 * publié dans cette page (les Sorties, après synchro), on revient sur l'app, une minute est passée (« aujourd'hui »
 * change à minuit).
 */
export function useDeviceTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    window.addEventListener('storage', bump);
    window.addEventListener(AGENDA_EVENT, bump);
    window.addEventListener('focus', bump);
    document.addEventListener('visibilitychange', bump);
    const id = setInterval(bump, 60_000);
    return () => {
      window.removeEventListener('storage', bump);
      window.removeEventListener(AGENDA_EVENT, bump);
      window.removeEventListener('focus', bump);
      document.removeEventListener('visibilitychange', bump);
      clearInterval(id);
    };
  }, []);
  return tick;
}

/** Le compte connecté sur cet appareil (le même que dans toutes les apps de MyLife), ou null. */
export function useLogin(): string | null {
  return useSyncExternalStore(onSessionChange, () => currentSession()?.login ?? null);
}

/** Se redessine quand la session ou la clé de secours en attente changent. */
export function useSessionTick(): number {
  return useSyncExternalStore(onSessionChange, () => {
    const s = currentSession();
    return s ? s.login.length + s.token.length : 0;
  });
}
