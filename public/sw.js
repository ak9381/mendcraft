// Mendcraft PWA service worker.
//
// App files (same origin) are NETWORK-FIRST, so a new deploy can never be
// blocked by a stale cached bundle: online the network always wins and the
// cache is refreshed in the background; the cache is read only when the
// network fails. On install it keeps a copy of the whole built app (the list
// is filled in by `vite build`, src/offline/swBuild.ts), so after ONE online
// load an offline reload still opens the canvas with its stored boards and
// language pack.
//
// The MediaPipe hand / face tracking files (exact, versioned cross-origin
// URLs — src/input/trackingAssets.ts) are CACHE-FIRST: they never change under
// one URL, and with a copy here hand tracking still starts offline.
//
// Nothing else cross-origin is touched: Firebase, Gemini (Firebase AI Logic),
// App Check, reCAPTCHA, Firestore, Spotify all go straight to the network and
// are never stored. Firebase Hosting's reserved /__/ paths are left alone too.

// Filled in at build time; in `vite` dev this worker is never registered.
const BUILD = '__MC_BUILD__';
const PRECACHE = /*__MC_PRECACHE__*/[];
const TRACKING = /*__MC_TRACKING__*/[];
const TRACKING_CACHE = '__MC_TRACKING_CACHE__';

const SHELL_CACHE = `mendcraft-shell-${BUILD}`;
const OURS = /^mendcraft-/;
const abs = (u) => new URL(u, self.location.origin).href;
const TRACKING_SET = new Set(TRACKING.map(abs));

async function putIfOk(cacheName, key, res) {
  if (!res || !res.ok) return;
  const c = await caches.open(cacheName);
  await c.put(key, res);
}

self.addEventListener('install', (event) => {
  // Activate immediately so the newest SW controls pages without a double reload.
  self.skipWaiting();
  // Keep the whole app for an offline reload. Best effort, one file at a time:
  // a missing file never fails the install.
  event.waitUntil((async () => {
    await Promise.all(PRECACHE.map(async (u) => {
      try {
        const res = await fetch(new Request(abs(u), { cache: 'reload', credentials: 'same-origin' }));
        if (res && res.ok && (res.type === 'basic' || res.type === 'default' || !res.type)) await putIfOk(SHELL_CACHE, abs(u), res);
      } catch { /* offline at install: the runtime cache fills it later */ }
    }));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Drop older Mendcraft caches (earlier builds, older MediaPipe); keep
    // anything that is not ours.
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => OURS.test(k) && k !== SHELL_CACHE && k !== TRACKING_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
    // Then fetch the tracking files once, so hands start offline even if the
    // page never turned them on while online.
    const c = await caches.open(TRACKING_CACHE);
    for (const u of TRACKING_SET) {
      try {
        if (await c.match(u)) continue;
        const res = await fetch(u, { mode: 'cors', credentials: 'omit' });
        if (res && res.ok) await c.put(u, res);
      } catch { /* offline: the page's own load fills it later */ }
    }
  })());
});

async function trackingFile(url) {
  const c = await caches.open(TRACKING_CACHE);
  const hit = await c.match(url);
  if (hit) return hit;
  const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
  if (res && res.ok) c.put(url, res.clone()).catch(() => undefined);
  return res;
}

async function offlineCopy(req, isNavigate) {
  const shell = await caches.open(SHELL_CACHE);
  const exact = (await shell.match(req)) || (await caches.match(req));
  if (exact) return exact;
  if (!isNavigate) return undefined;
  const path = new URL(req.url).pathname;
  const fallbacks = [
    ...(/^\/canvas(\.html)?\/?$/.test(path) ? ['/canvas.html', '/canvas'] : []),
    '/', '/phone',
  ];
  const loose = await shell.match(req, { ignoreSearch: true });
  if (loose) return loose;
  for (const f of fallbacks) {
    const hit = await shell.match(abs(f));
    if (hit) return hit;
  }
  return undefined;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  url.hash = '';

  if (url.origin !== self.location.origin) {
    // Only the exact versioned tracking files; every other cross-origin call
    // (Firebase, Gemini, App Check, Firestore, CDNs, Spotify) is not ours.
    if (TRACKING_SET.has(url.href)) event.respondWith(trackingFile(url.href));
    return;
  }
  if (url.pathname.startsWith('/__/')) return; // Firebase Hosting reserved (init.json, auth)

  // HTML must never be served from the HTTP cache: a stale canvas.html would
  // carry the OLD response headers (e.g. a CSP without 'wasm-unsafe-eval') for
  // up to an hour and silently break MediaPipe. Revalidate with the server.
  const isNavigate = req.mode === 'navigate';
  const isHtml = /\.html$/.test(url.pathname);

  event.respondWith((async () => {
    try {
      // A navigate-mode Request cannot be reconstructed (mode 'navigate' is
      // not constructible), so fetch by URL for navigations.
      const res = isNavigate
        ? await fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
        : isHtml
        ? await fetch(new Request(req, { cache: 'no-cache' }))
        : await fetch(req);
      // Keep a copy of OK responses for offline. Never blocks the response.
      if (res && res.ok && (res.type === 'basic' || res.type === 'default' || !res.type)) {
        putIfOk(SHELL_CACHE, req, res.clone()).catch(() => undefined);
      }
      return res;
    } catch (err) {
      const copy = await offlineCopy(req, isNavigate);
      if (copy) return copy;
      throw err;
    }
  })());
});
