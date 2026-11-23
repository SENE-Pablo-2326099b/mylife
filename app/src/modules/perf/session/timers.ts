import { useEffect, useState } from 'react';
import { armRest, prepareRestPush } from './restPush';

/**
 * Le minuteur de repos et les petits services de la séance. Le repos est une heure de fin absolue (pas un compte à
 * rebours) : il reste juste quand l'onglet dort, et survit à un rechargement (gardée sur l'appareil). À la fin, si
 * l'app est à l'écran : vibration et son. Écran en veille : la notification envoyée par le serveur (restPush.ts), si elle
 * est activée sur cet appareil.
 */
const KEY = 'mylife:perf:rest';

export interface Rest {
  endAt: number;
  total: number;
  /** Ce qui vient ensuite (« série 2 », « développé couché »). */
  next: string;
}

const listeners = new Set<() => void>();
let rest: Rest | null = read();

function read(): Rest | null {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Rest | null;
    return r && typeof r.endAt === 'number' && r.endAt > Date.now() - 60_000 ? r : null;
  } catch {
    return null;
  }
}

function write(next: Rest | null) {
  rest = next;
  try {
    if (next) localStorage.setItem(KEY, JSON.stringify(next));
    else localStorage.removeItem(KEY);
  } catch {
    /* stockage indisponible : le repos reste en mémoire */
  }
  listeners.forEach((l) => l());
}

export function startRest(seconds: number, next: string): void {
  if (seconds <= 0) return write(null);
  unlockAudio();
  write({ endAt: Date.now() + seconds * 1000, total: seconds, next });
}

export function adjustRest(deltaSeconds: number): void {
  if (!rest) return;
  const endAt = Math.max(Date.now(), rest.endAt + deltaSeconds * 1000);
  write({ ...rest, endAt, total: Math.max(1, rest.total + deltaSeconds) });
}

export const skipRest = (): void => write(null);

let watching = false;
/** Écran en veille pendant un repos : l'heure de fin part au serveur ; au retour, elle est annulée. */
export function watchVisibility(): void {
  if (watching || typeof document === 'undefined') return;
  watching = true;
  prepareRestPush();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (rest && rest.endAt > Date.now() + 2000) armRest(rest.endAt);
    } else armRest(null);
  });
}

/** Le repos en cours et les secondes restantes, rafraîchies chaque seconde ; signal à la fin. */
export function useRest(): { rest: Rest | null; left: number } {
  const [, tick] = useState(0);
  useEffect(() => {
    watchVisibility();
    const l = () => tick((n) => n + 1);
    listeners.add(l);
    const t = setInterval(() => {
      if (rest && rest.endAt <= Date.now()) {
        signal();
        write(null);
      }
      l();
    }, 250);
    return () => {
      listeners.delete(l);
      clearInterval(t);
    };
  }, []);
  return { rest, left: rest ? Math.max(0, Math.ceil((rest.endAt - Date.now()) / 1000)) : 0 };
}

let audio: AudioContext | null = null;
/** Le son doit être « débloqué » par un geste de l'utilisateur (règle des navigateurs) : fait à chaque validation. */
function unlockAudio() {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
  } catch {
    audio = null;
  }
}

/** Deux bips courts et une vibration : la fin d'un repos, d'une minute d'EMOM, d'un décompte. */
export function signal(): void {
  try {
    navigator.vibrate?.([180, 90, 180]);
  } catch {
    /* pas de vibration */
  }
  if (!audio || document.visibilityState !== 'visible') return;
  const now = audio.currentTime;
  for (const at of [0, 0.22]) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, now + at);
    gain.gain.exponentialRampToValueAtTime(0.25, now + at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.16);
    osc.connect(gain).connect(audio.destination);
    osc.start(now + at);
    osc.stop(now + at + 0.18);
  }
}

/** L'écran reste allumé pendant la séance (redemandé au retour sur l'app). */
export function useWakeLock(on: boolean): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!on || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let alive = true;
    const request = async () => {
      try {
        lock = await navigator.wakeLock.request('screen');
        if (!alive) return void lock.release();
        setHeld(true);
        lock.addEventListener('release', () => setHeld(false));
      } catch {
        setHeld(false);
      }
    };
    const onVisible = () => document.visibilityState === 'visible' && void request();
    void request();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release();
    };
  }, [on]);
  return held;
}

/** Un chrono qui part d'une heure gardée sur l'appareil (EMOM, AMRAP, décompte) : survit à un rechargement. */
export function useClock(key: string | null): { startedAt: number | null; now: number; start: () => void; stop: () => void } {
  const storeKey = key ? `mylife:perf:clock:${key}` : null;
  const [startedAt, setStartedAt] = useState<number | null>(() => {
    if (!storeKey) return null;
    try {
      const v = Number(localStorage.getItem(storeKey));
      return Number.isFinite(v) && v > 0 ? v : null;
    } catch {
      return null;
    }
  });
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (startedAt === null) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [startedAt]);
  const save = (v: number | null) => {
    setStartedAt(v);
    if (!storeKey) return;
    try {
      if (v) localStorage.setItem(storeKey, String(v));
      else localStorage.removeItem(storeKey);
    } catch {
      /* stockage indisponible */
    }
  };
  return {
    startedAt,
    now,
    start: () => {
      unlockAudio();
      save(Date.now());
    },
    stop: () => save(null),
  };
}
