/**
 * La lumière du verre (intensités « subtil » et « prononcé ») : une seule source de lumière pour tout l'écran, posée
 * sur la racine, que toutes les plaques partagent. Leurs arêtes, leurs reflets et leurs franges colorées bougent donc
 * ensemble, comme un même verre sous une même lumière :
 * - `--la` : l'angle d'où vient la lumière (arêtes et franges) ;
 * - `--lx` / `--ly` : où tombe le reflet dans chaque plaque ;
 * - `--sx` / `--sy` : le décalage des franges colorées sur l'épaisseur du verre.
 * La lumière suit l'inclinaison du téléphone quand il la donne, sinon la souris, et à défaut ondule au défilement.
 * Au toucher, la plaque visée s'éclaire sous le doigt (`--mx` / `--my` / `--gl`), puis s'éteint en fondu.
 * Rien ne bouge avec « sobre », sur un appareil lent ou si le système demande moins d'animations.
 */

const TILT_KEY = 'mylife:v5:tilt';
const REST = { a: 135, x: 22, y: 0 };
let target = { ...REST };
let current = { ...REST };
let frame = 0;
let started = false;
let tilted = false;
let lit: HTMLElement | null = null;

const root = () => document.documentElement;
const live = () => {
  const g = root().dataset.glass;
  return (g === 'subtil' || g === 'prononce') && !root().classList.contains('no-blur') && !matchMedia('(prefers-reduced-motion: reduce)').matches;
};
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function paint(): void {
  frame = 0;
  current = { a: current.a + (target.a - current.a) * 0.16, x: current.x + (target.x - current.x) * 0.16, y: current.y + (target.y - current.y) * 0.16 };
  const s = root().style;
  const rad = (current.a * Math.PI) / 180;
  s.setProperty('--la', `${current.a.toFixed(1)}deg`);
  s.setProperty('--lx', `${current.x.toFixed(1)}%`);
  s.setProperty('--ly', `${current.y.toFixed(1)}%`);
  // L'arête éclairée est celle qui fait face à la lumière : le décalage part dans cette direction.
  s.setProperty('--sx', `${(-Math.sin(rad) * 1.6).toFixed(2)}px`);
  s.setProperty('--sy', `${(Math.cos(rad) * 1.6).toFixed(2)}px`);
  if (Math.abs(target.a - current.a) > 0.2 || Math.abs(target.x - current.x) > 0.2 || Math.abs(target.y - current.y) > 0.2) frame = requestAnimationFrame(paint);
}

function aim(next: typeof target): void {
  target = { a: clamp(next.a, 60, 210), x: clamp(next.x, 4, 96), y: clamp(next.y, -12, 70) };
  if (!frame && live()) frame = requestAnimationFrame(paint);
}

function onTilt(e: DeviceOrientationEvent): void {
  if (e.beta === null || e.gamma === null) return;
  tilted = true;
  // Téléphone tenu à environ 45° : c'est la position de repos ; pencher le fait tourner sous la lumière.
  const side = clamp(e.gamma, -40, 40);
  const front = clamp(e.beta - 45, -35, 35);
  aim({ a: REST.a - side * 1.7 + front * 0.6, x: 50 - side * 1.1, y: 18 + front * 0.9 });
}

/** L'inclinaison : à demander sur iPhone, lors d'un geste (le choix « Prononcé », ou un toucher après un accord). */
export async function askTiltPermission(): Promise<void> {
  const D = (globalThis as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
  if (!D?.requestPermission) return;
  try {
    const answer = await D.requestPermission();
    localStorage.setItem(TILT_KEY, answer);
  } catch {
    /* refusé ou hors geste : la lumière suit le défilement */
  }
}

function plateAt(t: EventTarget | null): HTMLElement | null {
  if (!(t instanceof Element) || t.closest('[role="dialog"]')) return null;
  return t.closest('.glass, .card-module') as HTMLElement | null;
}

function light(el: HTMLElement | null, x: number, y: number): void {
  if (lit && lit !== el) lit.style.setProperty('--gl', '0');
  lit = el;
  if (!el || !live()) return;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--mx', `${Math.round(x - r.left)}px`);
  el.style.setProperty('--my', `${Math.round(y - r.top)}px`);
  el.style.setProperty('--gl', '1');
}

function dim(): void {
  lit?.style.setProperty('--gl', '0');
  lit = null;
}

export function startGlassLight(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('deviceorientation', onTilt, { passive: true });
  window.addEventListener(
    'scroll',
    () => {
      if (lit) dim();
      if (!tilted) aim({ a: REST.a + Math.sin(window.scrollY / 260) * 28, x: REST.x + Math.sin(window.scrollY / 400) * 18, y: REST.y + 8 });
    },
    { passive: true },
  );
  document.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType !== 'mouse') return;
      if (!tilted) aim({ a: REST.a - (e.clientX / innerWidth - 0.5) * 70, x: (e.clientX / innerWidth) * 100, y: (e.clientY / innerHeight) * 50 });
      light(plateAt(e.target), e.clientX, e.clientY);
    },
    { passive: true },
  );
  document.addEventListener(
    'pointerdown',
    (e) => {
      light(plateAt(e.target), e.clientX, e.clientY);
      // Accord déjà donné sur un iPhone : le renouveler au premier toucher, sans nouvelle question.
      if (!tilted && localStorage.getItem(TILT_KEY) === 'granted') void askTiltPermission();
    },
    { passive: true },
  );
  const release = (e: PointerEvent) => e.pointerType !== 'mouse' && dim();
  document.addEventListener('pointerup', release, { passive: true });
  document.addEventListener('pointercancel', release, { passive: true });
  document.documentElement.addEventListener('pointerleave', dim, { passive: true });
  paint();
}
