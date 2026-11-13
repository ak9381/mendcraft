// Entry fork — runs BEFORE the editor shell mounts. Firebase Hosting rewrites
// every path to /index.html, so routing is decided here from the URL:
//   /remote (or ?view=remote)  → the phone remote + camera page
//   everything else            → the existing editor (src/main.ts, unchanged)

import { isControlRoute, isRemoteRoute } from './relay/protocol';

// Inside the thin Android shell (Capacitor) the bundle is served from
// https://localhost/ with no path — the native app IS the remote, so route
// there directly instead of the editor.
const isNativeShell = Boolean(
  (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.(),
);

if (isNativeShell || isRemoteRoute(window.location.pathname, window.location.search)) {
  const { mountRemotePage } = await import('./relay/remotePage');
  await mountRemotePage(document.querySelector<HTMLDivElement>('#app')!);
} else if (isControlRoute(window.location.pathname, window.location.search)) {
  const { mountControlPage } = await import('./relay/controlPage');
  await mountControlPage(document.querySelector<HTMLDivElement>('#app')!);
} else {
  await import('./main');
}

export {};
