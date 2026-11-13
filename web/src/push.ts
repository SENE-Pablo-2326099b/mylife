import { currentSession, webPlatform } from './vendor/mylife-sync/web';

/**
 * Notifications côté appareil : abonnement Web Push du navigateur, envoyé au serveur (/api/push), pour les rappels
 * écrits par l'appareil (reminders.ts : le serveur ne reçoit que des heures de réveil). Le rappel du dimanche est parti
 * avec le bilan de la semaine (V5).
 * Sur iPhone, seulement dans l'app installée (iOS 16.4 ou plus récent).
 */

export const pushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const call = <T>(body: Record<string, unknown>) => webPlatform.api.call<T>('/api/push', body, currentSession()?.token);

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4);
  const raw = atob((b64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Abonne cet appareil (demande la permission si besoin) ; `weekly` : avec le rappel du dimanche. Renvoie l'adresse. */
export async function ensureSubscription(weekly: boolean): Promise<string> {
  const reg = await navigator.serviceWorker.ready;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications refusées : autorise-les dans les réglages du navigateur.');
  const { publicKey } = await call<{ publicKey: string | null }>({ action: 'key' });
  if (!publicKey) throw new Error('Les notifications ne sont pas encore activées sur ce serveur.');
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await call({ action: 'subscribe', endpoint: json.endpoint, keys: json.keys, weekly });
  if (weekly) await call({ action: 'weekly', endpoint: json.endpoint, on: true });
  return json.endpoint;
}

/** L'adresse d'abonnement de cet appareil, s'il est abonné. */
export async function currentEndpoint(): Promise<string | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration('/');
  return (await reg?.pushManager.getSubscription())?.endpoint ?? null;
}

/** Les heures de réveil de cet appareil (minutes UTC), seules informations envoyées pour ses rappels. */
export async function sendWakeups(endpoint: string, minutes: number[]): Promise<void> {
  await call({ action: 'wakeups', endpoint, minutes });
}
