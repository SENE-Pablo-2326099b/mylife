/* Rappel du dimanche (Web Push), chargé par le service worker de l'accueil (workbox importScripts).
   Le message est générique : le serveur ne sait rien des données. */
self.addEventListener('push', (event) => {
  let data = { title: 'MyLife', body: '', url: '/' };
  try {
    data = { ...data, ...(event.data ? event.data.json() : {}) };
  } catch {
    /* message illisible : texte par défaut */
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
