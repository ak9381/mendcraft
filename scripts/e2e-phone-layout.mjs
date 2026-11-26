// e2e-phone-layout.mjs — the phone shell's room board with a LEGACY stored
// board (a board + tile layout saved by an older/desktop build) renders as one
// clean column at real iPhone sizes: no two tiles intersect, every tile is
// full width, and the bottom chrome (mic, Join laptop, Track, Hands, Read
// aloud) never sits on another control or on the board's last tile.
//
//   npx vite --port 5173 &
//   E2E_URL=http://localhost:5173 npm run e2e:phone-layout
//   SHOTS=/some/dir … writes one PNG per viewport (top + scrolled to bottom).
//
// Same stack as e2e-journey.mjs: puppeteer-core + an installed Chrome.

import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const BASE = (process.env.E2E_URL || 'http://localhost:5173').replace(/\/$/, '');
const SHOTS = process.env.SHOTS || '';

function findChrome() {
  return [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].filter(Boolean).find((p) => existsSync(p));
}

const failures = [];
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what); };

// A board saved by an older build: desktop-sized frame rect, a nested
// "Lighting" card, and per-tile edit rects from before Edit mode was
// nesting-aware (each lamp had its own squeezed, overlapping box).
const LEGACY_DOC = {
  version: 1, camera: { x: -40, y: -60, z: 0.62 }, focusId: 'f1',
  frames: [{ id: 'f1', kind: 'room', title: 'Board 1', rect: { x: 0, y: 0, w: 1180, h: 760 }, pinned: false }],
  surfaces: {
    f1: { kind: 'room', title: 'Board 1', tiles: [
      { type: 'connect', label: 'Connect everything in this room' },
      { type: 'card', title: 'Lighting', children: [
        { type: 'lamp', deviceId: 'wiz-desk', label: 'Desk lamp' },
        { type: 'lamp', deviceId: 'wiz-ceiling', label: 'Ceiling light' },
      ] },
      { type: 'row', children: [
        { type: 'music', deviceId: 'speaker-1', label: 'Speaker' },
        { type: 'stat', label: 'Power now', value: '412 W' },
      ] },
    ] },
  },
};
const LEGACY_LAYOUT = {
  'connect-tile': { left: 12, top: 12, width: 560, height: 220 },
  'lamp-wiz-desk': { left: 12, top: 250, width: 90, height: 600 },
  'lamp-wiz-ceiling': { left: 40, top: 250, width: 90, height: 600 },
  'card-1': { left: 12, top: 250, width: 150, height: 420 },
  'row-2': { left: 600, top: 12, width: 520, height: 300 },
};

// `ios: true` boots as the iPhone app (a stub WKWebView bridge, so Capacitor
// reports 'ios'): the Track pill joins the bottom chrome there.
const VIEWPORTS = [
  { name: 'iphone-16-pro-max-440x956', width: 440, height: 956, dpr: 3, ios: true },
  { name: 'iphone-390x844', width: 390, height: 844, dpr: 3, ios: true },
  { name: 'browser-390x844', width: 390, height: 844, dpr: 3, ios: false },
];

/** In the page: every tile box, the frame, and the bottom chrome. */
function measure() {
  const TAGS = 'mc-lamp-tile, mc-music-tile, mc-switch-tile, mc-scene-tile, mc-connect-tile, mc-plan-board, mc-row, mc-grid, mc-card, mc-tabs, mc-split, mc-stat-tile, mc-chart-tile, mc-table-tile, mc-form-tile, mc-visual-tile';
  const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
  const frame = document.querySelector('.mc-frame.focused') ?? document.querySelector('.mc-frame');
  const els = frame ? [...frame.querySelectorAll(TAGS)] : [];
  const tiles = els.map((el, i) => ({ i, tag: el.tagName.toLowerCase(), label: el.getAttribute('aria-label') || el.querySelector('.mc-card-title')?.textContent || '', box: box(el), el }));
  const pairs = [];
  for (let a = 0; a < tiles.length; a++) for (let b = a + 1; b < tiles.length; b++) {
    const A = tiles[a], B = tiles[b];
    if (A.el.contains(B.el) || B.el.contains(A.el)) continue;
    const ix = Math.min(A.box.right, B.box.right) - Math.max(A.box.left, B.box.left);
    const iy = Math.min(A.box.bottom, B.box.bottom) - Math.max(A.box.top, B.box.top);
    if (ix > 1 && iy > 1) pairs.push(`${A.tag}#${A.i} × ${B.tag}#${B.i} (${Math.round(ix)}×${Math.round(iy)})`);
  }
  const leaves = tiles.filter((t) => !/^mc-(row|grid|card|tabs|split)$/.test(t.tag));
  const chromeSel = ['.mc-fab-mic', '.mc-join-pill', '.mc-phone-track-pill', '.mc-phone-hands-pill', '.mc-read-aloud'];
  const chrome = chromeSel.map((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || el.hidden) return null;
    return { sel, box: box(el) };
  }).filter(Boolean);
  const root = document.querySelector('.mc-phone-simple');
  const viewport = document.querySelector('.mc-viewport');
  const badge = document.querySelector('.mc-route-badge:not([hidden])');
  return {
    viewport: viewport ? box(viewport) : null,
    clips: viewport ? getComputedStyle(viewport).overflow === 'hidden' : false,
    badge: badge ? box(badge) : null,
    phone: !!root,
    vw: innerWidth, vh: innerHeight,
    frame: frame ? box(frame) : null,
    tiles: tiles.map(({ i, tag, label, box: b }) => ({ i, tag, label, box: b })),
    leaves: leaves.map(({ tag, box: b }) => ({ tag, box: b })),
    overlaps: pairs,
    edited: !!frame?.querySelector('.mc-edit-item'),
    chrome,
  };
}

