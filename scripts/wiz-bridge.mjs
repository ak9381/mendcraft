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
import { randomBytes } from 'node:crypto';
import { createDiscovery, isAllowedOrigin, isBulbAddress, validateParams } from './wizBridge.lib.mjs';

const WIZ_PORT = 38899;
const BROADCAST = '255.255.255.255';

// ---- args -----------------------------------------------------------------
function parseArgs(argv) {
  const out = { host: '127.0.0.1', port: 38888, bulb: null, token: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--host') out.host = argv[++i];
    else if (a === '--port') out.port = Number(argv[++i]) || out.port;
    else if (a === '--bulb') out.bulb = argv[++i];
    else if (a === '--token') out.token = argv[++i]; // fixed token, for scripted/dev use only
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));

// Random per-run token, required via the `x-wiz-token` header on every
// request. Printed once at startup — the web app reads it from ?wizToken= or
// localStorage (see src/devices/wizClient.ts) and the user pastes/bookmarks
// it. Without this, any webpage open in the same browser could CSRF
// /setPilot to drive the lamp (the wildcard-CORS + no-auth bug this closes).
const TOKEN = args.token || randomBytes(16).toString('hex');

// ---- UDP socket (shared) --------------------------------------------------
const udp = dgram.createSocket('udp4');
// Pending replies keyed by bulb IP → resolver (one in-flight request per bulb).
const pending = new Map();
// Broadcast discovery: one window at a time, shared by overlapping /discover
// calls (two tabs at boot must never crash the bridge).
const discovery = createDiscovery({
  send: () => {
    const data = Buffer.from(JSON.stringify({ method: 'getPilot', params: {} }));
    udp.setBroadcast(true);
    udp.send(data, 0, data.length, WIZ_PORT, BROADCAST);
  },
});

udp.on('message', (buf, rinfo) => {
  let msg = null;
  try {
    msg = JSON.parse(buf.toString('utf8'));
  } catch {
    return; // not our JSON
  }
  discovery.onMessage(rinfo.address, msg);
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
function discover() {
  return discovery.discover();
}

// ---- HTTP server ----------------------------------------------------------
function send(res, origin, status, body) {
  const json = JSON.stringify(body);
  const headers = {
    'content-type': 'application/json',
    'access-control-allow-headers': 'content-type, x-wiz-token',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  };
  // Only echo back an Access-Control-Allow-Origin for an allowlisted origin —
  // every other caller gets a response with no CORS header, so the browser
  // refuses to let the page read it. No credentials are ever used.
  if (isAllowedOrigin(origin)) {
    headers['access-control-allow-origin'] = origin;
    // Chrome's Private Network Access: a public https page (the hosted
    // preview) may call this loopback bridge only if the preflight says so.
    // Still allowlisted origins only, and every request still needs the token.
    headers['access-control-allow-private-network'] = 'true';
    headers.vary = 'Origin';
  }
  res.writeHead(status, headers);
  res.end(json);
}

function hasValidToken(req) {
  return req.headers['x-wiz-token'] === TOKEN;
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
  const origin = req.headers.origin;
  if (req.method === 'OPTIONS') return send(res, origin, 204, {}); // preflight: no token on this leg
  if (!hasValidToken(req)) return send(res, origin, 401, { error: 'missing or wrong x-wiz-token header' });
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      return send(res, origin, 200, { ok: true, bridge: 'wiz', bulb: args.bulb ?? null });
    }
    if (req.method === 'GET' && url.pathname === '/discover') {
      return send(res, origin, 200, { bulbs: await discover() });
    }
    if (req.method === 'POST' && url.pathname === '/getPilot') {
      const body = await readJson(req);
      const ip = body.ip || args.bulb;
      if (!ip) return send(res, origin, 400, { error: 'no bulb ip (pass {ip} or run with --bulb)' });
      if (!isBulbAddress(ip)) return send(res, origin, 400, { error: 'ip must be a private LAN bulb address (dotted-quad IPv4, not broadcast)' });
      return send(res, origin, 200, { result: await request(ip, { method: 'getPilot', params: {} }) });
    }
    if (req.method === 'POST' && url.pathname === '/setPilot') {
      const body = await readJson(req);
      const ip = body.ip || args.bulb;
      if (!ip) return send(res, origin, 400, { error: 'no bulb ip (pass {ip} or run with --bulb)' });
      if (!isBulbAddress(ip)) return send(res, origin, 400, { error: 'ip must be a private LAN bulb address (dotted-quad IPv4, not broadcast)' });
      // Out-of-range or unknown params are refused here (400), never clamped
      // and never sent to the bulb.
      const checked = validateParams(body.params);
      if (!checked.ok) return send(res, origin, 400, { error: checked.error, refused: true });
      return send(res, origin, 200, { result: await request(ip, { method: 'setPilot', params: checked.params }) });
    }
    send(res, origin, 404, { error: 'not found' });
  } catch (err) {
    send(res, origin, 502, { error: String(err?.message || err) });
  }
});

udp.bind(() => {
  server.listen(args.port, args.host, () => {
    console.log(`[wiz-bridge] http://${args.host}:${args.port}  →  WiZ bulbs on UDP ${WIZ_PORT}`);
    if (args.host === '0.0.0.0') {
      console.log('[wiz-bridge] bound to 0.0.0.0 for LAN phones — do NOT expose this to the internet.');
    }
    if (args.bulb) console.log(`[wiz-bridge] default bulb: ${args.bulb}`);
    console.log(`[wiz-bridge] token: ${TOKEN}`);
    console.log(`[wiz-bridge] open the app with ?wizToken=${TOKEN} once, or set localStorage['mendcraft.wizToken'].`);
    console.log('[wiz-bridge] GET /health  GET /discover  POST /getPilot  POST /setPilot  (all require header x-wiz-token)');
  });
});

// Last resort: one bad request or datagram never takes every lamp down.
process.on('uncaughtException', (err) => console.error('[wiz-bridge] error (kept running):', err?.message || err));
process.on('unhandledRejection', (err) => console.error('[wiz-bridge] error (kept running):', err?.message || err));

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close();
    udp.close();
    process.exit(0);
  });
}
