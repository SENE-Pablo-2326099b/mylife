/**
 * Cap du téléphone à partir des capteurs d'orientation.
 *
 * - Cap absolu (boussole) : vient du magnétomètre fusionné par le système. iOS le donne directement
 *   (`webkitCompassHeading`, déjà compensé en inclinaison) ; Chrome Android via l'événement
 *   `deviceorientationabsolute` (alpha/beta/gamma dans le repère terrestre).
 * - Un `deviceorientation` non absolu (ou le gyroscope seul) ne donne que des variations : il ne dit
 *   pas où est le nord. On ne s'en sert jamais pour orienter la flèche.
 * - Le cap de déplacement GPS (`coords.heading`) indique où l'on marche, pas où pointe le téléphone.
 *
 * Le nord magnétique diffère du nord géographique de quelques degrés en Europe : écart négligé,
 * bien inférieur à la précision d'une boussole de téléphone au milieu des structures métalliques.
 */
import { deltaDeg, normalizeDeg } from './geo';

const rad = (d: number) => (d * Math.PI) / 180;

/**
 * Cap (degrés depuis le nord, sens horaire) de la direction « devant moi » pour un téléphone tenu
 * à plat ou relevé, à partir des angles d'Euler W3C (repère terrestre : x est, y nord, z haut).
 *
 * On additionne l'axe du haut de l'écran (y) et l'axe qui sort du dos (−z) : à plat, seul le premier
 * est horizontal ; relevé face à soi, seul le second l'est ; entre les deux, ils pointent dans la même
 * direction. Pas de saut quand on relève le téléphone. Renvoie null quand le cap n'est pas défini
 * (téléphone tenu tête en bas, écran vers le sol…).
 */
export function headingFromEuler(alpha: number, beta: number, gamma: number, screenAngle = 0): number | null {
  if (![alpha, beta, gamma].every(Number.isFinite)) return null;
  const [sA, cA, sB, cB, sG, cG] = [Math.sin(rad(alpha)), Math.cos(rad(alpha)), Math.sin(rad(beta)), Math.cos(rad(beta)), Math.sin(rad(gamma)), Math.cos(rad(gamma))];
  // Colonnes de la matrice de rotation R = Rz(α)·Rx(β)·Ry(γ) : axes y et z de l'appareil.
  const yE = -cB * sA;
  const yN = cA * cB;
  const zE = cA * sG + cG * sA * sB;
  const zN = sA * sG - cA * cG * sB;
  const east = yE - zE;
  const north = yN - zN;
  if (Math.hypot(east, north) < 0.2) return null;
  return normalizeDeg((Math.atan2(east, north) * 180) / Math.PI + screenAngle);
}

/**
 * Lissage circulaire de la boussole : réactif aux vrais mouvements, calme sur le bruit.
 * La constante de temps glisse de `slowTau` (petits écarts : tremblement de la main, bruit
 * magnétique) à `fastTau` (grands écarts : on tourne sur soi). Pas de palier, donc pas de traîne.
 */
export class HeadingFilter {
  private value: number | null = null;
  private at = 0;
  constructor(
    private fastTau = 0.07,
    private slowTau = 0.28,
  ) {}

  push(heading: number, t: number): number {
    if (this.value === null) {
      this.value = normalizeDeg(heading);
      this.at = t;
      return this.value;
    }
    const dt = Math.min(1, Math.max(0, (t - this.at) / 1000));
    this.at = t;
    const d = deltaDeg(this.value, heading);
    const x = Math.min(1, Math.max(0, (Math.abs(d) - 4) / 16));
    const tau = this.slowTau + (this.fastTau - this.slowTau) * x;
    const k = 1 - Math.exp(-dt / tau);
    this.value = normalizeDeg(this.value + d * k);
    return this.value;
  }

  get current(): number | null {
    return this.value;
  }

  reset(): void {
    this.value = null;
  }
}

/**
 * Instabilité de la boussole : écart quadratique moyen (degrés), sur la dernière seconde, entre
 * chaque mesure brute et le cap lissé. Tourner sur soi ne compte pas (le lissage suit) ; des sauts
 * incohérents oui. Au-delà de ~20°, la boussole est perturbée (structure métallique, aimant,
 * calibration à refaire).
 */
export class JitterMeter {
  private samples: { d: number; t: number }[] = [];
  constructor(private windowMs = 1000) {}

  push(raw: number, smoothed: number, t: number): void {
    this.samples.push({ d: deltaDeg(smoothed, raw), t });
    while (this.samples.length && t - this.samples[0]!.t > this.windowMs) this.samples.shift();
  }

  /** null tant qu'il n'y a pas assez de mesures pour juger. */
  get spreadDeg(): number | null {
    if (this.samples.length < 5) return null;
    return Math.sqrt(this.samples.reduce((s, x) => s + x.d * x.d, 0) / this.samples.length);
  }

  reset(): void {
    this.samples = [];
  }
}
