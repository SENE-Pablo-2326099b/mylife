import { currentSession, webPlatform } from './vendor/mylife-sync/web';

/**
 * Le rappel du dimanche côté appareil : abonnement Web Push du navigateur, envoyé au serveur (/api/push).
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

/** Abonné sur cet appareil ? (null : le serveur n'a pas activé les notifications) */
export async function weeklyStatus(): Promise<boolean | null> {
  if (!pushSupported()) return false;
  const { publicKey } = await call<{ publicKey: string | null }>({ action: 'key' });
  if (!publicKey) return null;
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return false;
  const r = await call<{ subscribed: boolean }>({ action: 'status', endpoint: sub.endpoint });
  return r.subscribed;
}

export async function setWeekly(on: boolean): Promise<void> {
  const reg = await navigator.serviceWorker.ready;
  if (!on) {
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await call({ action: 'unsubscribe', endpoint: sub.endpoint });
      await sub.unsubscribe();
    }
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications refusées : autorise-les dans les réglages du navigateur.');
  const { publicKey } = await call<{ publicKey: string | null }>({ action: 'key' });
  if (!publicKey) throw new Error('Les notifications ne sont pas encore activées sur ce serveur.');
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await call({ action: 'subscribe', endpoint: json.endpoint, keys: json.keys });
}
