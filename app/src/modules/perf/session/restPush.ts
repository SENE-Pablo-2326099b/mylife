import { currentSession, webPlatform } from '@mylife/core/web';

/**
 * La notification de fin de repos (P3), sur cet appareil : quand l'écran se met en veille pendant un repos, l'heure de
 * fin part au serveur (rien d'autre) ; au retour sur l'app, elle est annulée. Le texte est écrit par le service worker
 * de l'accueil. Choix gardé sur l'appareil (un abonnement par navigateur). Sur iPhone : dans l'app installée seulement.
 */
const KEY = 'mylife:perf:repos-notif';

export const restPushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export function restPushOn(): boolean {
  try {
    return restPushSupported() && localStorage.getItem(KEY) === '1' && Notification.permission === 'granted';
  } catch {
    return false;
  }
}

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4);
  const raw = atob((b64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

let endpoint: string | null = null;

/** Abonne cet appareil (demande la permission). */
export async function enableRestPush(): Promise<void> {
  const token = currentSession()?.token;
  if (!token) throw new Error('Connecte-toi d’abord.');
  const reg = await navigator.serviceWorker.ready;
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications refusées : autorise-les dans les réglages du navigateur.');
  const { publicKey } = await webPlatform.api.call<{ publicKey: string | null }>('/api/push', { action: 'key' });
  if (!publicKey) throw new Error('Les notifications ne sont pas encore activées sur ce serveur.');
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await webPlatform.api.call('/api/push', { action: 'subscribe', endpoint: json.endpoint, keys: json.keys, weekly: false }, token);
  endpoint = json.endpoint;
  localStorage.setItem(KEY, '1');
}

export function disableRestPush(): void {
  armRest(null);
  try {
    localStorage.setItem(KEY, '0');
  } catch {
    /* stockage indisponible */
  }
}

/** À l'ouverture de la séance : l'adresse d'abonnement, prête avant que l'écran se mette en veille. */
export function prepareRestPush(): void {
  if (!restPushOn() || endpoint) return;
  void navigator.serviceWorker
    .getRegistration('/')
    .then((reg) => reg?.pushManager.getSubscription())
    .then((sub) => {
      endpoint = sub?.endpoint ?? null;
    })
    .catch(() => undefined);
}

let armed = false;

/** L'heure de fin du repos (écran en veille), ou `null` pour l'annuler (retour sur l'app). */
export function armRest(at: number | null): void {
  if (at === null ? !armed : !restPushOn()) return;
  const token = currentSession()?.token;
  if (!endpoint || !token) return;
  armed = at !== null;
  // keepalive : la requête part même si la page s'endort aussitôt.
  void fetch('/api/push', {
    method: 'POST',
    keepalive: true,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: 'rest', endpoint, at: at === null ? null : Math.round(at) }),
  }).catch(() => undefined);
}
