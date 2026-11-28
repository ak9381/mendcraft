// Register the PWA service worker (public/sw.js) in production builds only;
// dev keeps HMR untouched. Called from the boot page AND the canvas page:
// "/" redirects to /canvas.html before its own load event, so without the
// canvas registering too the worker might never install and an offline
// reload would have nothing to open. Never inside the Capacitor native shells.

/** Inside the Capacitor native shells the bundle is local already. */
export function isNativeShell(win: Window): boolean {
  const cap = (win as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}

export function registerServiceWorker(win: Window = window, prod: boolean = import.meta.env.PROD): void {
  if (!prod) return;
  if (isNativeShell(win)) return;
  const nav = win.navigator;
  if (!('serviceWorker' in nav)) return;
  // Scope /canvas: only the canvas page (and its assets) goes through the
  // worker. Other pages (the AI monitor, AI activity, home) never wait on a
  // cold worker start. An older whole-site ('/') registration is removed.
  const go = () => {
    void nav.serviceWorker.register('/sw.js', { scope: '/canvas' }).catch(() => undefined);
    const rootScope = `${win.location?.origin ?? ''}/`;
    void nav.serviceWorker.getRegistrations?.()
      .then((regs) => Promise.all(regs.filter((r) => r.scope === rootScope).map((r) => r.unregister())))
      .catch(() => undefined);
  };
  if (win.document.readyState === 'complete') go();
  else win.addEventListener('load', go, { once: true });
}
