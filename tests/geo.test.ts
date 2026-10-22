import { describe, expect, it } from 'vitest';
import { arrowRotationDeg, bearingDeg, cardinal, deltaDeg, distanceM, formatDistance, isValidLatLon, normalizeDeg } from '../src/domain/geo';

const paris = { lat: 48.8566, lon: 2.3522 };
const london = { lat: 51.5074, lon: -0.1278 };

describe('distance', () => {
  it('Paris → Londres ≈ 344 km', () => {
    expect(distanceM(paris, london) / 1000).toBeCloseTo(343.5, 0);
  });
  it('nulle pour deux positions identiques', () => {
    expect(distanceM(paris, paris)).toBe(0);
  });
  it('100 m vers le nord ≈ 0,000899° de latitude', () => {
    expect(distanceM(paris, { lat: paris.lat + 0.000899, lon: paris.lon })).toBeCloseTo(100, 0);
  });
  it('symétrique', () => {
    expect(distanceM(paris, london)).toBeCloseTo(distanceM(london, paris), 6);
  });
});

describe('relèvement', () => {
  const d = 0.001;
  it.each([
    ['nord', { lat: paris.lat + d, lon: paris.lon }, 0],
    ['est', { lat: paris.lat, lon: paris.lon + d }, 90],
    ['sud', { lat: paris.lat - d, lon: paris.lon }, 180],
    ['ouest', { lat: paris.lat, lon: paris.lon - d }, 270],
  ])('vers le %s', (_n, to, expected) => {
    expect(bearingDeg(paris, to)).toBeCloseTo(expected, 0);
  });
  it('nord-est à cette latitude : un peu plus de 45° en degrés égaux', () => {
    const b = bearingDeg(paris, { lat: paris.lat + d, lon: paris.lon + d });
    expect(b).toBeGreaterThan(30);
    expect(b).toBeLessThan(45);
  });
  it('Paris → Londres ≈ 330°', () => {
    expect(bearingDeg(paris, london)).toBeCloseTo(330, -1);
  });
});

describe('angles', () => {
  it('normalise dans [0, 360)', () => {
    expect(normalizeDeg(360)).toBe(0);
    expect(normalizeDeg(-10)).toBe(350);
    expect(normalizeDeg(725)).toBe(5);
    expect(normalizeDeg(-0)).toBe(0);
  });
  it('plus court écart, passage par le nord', () => {
    expect(deltaDeg(350, 10)).toBe(20);
    expect(deltaDeg(10, 350)).toBe(-20);
    expect(deltaDeg(0, 180)).toBe(180);
    expect(deltaDeg(90, 90)).toBe(0);
  });
  it('rotation de la flèche = relèvement − cap', () => {
    expect(arrowRotationDeg(90, 0)).toBe(90); // ami à l'est, je regarde au nord : flèche à droite
    expect(arrowRotationDeg(90, 90)).toBe(0); // je regarde vers lui : droit devant
    expect(arrowRotationDeg(10, 350)).toBe(20);
    expect(arrowRotationDeg(350, 10)).toBe(340); // un peu à gauche
    expect(arrowRotationDeg(0, 180)).toBe(180); // derrière moi
  });
  it('points cardinaux', () => {
    expect(cardinal(0)).toBe('nord');
    expect(cardinal(44)).toBe('nord-est');
    expect(cardinal(359)).toBe('nord');
    expect(cardinal(200)).toBe('sud');
    expect(cardinal(-90)).toBe('ouest');
  });
});

describe('affichage des distances (jamais de fausse précision)', () => {
  it('arrondit selon la distance', () => {
    expect(formatDistance(23)).toBe('25\u00a0m');
    expect(formatDistance(2)).toBe('5\u00a0m');
    expect(formatDistance(137)).toBe('140\u00a0m');
    expect(formatDistance(642)).toBe('650\u00a0m');
    expect(formatDistance(1530)).toBe('1,5\u00a0km');
    expect(formatDistance(12_345)).toBe('12,3\u00a0km');
  });
  it('arrondit plus grossièrement quand les positions sont imprécises', () => {
    expect(formatDistance(137, 60)).toBe('150\u00a0m');
    expect(formatDistance(137, 200)).toBe('100\u00a0m');
  });
  it('valide les coordonnées', () => {
    expect(isValidLatLon({ lat: 48, lon: 2 })).toBe(true);
    expect(isValidLatLon({ lat: 91, lon: 2 })).toBe(false);
    expect(isValidLatLon({ lat: NaN, lon: 2 })).toBe(false);
    expect(isValidLatLon(null)).toBe(false);
  });
});
