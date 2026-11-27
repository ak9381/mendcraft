// recordGuard.lib.mjs — what scripts/record-fixtures.mjs refuses to write.
// A recorded reply goes into the repo, so anything that could be personal or
// a secret stops it: keys, tokens, emails, addresses, hardware ids, any value
// from .env.local, and any device the journey did not put there (the journey
// runs on SIM fixtures only, so a real device in a reply means something
// real leaked into the prompt).

import { existsSync, readFileSync } from 'node:fs';

export const FORBIDDEN = [
  ['an API key', /AIza[0-9A-Za-z_-]{20,}/],
  ['a bearer or access token', /\b(?:Bearer\s+[A-Za-z0-9._-]{16,}|ya29\.[A-Za-z0-9._-]+|access_token|refresh_token)/i],
  ['an email address', /\b[A-Za-z0-9][\w.+-]*@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+\b/],
  ['an IP address', /\b(?:\d{1,3}\.){3}\d{1,3}\b/],
  ['a MAC address', /\b[0-9a-f]{2}(?:[:-][0-9a-f]{2}){5}\b/i],
  ['a hardware id', /\b[0-9a-f]{12}\b/i],
  ['a long hex secret', /\b[0-9a-f]{32,}\b/i],
];

/** Every value in an env file (keys, ids, tokens) of 8+ characters. */
export function envSecrets(path) {
  if (!path || !existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n')
    .filter((l) => /^\s*[A-Za-z_][A-Za-z0-9_]*\s*=/.test(l))
    .map((l) => l.replace(/^[^=]*=/, '').trim().replace(/^["']|["']$/g, ''))
    .filter((v) => v.length >= 8);
}

const DEVICE_TILES = new Set(['lamp', 'music', 'switch', 'gimbal']);
/** Words a model may use to name a fixture device on its tile. A label made
 *  only of these ("Light", "Camera stand") is generic; any other word in it
 *  ("Desk lamp", "Asha's speaker") could come from a real device, so such a
 *  label must be one of the fixtures' own labels exactly. */
const DEVICE_WORD = /^(lamp|light|bulb|speaker|music|player|gimbal|stand|camera)$/i;
const genericLabel = (label) => {
  const words = label.trim().split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every((w) => DEVICE_WORD.test(w));
};
const TOKEN = /^Device \d+$/; // a cloud prompt's redacted id (deviceRedact.ts)

/** The reply's JSON (inside prose or a fence), or null. */
function jsonIn(text) {
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(text.slice(a, b + 1)); } catch { return null; }
}

/** Device ids and device-tile labels a reply names that the journey's
 *  fixtures do not have. */
export function foreignDevices(reply, devices) {
  const ids = new Set(devices.map((d) => d.id));
  const labels = new Set(devices.map((d) => d.label.toLowerCase()));
  const out = [];
  const idOk = (v) => typeof v !== 'string' || ids.has(v) || TOKEN.test(v);
  const json = jsonIn(reply);
  if (!json) {
    for (const m of reply.matchAll(/"deviceId"\s*:\s*"([^"]*)"/g)) if (!idOk(m[1])) out.push(m[1]);
    return out;
  }
  const walk = (v, key) => {
    if (Array.isArray(v)) {
      // Nano's board decision: {"t": title, "d": [device ids]}.
      if (key === 'd') for (const x of v) if (!idOk(x)) out.push(String(x));
      for (const x of v) walk(x);
      return;
    }
    if (!v || typeof v !== 'object') return;
    if ('deviceId' in v && !idOk(v.deviceId)) out.push(String(v.deviceId));
    if (DEVICE_TILES.has(v.type) && typeof v.label === 'string' && !labels.has(v.label.trim().toLowerCase()) && !genericLabel(v.label)) out.push(v.label);
    for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(json);
  return out;
}

/** Why this fixture file must not be written, or null. */
export function unsafeFixture(file, { devices, secrets = [] }) {
  // promptSha is a sha-256 by design: the only hex a fixture may hold.
  const text = JSON.stringify({ ...file, promptSha: '' });
  for (const [what, re] of FORBIDDEN) if (re.test(text)) return what;
  if (secrets.some((s) => text.includes(s))) return 'a value from .env.local';
  const foreign = foreignDevices(String(file.reply ?? ''), devices);
  if (foreign.length) return `a device the journey did not set up (${foreign.slice(0, 3).join(', ')})`;
  return null;
}
