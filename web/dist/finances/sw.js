// L'app MyFinances d'avant est retirée (ses adresses sont servies par la coquille, module à /argent).
// Ce service worker remplace le sien sur les appareils qui l'avaient : il vide SES caches (ceux nommés d'après son
// adresse, /finances/ ; jamais ceux de la coquille ni des autres apps, qui partagent l'origine), se désinscrit et
// recharge les pages ouvertes, qui arrivent alors à la coquille.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.includes(self.registration.scope)) await caches.delete(key);
      await self.registration.unregister();
      for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url);
    })(),
  );
});
