// Entry fork — runs BEFORE the editor shell mounts. Firebase Hosting rewrites
// every path to /index.html, so routing is decided here from the URL. The
// smart canvas (src/canvas) is the default story; everything below is a
// legacy page from the old single-page studio and only mounts behind a
// feature flag (?flags=name, persisted to localStorage so it survives a
// redirect) — otherwise it bounces to the canvas:
//   /                          → the old marketing landing     [flag: landing]
//   /studio (or ?sim / ?play)  → the old hands-free editor      [flag: studio]
//   /remote (or ?view=remote)  → the phone remote + camera page [flag: remote]
//   /phone (or ?view=phone)    → the remote's "lamp & music" PWA variant [flag: remote]
//   /control                   → the iPad control room          [flag: control]
//   /judges                    → the old guided-tour page       [flag: judgesLegacy]
//   /spotify                   → Spotify OAuth callback, used only by the old studio's music panel [flag: studio]

import { isControlRoute, isJudgesRoute, isLandingRoute, isMobileRoute, isPhoneRoute, isRemoteRoute, isSpotifyRoute } from './relay/protocol';
import { loadFlags } from './core/flags';

const flags = loadFlags();

// Inside the thin Android shell (Capacitor) the bundle is served from
// https://localhost/ with no path — the native app IS the remote, so route
// there directly instead of the editor.
type CapGlobal = { isNativePlatform?: () => boolean; getPlatform?: () => string };
const cap = (window as unknown as { Capacitor?: CapGlobal }).Capacitor;
const isNativeShell = Boolean(cap?.isNativePlatform?.());
// The iOS shell boots the full Mendcraft app (setup, gestures, Add a device,
// DockKit gimbal); the old lamp & music remote stays at /phone.
const isIosShell = isNativeShell && cap?.getPlatform?.() === 'ios';

// sim-main: native shells and /canvas open the smart canvas page.
const { wantsCanvas, canvasUrl } = await import('./canvas/route');
if (wantsCanvas(window.location.pathname, window.location.search, isNativeShell)) {
  window.location.replace(canvasUrl(window.location.search));
} else if (isSpotifyRoute(window.location.pathname, window.location.search)) {
  // OAuth redirect: exchange the auth code, stash tokens, go back to the page
  // she came from. Only the old studio's music panel sends anyone here, so it
  // is gated the same as that studio (the 'studio' flag persists across the
  // OAuth round trip via localStorage, since the provider drops query params).
  if (flags.has('studio')) {
    const { handleSpotifyCallback } = await import('./music/spotifyCallback');
    await handleSpotifyCallback();
  } else {
    window.location.replace(canvasUrl(window.location.search));
  }
} else if (isPhoneRoute(window.location.pathname, window.location.search)) {
  // /phone is the iPhone PWA install target: the remote page in its compact
  // "lamp & music" variant (large play/pause, volume, lamp on/off/dim).
  if (flags.has('remote')) {
    const { mountRemotePage } = await import('./relay/remotePage');
    await mountRemotePage(document.querySelector<HTMLDivElement>('#app')!, { variant: 'phone' });
  } else {
    window.location.replace(canvasUrl(window.location.search));
  }
} else if ((isNativeShell && !isIosShell) || isRemoteRoute(window.location.pathname, window.location.search)) {
  if (isNativeShell || flags.has('remote')) {
    const { mountRemotePage } = await import('./relay/remotePage');
    await mountRemotePage(document.querySelector<HTMLDivElement>('#app')!);
  } else {
    window.location.replace(canvasUrl(window.location.search));
  }
} else if (isMobileRoute(window.location.pathname, window.location.search)) {
  // The phone + tablet companion (pair / dashboard / split) is its own entry.
  // No feature flag: this is the shipping phone experience, not a legacy page.
  const { mobileUrl } = await import('./canvas/route');
  window.location.replace(mobileUrl(window.location.search));
} else if (isControlRoute(window.location.pathname, window.location.search)) {
  if (flags.has('control')) {
    const { mountControlPage } = await import('./relay/controlPage');
    await mountControlPage(document.querySelector<HTMLDivElement>('#app')!);
  } else {
    window.location.replace(canvasUrl(window.location.search));
  }
} else if (isJudgesRoute(window.location.pathname, window.location.search)) {
  if (flags.has('judgesLegacy')) {
    const { mountJudgesPage } = await import('./judges/judgesPage');
    await mountJudgesPage(document.querySelector<HTMLDivElement>('#app')!);
  } else {
    // The judges link now opens the seeded canvas tour instead of the old page.
    window.location.replace('/canvas.html?sim=1');
  }
} else if (isLandingRoute(window.location.pathname, window.location.search) && flags.has('landing')) {
  // The old landing tells the earlier story; the front door is the canvas now.
  const { mountLandingPage } = await import('./landing/landingPage');
  mountLandingPage(document.querySelector<HTMLDivElement>('#app')!);
} else if (flags.has('studio')) {
  await import('./main');
} else {
  // Any other unmatched path (old studio fallback) now goes to the canvas by default.
  window.location.replace(canvasUrl(window.location.search));
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
