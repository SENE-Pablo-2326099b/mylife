/**
 * Géodésie à l'échelle d'un festival : distance et relèvement entre deux positions GPS.
 *
 * Sphère de rayon moyen (6 371 km) : l'erreur (< 0,5 %) est très inférieure à celle du GPS d'un
 * téléphone dans une foule. Les angles sont en degrés, 0 = nord géographique, sens horaire.
 */

export interface LatLon {
  lat: number;
  lon: number;
}

const R = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function isValidLatLon(p: Partial<LatLon> | null | undefined): p is LatLon {
  return !!p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat!) <= 90 && Math.abs(p.lon!) <= 180;
}

/** Distance orthodromique (haversine), en mètres. */
export function distanceM(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Relèvement initial de a vers b, en degrés [0, 360) depuis le nord géographique. */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const φ1 = rad(a.lat);
  const φ2 = rad(b.lat);
  const Δλ = rad(b.lon - a.lon);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return normalizeDeg(deg(Math.atan2(y, x)));
}

/** Ramène un angle dans [0, 360). */
export function normalizeDeg(a: number): number {
  const r = a % 360;
  return r < 0 ? r + 360 : r === 0 ? 0 : r;
}

/** Plus court écart signé pour aller de `from` à `to`, dans (-180, 180]. */
export function deltaDeg(from: number, to: number): number {
  const d = normalizeDeg(to - from);
  return d > 180 ? d - 360 : d;
}

/**
 * Rotation à donner à la flèche (0 = droit devant, sens horaire) : relèvement vers l'ami moins le
 * cap vers lequel pointe le téléphone.
 */
export function arrowRotationDeg(bearingToFriend: number, deviceHeading: number): number {
  return normalizeDeg(bearingToFriend - deviceHeading);
}

const CARDINALS = ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ouest', 'ouest', 'nord-ouest'] as const;

/** « nord-est » pour 45° : quand la boussole manque, on donne la direction en mots. */
export function cardinal(bearing: number): (typeof CARDINALS)[number] {
  return CARDINALS[Math.round(normalizeDeg(bearing) / 45) % 8]!;
}

const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

/**
 * Distance arrondie à ce qu'on peut honnêtement affirmer : jamais au mètre près. Le pas grandit
 * avec la distance et ne descend jamais sous l'incertitude des deux positions.
 */
export function formatDistance(m: number, uncertaintyM = 0): string {
  const step = Math.max(m < 50 ? 5 : m < 200 ? 10 : m < 1000 ? 50 : 100, roundStep(uncertaintyM / 2));
  if (m >= 1000) return `${nf.format(Math.round(m / step) * step / 1000)} km`;
  return `${Math.max(step, Math.round(m / step) * step)} m`;
}

function roundStep(x: number): number {
  if (x <= 5) return 5;
  if (x <= 10) return 10;
  if (x <= 25) return 25;
  if (x <= 50) return 50;
  return 100;
}
