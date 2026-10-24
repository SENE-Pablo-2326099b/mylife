/* Notifications (Web Push), chargé par le service worker de l'accueil (workbox importScripts).
   - Le rappel du dimanche : un message générique, le serveur ne sait rien des données.
   - Les rappels écrits par l'appareil (V4) : le serveur n'envoie qu'un signal vide { type: 'wake' } ; on lit ici le plan
     que l'appareil a rangé dans sa base locale (web/src/reminders.ts) et on écrit le rappel du moment. */

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('mylife-reminders', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function get(db, key) {
  return new Promise((resolve) => {
    const req = db.transaction('kv').objectStore('kv').get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(undefined);
  });
}
function put(db, key, value) {
  return new Promise((resolve) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

const pad = (n) => String(n).padStart(2, '0');

/** Les rappels du moment (20 minutes de retard au plus, 5 d'avance), pas encore montrés aujourd'hui. */
async function dueReminders(now = new Date()) {
  const db = await openDb();
  const plan = (await get(db, 'plan')) || [];
  const shown = (await get(db, 'shown')) || {};
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const bit = 1 << ((now.getDay() + 6) % 7);
  const minute = now.getHours() * 60 + now.getMinutes();
  const due = plan.filter((r) => {
    const late = (minute - r.minute + 1440) % 1440;
    return (r.days & bit) && (late <= 20 || late >= 1435) && !(r.skip || []).includes(today) && shown[r.id] !== today;
  });
  for (const r of due) shown[r.id] = today;
  if (due.length) await put(db, 'shown', shown);
  db.close();
  return due;
}

self.addEventListener('push', (event) => {
  let data = { title: 'MyLife', body: '', url: '/' };
  try {
    data = { ...data, ...(event.data ? event.data.json() : {}) };
  } catch {
    /* message illisible : texte par défaut */
  }
  if (data.type === 'wake') {
    event.waitUntil(
      dueReminders().then((due) =>
        Promise.all(due.map((r) => self.registration.showNotification(r.title, { body: r.body, icon: '/pwa-192x192.png', badge: '/pwa-192x192.png', data: { url: r.url }, tag: r.id }))),
      ),
    );
    return;
  }
  event.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: '/pwa-192x192.png', badge: '/pwa-192x192.png', data: { url: data.url }, tag: 'mylife-weekly' }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if ('focus' in c) return c.navigate(url).then((w) => (w || c).focus());
      return self.clients.openWindow(url);
    }),
  );
});
