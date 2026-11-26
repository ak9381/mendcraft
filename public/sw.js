// Mendcraft PWA service worker — deliberately NETWORK-FIRST so a new deploy can
// never be blocked by a stale cached bundle. When online the network always
// wins and we refresh the runtime cache in the background; the cache is only
// read as an offline fallback. (Cache-first on hashed JS would pin old code and
// break deploys — we do not do that.)
//
// Scope is '/', but this SW only ever affects what the browser already fetches;
// it adds offline resilience for the installed /phone remote and nothing else.
const CACHE = 'mendcraft-rt-v2';

self.addEventListener('install', (event) => {
  // Activate immediately so the newest SW controls pages without a double reload.
  self.skipWaiting();
  // Warm the shell so a cold offline launch of /phone still renders.
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(['/phone', '/manifest.webmanifest']).catch(() => undefined)),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop any older runtime caches from previous SW versions.
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Only handle same-origin GETs; let everything else (POST, cross-origin,
  // Firestore, MediaPipe CDN, etc.) hit the network untouched.
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // HTML must never be served from the HTTP cache: a stale canvas.html would
  // carry the OLD response headers (e.g. a CSP without 'wasm-unsafe-eval') for
  // up to an hour and silently break MediaPipe. Revalidate with the server.
  const isNavigate = req.mode === 'navigate';
  const isHtml = /\.html$/.test(url.pathname);

  event.respondWith(
    (async () => {
      try {
        // A navigate-mode Request cannot be reconstructed (mode 'navigate' is
        // not constructible), so fetch by URL for navigations.
        const res = isNavigate
          ? await fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
          : isHtml
          ? await fetch(new Request(req, { cache: 'no-cache' }))
          : await fetch(req);
        // Cache a copy of OK responses for offline fallback. Never blocks the
        // response the page gets — the fresh network response is returned.
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => undefined);
        }
        return res;
      } catch {
        // Offline: serve the cached copy if we have one; for navigations fall
        // back to the cached /phone shell.
        const cached = await caches.match(req);
        if (cached) return cached;
        if (req.mode === 'navigate') {
          const shell = await caches.match('/phone');
          if (shell) return shell;
        }
        throw new Error('offline and not cached');
      }
    })(),
  );
});
