/**
 * Géolocalisation de l'appareil. Le GPS n'est allumé que si quelqu'un en a besoin (partage actif ou
 * écran de navigation ouvert) ET que l'app est visible : un navigateur ne localise de toute façon pas
 * une page en arrière-plan de façon fiable, et c'est la première source de consommation.
 */
import { observable } from '../lib/observable';
import type { Fix } from '../domain/status';

export type LocationStatus = 'off' | 'locating' | 'ok' | 'denied' | 'unavailable' | 'insecure';

export interface LocationState {
  status: LocationStatus;
  /** Autorisation du site, quand le navigateur sait la dire ('unknown' sinon, ex. anciens Safari). */
  permission: 'granted' | 'prompt' | 'denied' | 'unknown';
  fix: Fix | null;
  /** Message lisible en cas de problème. */
  error: string | null;
}

export const location = observable<LocationState>({ status: 'off', permission: 'unknown', fix: null, error: null });

/** Qui a besoin du GPS, et avec quelle fraîcheur : 'navigate' (mesures rapprochées) ou 'share'. */
const needs = new Map<string, 'navigate' | 'share'>();
let watchId: number | null = null;
let watchMode: 'navigate' | 'share' | null = null;
let visible = typeof document === 'undefined' ? true : document.visibilityState === 'visible';

function wanted(): 'navigate' | 'share' | null {
  if (!visible || needs.size === 0) return null;
  return [...needs.values()].includes('navigate') ? 'navigate' : 'share';
}

function onFix(p: GeolocationPosition) {
  const c = p.coords;
  const fix: Fix = {
    lat: c.latitude,
    lon: c.longitude,
    acc: Number.isFinite(c.accuracy) ? c.accuracy : 9999,
    at: Math.min(p.timestamp || Date.now(), Date.now()),
    heading: c.heading != null && Number.isFinite(c.heading) ? c.heading : null,
    speed: c.speed != null && Number.isFinite(c.speed) ? c.speed : null,
  };
  location.set({ status: 'ok', fix, error: null, permission: 'granted' });
}

function onError(e: GeolocationPositionError) {
  if (e.code === e.PERMISSION_DENIED) {
    stopWatch();
    location.set({ status: 'denied', permission: 'denied', error: 'Localisation refusée pour ce site.' });
  } else if (e.code === e.POSITION_UNAVAILABLE) {
    location.set((s) => ({ ...s, status: s.fix ? s.status : 'unavailable', error: 'Position introuvable pour l’instant (GPS sans signal ?).' }));
  } else {
    // Délai dépassé : on continue d'attendre, la dernière position reste affichée avec son âge.
    location.set((s) => ({ ...s, status: s.fix ? s.status : 'locating', error: s.fix ? s.error : 'Recherche du signal GPS…' }));
  }
}

function stopWatch() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  watchMode = null;
}

function apply() {
  const mode = wanted();
  if (mode === watchMode) return;
  stopWatch();
  if (!mode) {
    location.set((s) => (s.status === 'denied' || s.status === 'insecure' ? s : { ...s, status: 'off' }));
    return;
  }
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    location.set({ status: 'insecure', error: 'La localisation exige une connexion sécurisée (https).' });
    return;
  }
  if (!('geolocation' in navigator)) {
    location.set({ status: 'unavailable', error: 'Ce navigateur ne donne pas accès à la localisation.' });
    return;
  }
  location.set((s) => ({ ...s, status: s.fix && s.status === 'ok' ? 'ok' : 'locating', error: null }));
  watchMode = mode;
  // Haute précision obligatoire : dans une foule, la position par antennes (centaines de mètres) ne sert à rien.
  // maximumAge laisse le système resservir une mesure récente au lieu de rallumer le GPS.
  watchId = navigator.geolocation.watchPosition(onFix, onError, { enableHighAccuracy: true, maximumAge: mode === 'navigate' ? 2000 : 10_000, timeout: 30_000 });
}

/** Déclare un besoin du GPS ; renvoie de quoi le retirer. */
export function needLocation(who: string, mode: 'navigate' | 'share'): () => void {
  needs.set(who, mode);
  apply();
  return () => {
    needs.delete(who);
    apply();
  };
}

/** Demande explicite (bouton) : utile après un refus levé dans les réglages du navigateur. */
export function retryLocation(): void {
  stopWatch();
  location.set((s) => ({ ...s, status: 'off', error: null }));
  apply();
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    visible = document.visibilityState === 'visible';
    apply();
  });
  // Autorisation retirée ou accordée dans les réglages pendant que l'app est ouverte.
  void navigator.permissions
    ?.query({ name: 'geolocation' })
    .then((p) => {
      const sync = () => {
        location.set({ permission: p.state });
        if (p.state === 'denied') {
          stopWatch();
          location.set({ status: 'denied', fix: null, error: 'Localisation refusée pour ce site.' });
        }
      };
      sync();
      p.addEventListener('change', () => {
        sync();
        if (p.state !== 'denied') retryLocation();
      });
    })
    .catch(() => undefined);
}

/** Pour les tests : remet le service à zéro. */
export function resetLocationForTests(): void {
  needs.clear();
  stopWatch();
  location.set({ status: 'off', permission: 'unknown', fix: null, error: null });
}
