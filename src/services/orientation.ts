/**
 * Boussole : cap absolu de l'appareil, lissé, publié hors de React (la flèche le lit à chaque image).
 *
 * Sources, par ordre de préférence :
 * - iOS (Safari) : `webkitCompassHeading`, après autorisation donnée par un geste (bouton) ;
 * - Chrome Android : `deviceorientationabsolute` (repère terrestre) ;
 * - `deviceorientation` marqué `absolute: true` (Firefox Android).
 * Un `deviceorientation` relatif (ou le gyroscope seul) ne dit pas où est le nord : il est ignoré, et la
 * boussole est déclarée indisponible. On ne fait jamais semblant.
 */
import { observable } from '../lib/observable';
import { HeadingFilter, headingFromEuler, JitterMeter } from '../domain/heading';

export type CompassStatus = 'off' | 'needs-permission' | 'starting' | 'ok' | 'unstable' | 'denied' | 'unavailable';

export interface CompassState {
  status: CompassStatus;
  source: 'ios' | 'absolute' | null;
  /** Précision annoncée par iOS (°), sinon null. */
  accuracy: number | null;
}

export const compass = observable<CompassState>({ status: 'off', source: null, accuracy: null });

const filter = new HeadingFilter();
const jitter = new JitterMeter();
const headingListeners = new Set<(h: number) => void>();
let users = 0;
let attached: (() => void) | null = null;
let startTimer: ReturnType<typeof setTimeout> | null = null;
let lastEventAt = 0;

/** Dernier cap lissé (° depuis le nord), ou null. */
export const currentHeading = () => filter.current;

export function onHeading(fn: (h: number) => void): () => void {
  headingListeners.add(fn);
  return () => void headingListeners.delete(fn);
}

type IosOrientationEvent = DeviceOrientationEvent & { webkitCompassHeading?: number; webkitCompassAccuracy?: number };
type PermissionApi = { requestPermission?: () => Promise<'granted' | 'denied'> };

const screenAngle = () => (typeof screen !== 'undefined' && screen.orientation ? screen.orientation.angle : 0) || 0;

/** iOS 13+ : l'accès aux capteurs passe par un geste de l'utilisateur. */
export const compassNeedsGesture = () => typeof DeviceOrientationEvent !== 'undefined' && typeof (DeviceOrientationEvent as unknown as PermissionApi).requestPermission === 'function';

function publish(raw: number, source: 'ios' | 'absolute', accuracy: number | null) {
  const t = performance.now();
  lastEventAt = t;
  const h = filter.push(raw, t);
  jitter.push(raw, h, t);
  const spread = jitter.spreadDeg;
  const unstable = (spread != null && spread > 20) || (accuracy != null && (accuracy < 0 || accuracy > 35));
  const status: CompassStatus = unstable ? 'unstable' : 'ok';
  const s = compass.get();
  if (s.status !== status || s.source !== source || (accuracy != null && Math.abs((s.accuracy ?? 0) - accuracy) >= 5)) compass.set({ status, source, accuracy });
  headingListeners.forEach((l) => l(h));
}

function handle(e: Event) {
  const ev = e as IosOrientationEvent;
  if (typeof ev.webkitCompassHeading === 'number' && Number.isFinite(ev.webkitCompassHeading)) {
    publish(ev.webkitCompassHeading + screenAngle(), 'ios', typeof ev.webkitCompassAccuracy === 'number' ? ev.webkitCompassAccuracy : null);
    return;
  }
  const absolute = e.type === 'deviceorientationabsolute' || ev.absolute === true;
  if (!absolute || ev.alpha == null || ev.beta == null || ev.gamma == null) return;
  const h = headingFromEuler(ev.alpha, ev.beta, ev.gamma, screenAngle());
  if (h != null) publish(h, 'absolute', null);
}

function attach() {
  if (attached || typeof window === 'undefined') return;
  const type = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
  window.addEventListener(type, handle);
  // Un capteur qui se tait (page figée, capteur coupé) : on ne garde pas un cap périmé comme s'il était vivant.
  const watchdog = setInterval(() => {
    const s = compass.get();
    if ((s.status === 'ok' || s.status === 'unstable') && performance.now() - lastEventAt > 3000) {
      filter.reset();
      jitter.reset();
      arm();
    }
  }, 1000);
  attached = () => {
    window.removeEventListener(type, handle);
    clearInterval(watchdog);
  };
  arm();
}

/**
 * En attente d'un cap. Sans mesure absolue au bout de 2,5 s : soit le navigateur attend un geste pour
 * ouvrir les capteurs (iOS ; on propose alors le bouton), soit il n'y a pas de boussole utilisable.
 */
function arm() {
  compass.set({ status: 'starting', source: null, accuracy: null });
  lastEventAt = 0;
  if (startTimer) clearTimeout(startTimer);
  startTimer = setTimeout(() => {
    if (lastEventAt || compass.get().status !== 'starting') return;
    compass.set({ status: compassNeedsGesture() && !permissionGranted ? 'needs-permission' : 'unavailable', source: null, accuracy: null });
  }, 2500);
}

function detach() {
  attached?.();
  attached = null;
  if (startTimer) clearTimeout(startTimer);
  startTimer = null;
  filter.reset();
  jitter.reset();
}

/**
 * L'écran de navigation demande la boussole ; renvoie de quoi la libérer (capteurs éteints). On écoute
 * tout de suite : certains navigateurs exposent `requestPermission` sans exiger de geste (Chrome).
 */
export function holdCompass(): () => void {
  users++;
  if (typeof DeviceOrientationEvent === 'undefined') compass.set({ status: 'unavailable', source: null, accuracy: null });
  else attach();
  return () => {
    users = Math.max(0, users - 1);
    if (!users) {
      detach();
      compass.set((s) => (s.status === 'denied' ? s : { status: 'off', source: null, accuracy: null }));
    }
  };
}

let permissionGranted = false;

/** À appeler dans le gestionnaire d'un toucher (exigence d'iOS). */
export async function requestCompassPermission(): Promise<void> {
  try {
    const r = await (DeviceOrientationEvent as unknown as PermissionApi).requestPermission!();
    if (r === 'granted') {
      permissionGranted = true;
      if (users && attached) arm();
      else if (users) attach();
    } else compass.set({ status: 'denied', source: null, accuracy: null });
  } catch {
    compass.set({ status: 'denied', source: null, accuracy: null });
  }
}
