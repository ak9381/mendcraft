// Pure helpers for the WiZ bridge (scripts/wiz-bridge.mjs). No sockets, no
// HTTP — just the CORS origin allowlist and the WiZ param sanitizer. Kept in
// its own module so tests/wizBridge.test.ts can unit-test the security logic
// without starting a real UDP/HTTP server.

// Origins allowed to talk to the bridge: dev ports on localhost/127.0.0.1,
// the Capacitor WebViews (iOS uses https://localhost, Android/custom scheme
// uses capacitor://localhost), and the Firebase Hosting channels this app
// ships from. Anything else gets no CORS headers back.
export const ALLOWED_ORIGIN_PATTERNS = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^capacitor:\/\/localhost$/,
  /^https:\/\/mendcraft[a-z0-9-]*\.web\.app$/,
];

export function isAllowedOrigin(origin) {
  return typeof origin === 'string' && ALLOWED_ORIGIN_PATTERNS.some((re) => re.test(origin));
}

// Only ever send to a dotted-quad IPv4 literal — NEVER a hostname (which would
// make dgram do a DNS lookup and let a caller aim the bridge at an arbitrary
// host).
export function isIPv4(s) {
  if (typeof s !== 'string') return false;
  const parts = s.split('.');
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

// Re-enforce WiZ's param whitelist + ranges server-side (src/devices/wiz.ts
// clamps on the client, but the bridge must not trust the wire). Unknown
// keys are dropped.
export function sanitizeParams(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  const clampInt = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(n))));
  if (typeof raw.state === 'boolean') out.state = raw.state;
  if (Number.isFinite(Number(raw.dimming))) out.dimming = clampInt(raw.dimming, 10, 100);
  if (Number.isFinite(Number(raw.temp))) out.temp = clampInt(raw.temp, 2200, 6500);
  for (const ch of ['r', 'g', 'b']) {
    if (Number.isFinite(Number(raw[ch]))) out[ch] = clampInt(raw[ch], 0, 255);
  }
  if (Number.isFinite(Number(raw.sceneId))) out.sceneId = clampInt(raw.sceneId, 0, 1000);
  return out;
}
