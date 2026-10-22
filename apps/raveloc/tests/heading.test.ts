import { describe, expect, it } from 'vitest';
import { HeadingFilter, headingFromEuler, JitterMeter } from '../src/domain/heading';
import { deltaDeg } from '../src/domain/geo';

const close = (a: number | null, b: number, tol = 0.5) => {
  expect(a).not.toBeNull();
  expect(Math.abs(deltaDeg(a!, b))).toBeLessThan(tol);
};

describe('cap à partir des angles d’Euler (repère terrestre)', () => {
  it('à plat : cap = 360 − alpha', () => {
    close(headingFromEuler(0, 0, 0), 0);
    close(headingFromEuler(90, 0, 0), 270);
    close(headingFromEuler(270, 0, 0), 90);
    close(headingFromEuler(30, 0, 0), 330);
  });
  it('relevé face à soi (beta = 90°) : même cap que posé à plat', () => {
    for (const alpha of [0, 45, 120, 300]) close(headingFromEuler(alpha, 90, 0), (360 - alpha) % 360);
  });
  it('incliné à 45° : pas de saut entre à plat et relevé', () => {
    for (const alpha of [0, 80, 200]) close(headingFromEuler(alpha, 45, 0), (360 - alpha) % 360);
  });
  it('légèrement penché sur le côté : le cap bouge peu', () => {
    const h = headingFromEuler(0, 40, 10)!;
    expect(Math.abs(deltaDeg(0, h))).toBeLessThan(10);
  });
  it('écran en paysage : on ajoute l’angle de l’écran', () => {
    close(headingFromEuler(0, 0, 0, 90), 90);
  });
  it('cap indéfini (tête en bas, écran vers le sol) ou valeurs absentes : null', () => {
    // Haut de l'écran vers le sol, écran tourné vers le nord : on regarde vers le sud.
    close(headingFromEuler(0, -90, 0), 180);
    // Penché à −45° : l'axe du haut et celui du dos s'annulent, aucune direction « devant » fiable.
    expect(headingFromEuler(0, -45, 0)).toBeNull();
    expect(headingFromEuler(NaN, 0, 0)).toBeNull();
  });
});

describe('lissage de la boussole', () => {
  it('suit un vrai changement de cap en moins d’une demi-seconde', () => {
    const f = new HeadingFilter();
    f.push(0, 0);
    let t = 0;
    let h = 0;
    for (; t <= 500; t += 16) h = f.push(90, t);
    expect(Math.abs(deltaDeg(h, 90))).toBeLessThan(5);
  });
  it('passe par le nord sans faire le tour du cadran', () => {
    const f = new HeadingFilter();
    f.push(350, 0);
    const h = f.push(10, 100);
    expect(Math.abs(deltaDeg(350, h))).toBeLessThan(20);
    expect(deltaDeg(350, h)).toBeGreaterThan(0);
  });
  it('atténue le bruit (± 6°) autour d’un cap fixe', () => {
    const f = new HeadingFilter();
    f.push(45, 0);
    let max = 0;
    for (let i = 0, t = 0; i < 200; i++, t += 16) {
      const h = f.push(45 + (i % 2 ? 6 : -6), t + 16);
      max = Math.max(max, Math.abs(deltaDeg(45, h)));
    }
    expect(max).toBeLessThan(2.5);
  });
  it('repart de zéro après reset', () => {
    const f = new HeadingFilter();
    f.push(100, 0);
    f.reset();
    expect(f.current).toBeNull();
    expect(f.push(200, 10)).toBe(200);
  });
});

describe('instabilité de la boussole', () => {
  it('faible quand le cap est stable, forte quand il saute', () => {
    const stable = new JitterMeter();
    const noisy = new JitterMeter();
    for (let i = 0, t = 0; i < 30; i++, t += 30) {
      stable.push(90 + (i % 2), 90, t);
      noisy.push(90 + (i % 2 ? 40 : -40), 90, t);
    }
    expect(stable.spreadDeg!).toBeLessThan(2);
    expect(noisy.spreadDeg!).toBeGreaterThan(20);
  });
  it('ne juge pas sans assez de mesures', () => {
    const j = new JitterMeter();
    j.push(1, 1, 0);
    expect(j.spreadDeg).toBeNull();
  });
});
