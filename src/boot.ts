// Entry fork — runs BEFORE the editor shell mounts. Firebase Hosting rewrites
// every path to /index.html, so routing is decided here from the URL:
//   /remote (or ?view=remote)  → the phone remote + camera page
//   everything else            → the existing editor (src/main.ts, unchanged)

import { isControlRoute, isJudgesRoute, isPhoneRoute, isRemoteRoute } from './relay/protocol';

// Inside the thin Android shell (Capacitor) the bundle is served from
// https://localhost/ with no path — the native app IS the remote, so route
// there directly instead of the editor.
type CapGlobal = { isNativePlatform?: () => boolean; getPlatform?: () => string };
const cap = (window as unknown as { Capacitor?: CapGlobal }).Capacitor;
const isNativeShell = Boolean(cap?.isNativePlatform?.());
// The iOS shell is the iPhone lamp & music remote (compact /phone variant).
const isIosShell = isNativeShell && cap?.getPlatform?.() === 'ios';

if (isIosShell || isPhoneRoute(window.location.pathname, window.location.search)) {
  // /phone is the iPhone PWA install target: the remote page in its compact
  // "lamp & music" variant (large play/pause, volume, lamp on/off/dim).
  const { mountRemotePage } = await import('./relay/remotePage');
  await mountRemotePage(document.querySelector<HTMLDivElement>('#app')!, { variant: 'phone' });
} else if (isNativeShell || isRemoteRoute(window.location.pathname, window.location.search)) {
  const { mountRemotePage } = await import('./relay/remotePage');
  await mountRemotePage(document.querySelector<HTMLDivElement>('#app')!);
} else if (isControlRoute(window.location.pathname, window.location.search)) {
  const { mountControlPage } = await import('./relay/controlPage');
  await mountControlPage(document.querySelector<HTMLDivElement>('#app')!);
} else if (isJudgesRoute(window.location.pathname, window.location.search)) {
  const { mountJudgesPage } = await import('./judges/judgesPage');
  await mountJudgesPage(document.querySelector<HTMLDivElement>('#app')!);
} else {
  await import('./main');
}

// Register the PWA service worker in production builds only (dev keeps HMR
// untouched). It is network-first, so it never serves stale JS while online —
// it just makes the installed /phone remote resilient when the LAN drops.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}

export {};
