// Entry fork — runs BEFORE the editor shell mounts. Firebase Hosting rewrites
// every path to /index.html, so routing is decided here from the URL:
//   /remote (or ?view=remote)  → the phone remote + camera page
//   everything else            → the existing editor (src/main.ts, unchanged)

import { isRemoteRoute } from './relay/protocol';

if (isRemoteRoute(window.location.pathname, window.location.search)) {
  const { mountRemotePage } = await import('./relay/remotePage');
  await mountRemotePage(document.querySelector<HTMLDivElement>('#app')!);
} else {
  await import('./main');
}

export {};