function gap(a, b) {
  const dx = Math.max(a.left - b.right, b.left - a.right);
  const dy = Math.max(a.top - b.bottom, b.top - a.bottom);
  return Math.max(dx, dy);
}

async function main() {
  const chrome = findChrome();
  if (!chrome) { console.error('e2e-phone-layout: no Chrome found (set CHROME_PATH).'); return 2; }
  let puppeteer;
  try { puppeteer = require('puppeteer-core'); } catch { console.error('e2e-phone-layout: puppeteer-core missing (npm ci).'); return 2; }
  try { await fetch(`${BASE}/canvas.html`); } catch { console.error(`e2e-phone-layout: no dev server at ${BASE} (start one: npx vite).`); return 2; }
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: 'new',
    args: ['--no-sandbox', '--mute-audio', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check'],
  });
  try {
    for (const vp of VIEWPORTS) {
      console.log(`-- ${vp.name}`);
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e?.message || e)));
      await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: vp.dpr, isMobile: true, hasTouch: true });
      // Seed the legacy board before the app boots.
      await page.evaluateOnNewDocument((doc, layout, ios) => {
        if (ios) window.webkit = { messageHandlers: { bridge: { postMessage() {} } } };
        try {
          localStorage.setItem('mc.canvas.v1', JSON.stringify(doc));
          for (const store of [localStorage, sessionStorage]) store.setItem('mc.editLayout.f1', JSON.stringify(layout));
        } catch { /* storage off: the test then fails on its own checks */ }
      }, LEGACY_DOC, LEGACY_LAYOUT, vp.ios);
      await page.goto(`${BASE}/canvas.html?sim=1`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForSelector('.mc-frame mc-lamp-tile', { timeout: 20_000 });
      await page.evaluate(() => document.fonts.ready);
      await new Promise((r) => setTimeout(r, 1200));

      const m = await page.evaluate(measure);
      check(m.phone, `${vp.name}: phone shell`);
      check(!m.edited, `${vp.name}: stored edit layout not applied on the phone`);
      check(m.leaves.length >= 5, `${vp.name}: every tile rendered (${m.leaves.length})`);
      check(m.overlaps.length === 0, `${vp.name}: no two tiles intersect${m.overlaps.length ? ` — ${m.overlaps.join('; ')}` : ''}`);
      const fw = m.frame ? m.frame.width : 0;
      const narrow = m.leaves.filter((t) => t.box.width < fw - 80);
      check(narrow.length === 0, `${vp.name}: single column, every tile full width${narrow.length ? ` — ${narrow.map((t) => `${t.tag} ${Math.round(t.box.width)}px`).join(', ')}` : ''}`);
      const off = m.tiles.filter((t) => t.box.left < -1 || t.box.right > m.vw + 1);
      check(off.length === 0, `${vp.name}: no tile past the screen edge`);
      check(!!m.frame && m.frame.left >= 0 && m.frame.right <= m.vw, `${vp.name}: board fits the screen width`);
      // Bottom chrome: no two controls touch (≥ 4 px apart).
      const touching = [];
      for (let a = 0; a < m.chrome.length; a++) for (let b = a + 1; b < m.chrome.length; b++) {
        if (gap(m.chrome[a].box, m.chrome[b].box) < 4) touching.push(`${m.chrome[a].sel} ~ ${m.chrome[b].sel}`);
      }
      check(m.chrome.length >= 3, `${vp.name}: bottom chrome present (${m.chrome.map((c) => c.sel).join(' ')})`);
      check(touching.length === 0, `${vp.name}: bottom chrome never touches${touching.length ? ` — ${touching.join('; ')}` : ''}`);
      if (vp.ios) check(m.chrome.some((c) => c.sel === '.mc-phone-track-pill'), `${vp.name}: iPhone Track pill shown`);
      const chromeTop = Math.min(...m.chrome.map((c) => c.box.top));
      // The board area (which clips the board) ends above the chrome and starts below the badge.
      check(!!m.viewport && m.clips && m.viewport.bottom <= chromeTop, `${vp.name}: board area ends above the bottom chrome (${Math.round(m.viewport?.bottom ?? -1)} ≤ ${Math.round(chromeTop)})`);
      check(!!m.viewport && (!m.badge || m.viewport.top >= m.badge.bottom), `${vp.name}: board area starts below the route badge`);
      if (SHOTS) await page.screenshot({ path: join(SHOTS, `${vp.name}-top.png`) });

      // Scroll the board all the way down (touch-drag the canvas): its last tile
      // must end above the bottom chrome.
      for (let i = 0; i < 12; i++) {
        await page.touchscreen.touchStart(vp.width / 2, vp.height * 0.55);
        await page.touchscreen.touchMove(vp.width / 2, vp.height * 0.15);
        await page.touchscreen.touchEnd();
        await new Promise((r) => setTimeout(r, 60));
      }
      await new Promise((r) => setTimeout(r, 400));
      const end = await page.evaluate(measure);
      const lastBottom = Math.max(...end.leaves.map((t) => t.box.bottom));
      const frameBottom = end.frame ? end.frame.bottom : 0;
      check(lastBottom <= chromeTop - 4 && frameBottom <= end.viewport.bottom, `${vp.name}: scrolled to the end, the board clears the bottom chrome (board ends ${Math.round(frameBottom)}, chrome starts ${Math.round(chromeTop)})`);
      check(frameBottom >= end.viewport.bottom - 48, `${vp.name}: scrolling stops at the board's end (no flying past it)`);
      const chromeOverTiles = end.chrome.filter((c) => end.leaves.some((t) => gap(c.box, t.box) < 0));
      check(chromeOverTiles.length === 0, `${vp.name}: no chrome over a tile at the end of the board${chromeOverTiles.length ? ` — ${chromeOverTiles.map((c) => c.sel).join(', ')}` : ''}`);
      if (SHOTS) await page.screenshot({ path: join(SHOTS, `${vp.name}-bottom.png`) });
      // The phone's own facing pill (Hands on + camera live, forced here: no
      // camera headless) and the Camera dot: in the bottom chrome band, never
      // over the board, another control or the screen edge; text not cut.
      const fp = await page.evaluate(() => {
        const pill = document.querySelector('.mc-phone-facing');
        const cam = document.querySelector('.mc-cam-on');
        if (!pill) return null;
        pill.hidden = false; pill.textContent = 'Not facing'; pill.classList.add('is-away');
        if (cam) { cam.hidden = false; cam.dataset.state = 'live'; }
        return true;
      });
      check(fp === true, `${vp.name}: the phone facing pill exists`);
      if (fp) {
        await new Promise((r) => setTimeout(r, 300));
        const f = await page.evaluate(() => {
          const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
          const pill = document.querySelector('.mc-phone-facing');
          const sels = ['.mc-fab-mic', '.mc-join-pill', '.mc-phone-track-pill', '.mc-phone-hands-pill', '.mc-read-aloud', '.mc-cam-on', '.mc-talk-control'];
          const others = sels.map((sel) => { const el = document.querySelector(sel); if (!el || el.hidden || getComputedStyle(el).display === 'none') return null; return { sel, box: box(el) }; }).filter(Boolean);
          const vpEl = document.querySelector('.mc-viewport');
          return { pill: box(pill), shown: getComputedStyle(pill).display !== 'none', cut: pill.scrollWidth > pill.clientWidth + 1, others, viewport: vpEl ? box(vpEl) : null, vw: innerWidth, vh: innerHeight };
        });
        const near = f.others.filter((o) => o.sel !== '.mc-talk-control' && gap(o.box, f.pill) < 4).map((o) => o.sel);
        const onMic = f.others.filter((o) => (o.sel === '.mc-talk-control' || o.sel === '.mc-fab-mic') && gap(o.box, f.pill) < 4).map((o) => o.sel);
        check(f.shown && f.pill.width > 0, `${vp.name}: facing pill shows`);
        check(f.pill.left >= 0 && f.pill.right <= f.vw && f.pill.bottom <= f.vh, `${vp.name}: facing pill inside the screen`);
        check(near.length === 0 && onMic.length === 0, `${vp.name}: facing pill touches no other control${near.length + onMic.length ? ` — ${[...near, ...onMic].join(', ')}` : ''}`);
        check(!f.cut, `${vp.name}: facing pill text fits`);
        const camBox = f.others.find((o) => o.sel === '.mc-cam-on')?.box;
        check(!!f.viewport && f.viewport.bottom <= f.pill.top && (!camBox || f.viewport.bottom <= camBox.top), `${vp.name}: the board area ends above the facing pill and the Camera dot (${Math.round(f.viewport?.bottom ?? -1)} ≤ ${Math.round(f.pill.top)})`);
        if (SHOTS) await page.screenshot({ path: join(SHOTS, `${vp.name}-facing.png`) });
      }
      check(errors.length === 0, `${vp.name}: no page errors${errors.length ? ` — ${errors[0]}` : ''}`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
  console.log(failures.length ? `\n${failures.length} failure(s)` : '\nphone layout: all checks passed');
  return failures.length ? 1 : 0;
}

main().then((code) => process.exit(code), (e) => { console.error(e); process.exit(1); });
