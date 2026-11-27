// Build step for public/sw.js: after `vite build`, fill its markers with the
// list of built files to keep for offline, the MediaPipe tracking files and a
// build id (so each deploy gets its own cache and drops the last one).
// Pure functions here; the Vite plugin in vite.config.ts does the file I/O.

import { createHash } from 'node:crypto';

/** Pages and small files an offline reload needs whatever was opened first. */
export const SHELL_URLS: readonly string[] = ['/', '/canvas', '/canvas.html', '/phone', '/manifest.webmanifest', '/favicon.svg', '/favicon.ico'];

const KEEP = /^(assets\/[^/]+\.(js|css|woff2?|wasm|png|svg|webp|jpg)|fonts\/[^/]+\.woff2?|icons\/[^/]+\.png)$/;

/** Built files (paths relative to the out dir, '/' separators) → URLs to precache. */
export function precacheList(files: readonly string[]): string[] {
  const out = new Set<string>(SHELL_URLS);
  for (const f of files) if (KEEP.test(f)) out.add(`/${f}`);
  return [...out];
}

export function buildId(precache: readonly string[], tracking: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify([precache, tracking])).digest('hex').slice(0, 12);
}

const MARKS = {
  build: "'__MC_BUILD__'",
  precache: '/*__MC_PRECACHE__*/[]',
  tracking: '/*__MC_TRACKING__*/[]',
  trackingCache: "'__MC_TRACKING_CACHE__'",
} as const;

export function injectServiceWorker(
  src: string,
  v: { precache: readonly string[]; tracking: readonly string[]; trackingCache: string; build: string },
): string {
  for (const [k, m] of Object.entries(MARKS)) {
    if (!src.includes(m)) throw new Error(`sw.js: marker for ${k} (${m}) is missing`);
  }
  return src
    .replace(MARKS.build, JSON.stringify(v.build))
    .replace(MARKS.precache, JSON.stringify(v.precache))
    .replace(MARKS.tracking, JSON.stringify(v.tracking))
    .replace(MARKS.trackingCache, JSON.stringify(v.trackingCache));
}
