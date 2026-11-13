#!/usr/bin/env node
// Local WiZ bridge — the UDP↔HTTP shim the browser needs. Browsers cannot send
// UDP, so this tiny Node process does the datagrams to the bulb (JSON-RPC on
// port 38899) and exposes a localhost HTTP/JSON API the web client talks to.
//
//   npm run wiz-bridge                 # binds 127.0.0.1:38888 (this laptop only)
//   npm run wiz-bridge -- --host 0.0.0.0 --port 38888   # let a phone on the LAN reach it
//   npm run wiz-bridge -- --bulb 192.168.1.50           # pin a known bulb IP
//
// SECURITY: binds localhost by default. --host 0.0.0.0 is for same-Wi-Fi phones
// only — NEVER port-forward this to the public internet; anyone who can reach it
// can toggle your lamp. No cloud, no WiZ account, no API keys.
//
// The WiZ param SEMANTICS (ranges, intent→params, reply parsing) live in the
// tested src/devices/wiz.ts; this file is a dumb, auditable transport.

import { createServer } from 'node:http';
import dgram from 'node:dgram';

const WIZ_PORT = 38899;
const BROADCAST = '255.255.255.255';

// Only ever send to a dotted-quad IPv4 literal — NEVER a hostname (which would
// make dgram do a DNS lookup and let a caller aim this process at an arbitrary
// host). Combined with the wildcard CORS below, a strict destination check is
// what keeps a stray web page from using the bridge as a UDP relay.
function isIPv4(s) {
  if (typeof s !== 'string') return false;
  const parts = s.split('.');
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

// Re-enforce WiZ's param whitelist + ranges server-side (wiz.ts clamps on the
// client, but the bridge must not trust the wire). Unknown keys are dropped.
function sanitizeParams(raw) {
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

// ---- args -----------------------------------------------------------------
function parseArgs(argv) {
  const out = { host: '127.0.0.1', port: 38888, bulb: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--host') out.host = argv[++i];
    else if (a === '--port') out.port = Number(argv[++i]) || out.port;
    else if (a === '--bulb') out.bulb = argv[++i];
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));

// ---- UDP socket (shared) --------------------------------------------------
const udp = dgram.createSocket('udp4');
// Pending replies keyed by bulb IP → resolver (one in-flight request per bulb).
const pending = new Map();
// Discovery accumulator: ip → last reply object, filled during a broadcast window.
let discovering = null;

udp.on('message', (buf, rinfo) => {
  let msg = null;
  try {
    msg = JSON.parse(buf.toString('utf8'));
  } catch {
    return; // not our JSON
  }
  if (discovering) discovering.set(rinfo.address, msg);
  const waiter = pending.get(rinfo.address);
  if (waiter) {
    pending.delete(rinfo.address);
    clearTimeout(waiter.timer);
    waiter.resolve(msg);
  }
});
udp.on('error', (err) => console.error('[wiz-bridge] udp error:', err.message));

function sendTo(ip, message) {
  const data = Buffer.from(JSON.stringify(message));
  udp.send(data, 0, data.length, WIZ_PORT, ip);
}

/** Send a message to one bulb and await its reply (or time out). */
function request(ip, message, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    if (pending.has(ip)) return reject(new Error('a request to that bulb is already in flight'));
    const timer = setTimeout(() => {
      pending.delete(ip);
      reject(new Error('bulb did not reply (timed out)'));
    }, timeoutMs);
    pending.set(ip, { resolve, timer });
    sendTo(ip, message);
  });
}

/** Broadcast getPilot and collect every bulb that answers within the window. */
function discover(windowMs = 900) {
  return new Promise((resolve) => {
    discovering = new Map();
    const message = { method: 'getPilot', params: {} };
    const data = Buffer.from(JSON.stringify(message));
    udp.setBroadcast(true);
    // A couple of pulses in case the first datagram is dropped.
    udp.send(data, 0, data.length, WIZ_PORT, BROADCAST);
    setTimeout(() => udp.send(data, 0, data.length, WIZ_PORT, BROADCAST), 250);
    setTimeout(() => {
      const found = discovering;
      discovering = null;
      const bulbs = [];
      for (const [ip, reply] of found) {
        const result = reply && typeof reply === 'object' ? reply.result ?? reply : null;
        bulbs.push({ ip, mac: result?.mac, state: result });
      }
      resolve(bulbs);
    }, windowMs);
  });
}

// ---- HTTP server ----------------------------------------------------------
function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    // Local-only tool: the web app is a different origin (vite dev / hosting),
    // so reflect any origin. No credentials are ever used.
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  });
  res.end(json);
}

function readJson(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 1e6) req.destroy(); // tiny API — reject floods
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      return send(res, 200, { ok: true, bridge: 'wiz', bulb: args.bulb ?? null });
    }
    if (req.method === 'GET' && url.pathname === '/discover') {
      return send(res, 200, { bulbs: await discover() });
    }
    if (req.method === 'POST' && url.pathname === '/getPilot') {
      const body = await readJson(req);
      const ip = body.ip || args.bulb;
      if (!ip) return send(res, 400, { error: 'no bulb ip (pass {ip} or run with --bulb)' });
      if (!isIPv4(ip)) return send(res, 400, { error: 'ip must be a dotted-quad IPv4 literal' });
      return send(res, 200, { result: await request(ip, { method: 'getPilot', params: {} }) });
    }
    if (req.method === 'POST' && url.pathname === '/setPilot') {
      const body = await readJson(req);
      const ip = body.ip || args.bulb;
      if (!ip) return send(res, 400, { error: 'no bulb ip (pass {ip} or run with --bulb)' });
      if (!isIPv4(ip)) return send(res, 400, { error: 'ip must be a dotted-quad IPv4 literal' });
      return send(res, 200, { result: await request(ip, { method: 'setPilot', params: sanitizeParams(body.params) }) });
    }
    send(res, 404, { error: 'not found' });
  } catch (err) {
    send(res, 502, { error: String(err?.message || err) });
  }
});

udp.bind(() => {
  server.listen(args.port, args.host, () => {
    console.log(`[wiz-bridge] http://${args.host}:${args.port}  →  WiZ bulbs on UDP ${WIZ_PORT}`);
    if (args.host === '0.0.0.0') {
      console.log('[wiz-bridge] bound to 0.0.0.0 for LAN phones — do NOT expose this to the internet.');
    }
    if (args.bulb) console.log(`[wiz-bridge] default bulb: ${args.bulb}`);
    console.log('[wiz-bridge] GET /health  GET /discover  POST /getPilot  POST /setPilot');
  });
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close();
    udp.close();
    process.exit(0);
  });
}
