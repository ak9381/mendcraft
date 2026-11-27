// Emergency replacement for /sw.js. NOT registered or used anywhere. If the
// service worker ever traps users on a bad build, deploy this file's contents
// AS /sw.js: browsers re-check /sw.js on navigation (Firebase serves it
// no-cache), install this worker, and it deletes every Mendcraft cache,
// unregisters itself and reloads open windows straight from the network.
self.addEventListener('install', () => { self.skipWaiting(); });

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => /^mendcraft-/.test(k)).map((k) => caches.delete(k)));
    await self.registration.unregister();
    const windows = await self.clients.matchAll({ type: 'window' });
    for (const w of windows) { try { await w.navigate(w.url); } catch { /* best effort */ } }
  })());
});
