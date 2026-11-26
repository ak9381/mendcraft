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

// The scenes a WiZ bulb knows (same ids as src/devices/wiz.ts WIZ_SCENES).
export const SCENE_ID_MIN = 1;
export const SCENE_ID_MAX = 32;

// What /setPilot accepts. Anything outside this is REFUSED with a reason —
// never clamped into a value the caller did not ask for, and never forwarded
// to the bulb. Allowed: state (boolean), dimming 10–100, temp 2200–6500 K,
// r/g/b 0–255 (all three together), sceneId 1–32. A colour, a white and a
// scene are different modes: only one may be set per request.
export function validateParams(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'params must be an object' };
  const allowed = ['state', 'dimming', 'temp', 'r', 'g', 'b', 'sceneId'];
  const unknown = Object.keys(raw).filter((k) => !allowed.includes(k));
  if (unknown.length) return { ok: false, error: `unknown param: ${unknown[0]}` };
  const out = {};
  const int = (v) => typeof v === 'number' && Number.isInteger(v);
  if (raw.state !== undefined) {
    if (typeof raw.state !== 'boolean') return { ok: false, error: 'state must be true or false' };
    out.state = raw.state;
  }
  if (raw.dimming !== undefined) {
    if (!int(raw.dimming) || raw.dimming < 10 || raw.dimming > 100) return { ok: false, error: 'dimming must be a whole number from 10 to 100' };
    out.dimming = raw.dimming;
  }
  if (raw.temp !== undefined) {
    if (!int(raw.temp) || raw.temp < 2200 || raw.temp > 6500) return { ok: false, error: 'temp must be a whole number from 2200 to 6500' };
    out.temp = raw.temp;
  }
  const channels = ['r', 'g', 'b'].filter((ch) => raw[ch] !== undefined);
  if (channels.length) {
    if (channels.length !== 3) return { ok: false, error: 'r, g and b must be sent together' };
    for (const ch of channels) {
      if (!int(raw[ch]) || raw[ch] < 0 || raw[ch] > 255) return { ok: false, error: `${ch} must be a whole number from 0 to 255` };
      out[ch] = raw[ch];
    }
  }
  if (raw.sceneId !== undefined) {
    if (!int(raw.sceneId) || raw.sceneId < SCENE_ID_MIN || raw.sceneId > SCENE_ID_MAX) return { ok: false, error: `sceneId must be a whole number from ${SCENE_ID_MIN} to ${SCENE_ID_MAX}` };
    out.sceneId = raw.sceneId;
  }
  const modes = [out.temp !== undefined, channels.length > 0, out.sceneId !== undefined].filter(Boolean).length;
  if (modes > 1) return { ok: false, error: 'send only one of temp, r/g/b or sceneId' };
  if (!Object.keys(out).length) return { ok: false, error: 'no params to set' };
  return { ok: true, params: out };
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
  if (Number.isFinite(Number(raw.sceneId))) out.sceneId = clampInt(raw.sceneId, SCENE_ID_MIN, SCENE_ID_MAX);
  return out;
}
